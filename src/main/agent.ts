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

interface AgentRequest {
  threadId: string;
  cliSessionId?: string;
  message: string;
  context?: {
    cwd?: string;
  };
  model?: string;
  reasoningEffort?: 'low' | 'medium' | 'high';
  permissionMode?: 'ask' | 'auto' | 'deny';
}

function findCopilotPath(): string {
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

function isConnectionError(err: unknown): boolean {
  const message = String((err as any)?.message || err || '');
  return /Connection is closed|Connection is disposed|ERR_STREAM_DESTROYED|write after a stream was destroyed|Pending response rejected/i.test(message);
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
      const replyChannel = `agent:permission-reply:${request.threadId}:${Date.now()}`;
      sender.send('agent:permission-request', request.threadId, {
        ...req,
        replyChannel,
      });
      ipcMain.once(replyChannel, (_: any, approved: boolean) => {
        resolve(approved
          ? { kind: 'approved' }
          : { kind: 'denied-interactively-by-user' });
      });
      // Auto-deny after 120s if user doesn't respond.
      setTimeout(() => resolve({ kind: 'denied-interactively-by-user' }), 120000);
    });
  };

  // User-input handler: forward ask_user requests to the renderer.
  const onUserInputRequest = async (req: any) => {
    return new Promise<any>((resolve) => {
      const replyChannel = `agent:user-input-reply:${request.threadId}:${Date.now()}`;
      sender.send('agent:user-input-request', request.threadId, {
        question: req.question,
        choices: req.choices,
        allowFreeform: req.allowFreeform,
        replyChannel,
      });
      ipcMain.once(replyChannel, (_: any, answer: string) => {
        resolve({ answer, wasFreeform: true });
      });
      setTimeout(() => resolve({ answer: '', wasFreeform: true }), 120000);
    });
  };

  const baseConfig = {
    model: request.model,
    reasoningEffort: request.reasoningEffort,
    workingDirectory: request.context?.cwd,
    configDir: request.context?.cwd,
    streaming: true,
    onPermissionRequest,
    onUserInputRequest,
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

        unsubscribe = session.on((evt: any) => {
          if (evt.type === 'assistant.message_delta') {
            const content = evt.data?.deltaContent || evt.data?.content || '';
            if (content) {
              event.sender.send('agent:stream', request.threadId, { type: 'chunk', content });
            }
          } else if (evt.type === 'assistant.reasoning_delta') {
            const content = evt.data?.deltaContent || '';
            if (content) {
              event.sender.send('agent:stream', request.threadId, { type: 'thinking', content });
            }
          } else if (evt.type === 'assistant.intent') {
            event.sender.send('agent:stream', request.threadId, {
              type: 'status', status: evt.data?.intent || 'Working...',
            });
          } else if (evt.type === 'tool.execution_start') {
            event.sender.send('agent:stream', request.threadId, {
              type: 'status',
              status: `Running ${evt.data?.toolName || 'tool'}`,
              toolName: evt.data?.toolName,
              toolArgs: evt.data?.arguments,
            });
          } else if (evt.type === 'tool.execution_complete') {
            event.sender.send('agent:stream', request.threadId, { type: 'status', status: '' });
          } else if (evt.type === 'skill.invoked') {
            event.sender.send('agent:stream', request.threadId, {
              type: 'status', status: `⚡ Skill: ${evt.data?.name || 'unknown'}`,
            });
          } else if (evt.type === 'subagent.started') {
            event.sender.send('agent:stream', request.threadId, {
              type: 'status', status: `🤖 Agent: ${evt.data?.agentDisplayName || evt.data?.agentName || 'subagent'}`,
            });
          } else if (evt.type === 'subagent.completed' || evt.type === 'subagent.failed') {
            event.sender.send('agent:stream', request.threadId, { type: 'status', status: '' });
          } else if (evt.type === 'session.error') {
            event.sender.send('agent:stream', request.threadId, {
              type: 'error',
              content: evt.data?.message || 'Unknown error',
            });
          }
        });

        const result = await session.sendAndWait({ prompt: request.message }, 300000);
        // Send the final complete content so the renderer can fill in any
        // gaps left by streaming deltas (e.g. tool-heavy agentic responses).
        const finalContent = result?.data?.content;
        event.sender.send('agent:stream', request.threadId, {
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
        event.sender.send('agent:stream', request.threadId, { type: 'done' });
        return;
      }

      if (isConnectionError(err)) {
        threadSessionIds.delete(request.threadId);
        await resetClient();
        try {
          await runOnce();
          return;
        } catch (retryErr: any) {
          event.sender.send('agent:stream', request.threadId, {
            type: 'error',
            content: `Failed to initialize Copilot SDK: ${retryErr.message || 'Connection recovery failed'}`,
          });
          return;
        }
      }

      event.sender.send('agent:stream', request.threadId, {
        type: 'error',
        content: err.message || `Failed to initialize Copilot SDK: ${err}`,
      });
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

  // List skill files discovered in the project directory.
  ipcMain.handle('agent:list-skills', async (_event, projectPath: string) => {
    const skillDirs = [
      { dir: path.join(projectPath, '.github', 'agents'), category: 'agent' },
      { dir: path.join(projectPath, '.github', 'chatmodes'), category: 'chatmode' },
      { dir: path.join(projectPath, '.github', 'copilot', 'skills'), category: 'skill' },
      { dir: path.join(projectPath, '.copilot', 'skills'), category: 'skill' },
    ];
    const skills: { name: string; path: string; description: string; category: string }[] = [];

    // Also check for copilot-instructions.md
    const instructionsPath = path.join(projectPath, '.github', 'copilot-instructions.md');
    if (fs.existsSync(instructionsPath)) {
      skills.push({
        name: 'copilot-instructions',
        path: instructionsPath,
        description: 'Project-level instructions for Copilot',
        category: 'instructions',
      });
    }

    for (const { dir, category } of skillDirs) {
      try {
        if (!fs.existsSync(dir)) continue;
        const files = fs.readdirSync(dir).filter(f => f.endsWith('.md') && f !== 'README.md');
        for (const file of files) {
          const filePath = path.join(dir, file);
          const content = fs.readFileSync(filePath, 'utf-8');
          const firstLine = content.split('\n').find(l => l.trim())?.replace(/^#+\s*/, '').replace(/^---\s*$/, '') || '';
          skills.push({
            name: file.replace(/\.md$/, '').replace(/\.(agent|chatmode)$/, ''),
            path: filePath,
            description: firstLine.substring(0, 100),
            category,
          });
        }
      } catch { /* dir not readable */ }
    }
    return skills;
  });
}

