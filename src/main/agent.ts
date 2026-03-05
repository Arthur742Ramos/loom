import { ipcMain } from 'electron';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Agent backend — powered by @github/copilot-sdk.
 *
 * Design:
 * - One long-lived SDK client for process stability.
 * - Session IDs are cached, but session *objects* are always freshly obtained
 *   via resumeSession/createSession so they hold the current connection.
 * - Per-request event subscription for streaming deltas.
 * - Explicit cancellation via session.abort().
 */

let CopilotClientClass: any = null;
let clientPromise: Promise<any> | null = null;

// Cache session IDs (not objects) so sessions always use the current connection.
const threadSessionIds = new Map<string, string>();
// Track in-flight sessions for cancellation.
const inFlightSessions = new Map<string, any>();
const canceledThreads = new Set<string>();
// Serialize per-thread requests — each thread gets a queue lock.
const threadLocks = new Map<string, Promise<void>>();

interface AgentRequest {
  threadId: string;
  requestId?: string;
  cliSessionId?: string;
  message: string;
  context?: {
    cwd?: string;
  };
  model?: string;
  reasoningEffort?: 'low' | 'medium' | 'high' | 'xhigh';
  permissionMode?: 'ask' | 'auto' | 'deny';
  mcpServers?: Record<string, { command: string; args?: string[]; env?: Record<string, string> }>;
  customAgents?: { name: string; displayName?: string; description?: string; prompt: string; tools?: string[] | null }[];
}

type StreamPayload = { type: string } & Record<string, unknown>;

interface ScriptedTestEvent {
  type: 'status' | 'thinking' | 'tool_start' | 'tool_end' | 'chunk' | 'done' | 'error';
  status?: string;
  content?: string;
  toolCallId?: string;
  toolName?: string;
  success?: boolean;
  result?: string;
  error?: string;
  delayMs?: number;
}

function sendStream(sender: Electron.WebContents, request: AgentRequest, payload: StreamPayload): void {
  sender.send(
    'agent:stream',
    request.threadId,
    request.requestId ? { ...payload, requestId: request.requestId } : payload,
  );
}

function getScriptedTestEvents(request: AgentRequest): ScriptedTestEvent[] | null {
  const raw = process.env.LOOM_TEST_AGENT_SCRIPT || process.env.LOOM_TEST_AGENT_EVENTS;
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as any;
    if (Array.isArray(parsed)) return parsed;
    if (Array.isArray(parsed?.events)) return parsed.events;
    if (parsed?.byPrompt && Array.isArray(parsed.byPrompt[request.message])) {
      return parsed.byPrompt[request.message];
    }
    if (Array.isArray(parsed?.default)) return parsed.default;
    if (parsed?.[request.message] && Array.isArray(parsed[request.message])) {
      return parsed[request.message];
    }
  } catch {
    return null;
  }
  return null;
}

const sleep = async (ms: number): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, ms));
};

export function findCopilotPath(): string {
  try {
    if (process.platform === 'win32') {
      // Prefer the real .exe over npm shims in node_modules/.bin.
      const out = execSync('where.exe copilot.exe copilot.cmd copilot', { encoding: 'utf-8' }).trim();
      const results = out.split(/\r?\n/).filter(Boolean);
      // Pick the first result that is NOT inside node_modules.
      return results.find(r => !r.includes('node_modules')) || results[0] || 'copilot';
    }
    return execSync('which copilot', { encoding: 'utf-8' }).trim().split('\n')[0];
  } catch {
    return 'copilot';
  }
}

async function loadClientClass(): Promise<any> {
  if (!CopilotClientClass) {
    // Keep as runtime import to avoid webpack static bundling issues with ESM-only package.
    const dynamicImport = new Function('specifier', 'return import(specifier)');
    const sdk = await dynamicImport('@github/copilot-sdk');
    CopilotClientClass = sdk.CopilotClient;
  }
  return CopilotClientClass;
}

async function getClient(): Promise<any> {
  if (!clientPromise) {
    clientPromise = (async () => {
      const CopilotClient = await loadClientClass();
      return new CopilotClient({
        cliPath: findCopilotPath(),
        autoStart: true,
        autoRestart: true,
        logLevel: 'error',
      });
    })();
  }
  return clientPromise;
}

async function resetClient(): Promise<void> {
  const previousClientPromise = clientPromise;
  clientPromise = null;
  threadSessionIds.clear();
  inFlightSessions.clear();
  canceledThreads.clear();
  if (previousClientPromise) {
    try {
      const previousClient = await previousClientPromise;
      // forceStop avoids writing teardown messages to a dead stream.
      await (previousClient.forceStop ?? previousClient.stop)?.call(previousClient);
    } catch {
      // Ignore teardown errors while resetting.
    }
  }
}

export function isConnectionError(err: unknown): boolean {
  const message = String((err as any)?.message || err || '');
  return /Connection is closed|Connection is disposed|ERR_STREAM_DESTROYED|write after a stream was destroyed|Pending response rejected/i.test(message);
}

export function loadAgentsFromProject(cwd?: string): any[] {
  if (!cwd) return [];
  const agentDir = path.join(cwd, '.github', 'agents');
  try {
    if (!fs.existsSync(agentDir)) return [];
    return fs.readdirSync(agentDir)
      .filter(f => f.endsWith('.md'))
      .map(f => {
        const content = fs.readFileSync(path.join(agentDir, f), 'utf-8');
        const name = f.replace(/\.md$/, '').replace(/\.agent$/, '');
        const firstLine = content.split('\n').find(l => l.trim())?.replace(/^#+\s*/, '') || name;
        return {
          name,
          displayName: firstLine.substring(0, 60),
          description: firstLine.substring(0, 100),
          prompt: content,
        };
      });
  } catch { return []; }
}

export function loadMcpFromProject(cwd?: string): Record<string, any> {
  if (!cwd) return {};
  const candidates = [
    path.join(cwd, '.vscode', 'mcp.json'),
    path.join(cwd, '.github', 'copilot', 'mcp.json'),
  ];
  for (const file of candidates) {
    try {
      if (!fs.existsSync(file)) continue;
      const raw = JSON.parse(fs.readFileSync(file, 'utf-8'));
      const servers = raw.servers || raw;
      const result: Record<string, any> = {};
      for (const [name, cfg] of Object.entries(servers as Record<string, any>)) {
        // Pass through the full config — the SDK needs type, tools, command, args, env, etc.
        result[name] = {
          ...cfg,
          // Ensure tools defaults to ["*"] if not specified (expose all tools).
          tools: cfg.tools || ['*'],
          // Ensure args is an array.
          args: cfg.args || [],
        };
      }
      return result;
    } catch { /* skip invalid files */ }
  }
  return {};
}

async function getOrCreateSession(client: any, request: AgentRequest, sender: Electron.WebContents): Promise<any> {
  const permissionMode = request.permissionMode || 'ask';

  // Permission handler: auto-approve, deny, or prompt the user via IPC.
  const onPermissionRequest = async (req: any) => {
    if (permissionMode === 'auto') {
      return { kind: 'approved' };
    }
    if (permissionMode === 'deny') {
      return { kind: 'denied-by-rules' };
    }
    // Ask mode — send to renderer and await user decision.
    return new Promise<any>((resolve) => {
      let resolved = false;
      const replyChannel = `agent:permission-reply:${request.threadId}:${Date.now()}`;
      const handler = (_: any, approved: boolean) => {
        if (resolved) return;
        resolved = true;
        resolve(approved
          ? { kind: 'approved' }
          : { kind: 'denied-interactively-by-user' });
      };
      sender.send('agent:permission-request', request.threadId, {
        ...req,
        replyChannel,
      });
      ipcMain.once(replyChannel, handler);
      // Auto-deny after 120s if user doesn't respond.
      setTimeout(() => {
        if (resolved) return;
        resolved = true;
        ipcMain.removeListener(replyChannel, handler);
        resolve({ kind: 'denied-interactively-by-user' });
      }, 120000);
    });
  };

  // User-input handler: forward ask_user requests to the renderer.
  const onUserInputRequest = async (req: any) => {
    return new Promise<any>((resolve) => {
      let resolved = false;
      const replyChannel = `agent:user-input-reply:${request.threadId}:${Date.now()}`;
      const handler = (_: any, answer: string) => {
        if (resolved) return;
        resolved = true;
        resolve({ answer, wasFreeform: true });
      };
      sender.send('agent:user-input-request', request.threadId, {
        question: req.question,
        choices: req.choices,
        allowFreeform: req.allowFreeform,
        replyChannel,
      });
      ipcMain.once(replyChannel, handler);
      setTimeout(() => {
        if (resolved) return;
        resolved = true;
        ipcMain.removeListener(replyChannel, handler);
        resolve({ answer: '', wasFreeform: true });
      }, 120000);
    });
  };

  const projectAgents = loadAgentsFromProject(request.context?.cwd);
  const projectMcp = loadMcpFromProject(request.context?.cwd);
  const baseConfig = {
    model: request.model,
    reasoningEffort: request.reasoningEffort as any,
    workingDirectory: request.context?.cwd,
    configDir: request.context?.cwd,
    streaming: true,
    onPermissionRequest,
    onUserInputRequest,
    mcpServers: { ...projectMcp, ...(request.mcpServers || {}) },
    customAgents: [...projectAgents, ...(request.customAgents || [])],
  };

  // Try to resume an existing session (preserves conversation history with a fresh connection).
  const cachedId = threadSessionIds.get(request.threadId);
  const sessionIdToResume = cachedId || request.cliSessionId;

  if (sessionIdToResume) {
    try {
      const session = await client.resumeSession(sessionIdToResume, baseConfig);
      threadSessionIds.set(request.threadId, session.sessionId);
      return session;
    } catch {
      // Resume failed (CLI restarted, session expired, etc.). Fall through to create.
      threadSessionIds.delete(request.threadId);
    }
  }

  // Create a brand-new session.
  try {
    const session = await client.createSession({
      ...baseConfig,
      sessionId: request.cliSessionId,
    });
    threadSessionIds.set(request.threadId, session.sessionId);
    return session;
  } catch (createErr: any) {
    const msg = String(createErr?.message || '');
    if (/does not support reasoning effort/i.test(msg)) {
      const session = await client.createSession({
        ...baseConfig,
        reasoningEffort: undefined,
        sessionId: request.cliSessionId,
      });
      threadSessionIds.set(request.threadId, session.sessionId);
      return session;
    }
    throw createErr;
  }
}

export function setupAgentHandlers() {
  ipcMain.on('agent:send', async (event, request: AgentRequest) => {
    // Serialize requests per thread to prevent concurrent execution races.
    const prevLock = threadLocks.get(request.threadId) || Promise.resolve();
    let releaseLock: () => void;
    const lock = new Promise<void>((resolve) => { releaseLock = resolve; });
    threadLocks.set(request.threadId, lock);
    await prevLock;

    if (process.env.LOOM_TEST_MODE === '1') {
      const mockContent = process.env.LOOM_TEST_AGENT_RESPONSE || `Mock response: ${request.message}`;
      const scriptedEvents = getScriptedTestEvents(request);
      if (scriptedEvents && scriptedEvents.length > 0) {
        for (const scriptedEvent of scriptedEvents) {
          if (scriptedEvent.delayMs && scriptedEvent.delayMs > 0) {
            await sleep(scriptedEvent.delayMs);
          }
          const { delayMs: _delayMs, ...payload } = scriptedEvent;
          sendStream(event.sender, request, payload as StreamPayload);
        }
        if (!scriptedEvents.some((evt) => evt.type === 'done' || evt.type === 'error')) {
          sendStream(event.sender, request, { type: 'done', content: mockContent });
        }
      } else {
        sendStream(event.sender, request, {
          type: 'status',
          status: 'Running mocked response',
        });
        sendStream(event.sender, request, { type: 'chunk', content: mockContent });
        sendStream(event.sender, request, { type: 'done', content: mockContent });
      }
      releaseLock!();
      return;
    }

    const runOnce = async () => {
      let unsubscribe: (() => void) | undefined;
      try {
        const client = await getClient();

        // If same thread is still running, abort old request first.
        const runningSession = inFlightSessions.get(request.threadId);
        if (runningSession) {
          try {
            canceledThreads.add(request.threadId);
            await runningSession.abort();
          } catch {
            // Ignore abort race errors.
          }
        }

        const session = await getOrCreateSession(client, request, event.sender);
        inFlightSessions.set(request.threadId, session);

        let toolCallCounter = 0;
        const nextFallbackToolCallId = () => `tc-${++toolCallCounter}`;
        let currentMessageId: string | undefined;
        unsubscribe = session.on((evt: any) => {
          if (evt.type === 'assistant.message_delta') {
            // Skip sub-agent responses — they belong to tool call output, not the main message.
            if (evt.data?.parentToolCallId) return;
            const content = evt.data?.deltaContent || evt.data?.content || '';
            if (!content) return;
            // When a new assistant turn starts (new messageId), signal the
            // renderer to replace accumulated content instead of appending.
            const msgId = evt.data?.messageId;
            if (msgId && msgId !== currentMessageId) {
              currentMessageId = msgId;
              sendStream(event.sender, request, { type: 'turn_reset' });
            }
            sendStream(event.sender, request, { type: 'chunk', content });
          } else if (evt.type === 'assistant.reasoning') {
            const content = evt.data?.content || '';
            if (content) {
              sendStream(event.sender, request, { type: 'thinking', content });
            }
          } else if (evt.type === 'assistant.reasoning_delta') {
            const content = evt.data?.deltaContent || '';
            if (content) {
              sendStream(event.sender, request, { type: 'thinking', content });
            }
          } else if (evt.type === 'assistant.intent') {
            sendStream(event.sender, request, {
              type: 'status', status: evt.data?.intent || 'Working...',
            });
          } else if (evt.type === 'tool.execution_start') {
            const toolCallId = evt.data?.toolCallId || nextFallbackToolCallId();
            sendStream(event.sender, request, {
              type: 'tool_start',
              toolCallId,
              toolName: evt.data?.toolName || 'tool',
            });
          } else if (evt.type === 'tool.execution_complete' || evt.type === 'tool.execution_end') {
            const toolCallId = evt.data?.toolCallId || '';
            sendStream(event.sender, request, {
              type: 'tool_end',
              toolCallId,
              success: evt.data?.success,
              result: evt.data?.result?.detailedContent || evt.data?.result?.content,
              error: evt.data?.error?.message,
            });
          } else if (evt.type === 'skill.invoked') {
            sendStream(event.sender, request, {
              type: 'status', status: `⚡ Skill: ${evt.data?.name || 'unknown'}`,
            });
          } else if (evt.type === 'subagent.started') {
            const toolCallId = evt.data?.toolCallId || nextFallbackToolCallId();
            sendStream(event.sender, request, {
              type: 'tool_start',
              toolCallId,
              toolName: `🤖 ${evt.data?.agentDisplayName || evt.data?.agentName || 'subagent'}`,
            });
          } else if (evt.type === 'subagent.completed' || evt.type === 'subagent.failed') {
            const toolCallId = evt.data?.toolCallId || '';
            sendStream(event.sender, request, {
              type: 'tool_end',
              toolCallId,
              success: evt.type === 'subagent.completed',
              error: evt.type === 'subagent.failed' ? evt.data?.error || 'Subagent failed' : undefined,
            });
          } else if (evt.type === 'session.error') {
            sendStream(event.sender, request, {
              type: 'error',
              content: evt.data?.message || 'Unknown error',
            });
          }
        });

        const result = await session.sendAndWait({ prompt: request.message }, 2147483647);
        // Send the final complete content so the renderer can fill in any
        // gaps left by streaming deltas (e.g. tool-heavy agentic responses).
        const finalContent = result?.data?.content;
        sendStream(event.sender, request, {
          type: 'done',
          content: typeof finalContent === 'string' ? finalContent : undefined,
        });
      } finally {
        if (unsubscribe) {
          try {
            unsubscribe();
          } catch {}
        }
        inFlightSessions.delete(request.threadId);
      }
    };

    try {
      await runOnce();
    } catch (err: any) {
      if (canceledThreads.has(request.threadId)) {
        canceledThreads.delete(request.threadId);
        sendStream(event.sender, request, { type: 'done' });
        return;
      }

      if (isConnectionError(err)) {
        threadSessionIds.delete(request.threadId);
        await resetClient();
        try {
          await runOnce();
          return;
        } catch (retryErr: any) {
          sendStream(event.sender, request, {
            type: 'error',
            content: `Failed to initialize Copilot SDK: ${retryErr.message || 'Connection recovery failed'}`,
          });
          return;
        }
      }

      sendStream(event.sender, request, {
        type: 'error',
        content: err.message || `Failed to initialize Copilot SDK: ${err}`,
      });
    } finally {
      releaseLock!();
    }
  });

  ipcMain.handle('agent:list-models', async () => {
    let modelClient: any;
    try {
      const CopilotClient = await loadClientClass();
      modelClient = new CopilotClient({
        cliPath: findCopilotPath(),
        autoStart: true,
        autoRestart: false,
        logLevel: 'error',
      });
      await modelClient.start?.();
      const models = await modelClient.listModels();
      return {
        success: true,
        models: models.map((m: any) => ({
          id: m.id || m.name,
          label: m.displayName || m.name || m.id,
          provider: m.publisher || m.provider || 'Unknown',
          supportedReasoningEfforts: m.supportedReasoningEfforts || [],
        })),
      };
    } catch (err: any) {
      return { success: false, error: err.message };
    } finally {
      if (modelClient) {
        try {
          await modelClient.stop?.();
        } catch {}
      }
    }
  });

  ipcMain.on('agent:cancel', async (_event, threadId: string) => {
    const session = inFlightSessions.get(threadId);
    if (!session) return;
    try {
      canceledThreads.add(threadId);
      await session.abort();
    } catch {
      // Ignore abort errors.
    } finally {
      inFlightSessions.delete(threadId);
    }
  });

  // List skill files from the project.
  ipcMain.handle('agent:list-skills', async (_event, projectPath: string) => {
    const results: { name: string; path: string; description: string }[] = [];

    // copilot-instructions.md
    const instructionsPath = path.join(projectPath, '.github', 'copilot-instructions.md');
    if (fs.existsSync(instructionsPath)) {
      results.push({ name: 'copilot-instructions', path: instructionsPath, description: 'Project-level instructions' });
    }

    // Skill directories
    for (const dir of [
      path.join(projectPath, '.github', 'copilot', 'skills'),
      path.join(projectPath, '.copilot', 'skills'),
    ]) {
      try {
        if (!fs.existsSync(dir)) continue;
        for (const file of fs.readdirSync(dir).filter(f => f.endsWith('.md'))) {
          const filePath = path.join(dir, file);
          const content = fs.readFileSync(filePath, 'utf-8');
          const firstLine = content.split('\n').find(l => l.trim())?.replace(/^#+\s*/, '') || '';
          results.push({ name: file.replace(/\.md$/, ''), path: filePath, description: firstLine.substring(0, 100) });
        }
      } catch {}
    }
    return results;
  });

  // List custom agents from the project.
  ipcMain.handle('agent:list-agents', async (_event, projectPath: string) => {
    const results: { name: string; path: string; description: string }[] = [];
    const agentDir = path.join(projectPath, '.github', 'agents');
    try {
      if (fs.existsSync(agentDir)) {
        for (const file of fs.readdirSync(agentDir).filter(f => f.endsWith('.md'))) {
          const filePath = path.join(agentDir, file);
          const content = fs.readFileSync(filePath, 'utf-8');
          const firstLine = content.split('\n').find(l => l.trim())?.replace(/^#+\s*/, '').replace(/^---\s*$/, '') || '';
          results.push({
            name: file.replace(/\.md$/, '').replace(/\.agent$/, ''),
            path: filePath,
            description: firstLine.substring(0, 100),
          });
        }
      }
    } catch {}
    return results;
  });

  // List MCP servers discovered from project config files.
  ipcMain.handle('agent:list-project-mcp', async (_event, projectPath: string) => {
    return loadMcpFromProject(projectPath);
  });
}

