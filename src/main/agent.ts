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

/** Infer the model provider from its ID prefix. */
function inferProvider(modelId: string): string {
  if (modelId.startsWith('claude-')) return 'Anthropic';
  if (modelId.startsWith('gpt-') || modelId.startsWith('o1-') || modelId.startsWith('o3-') || modelId.startsWith('o4-')) return 'OpenAI';
  if (modelId.startsWith('gemini-')) return 'Google';
  return 'Other';
}

interface CopilotModelDescriptor {
  id?: string;
  name?: string;
  supportedReasoningEfforts?: string[];
}

interface AgentStreamEvent {
  type: string;
  data?: Record<string, unknown>;
}

interface AgentSession {
  sessionId: string;
  on: (listener: (event: AgentStreamEvent) => void) => () => void;
  sendAndWait: (
    payload: { prompt: string },
    timeoutMs: number,
  ) => Promise<{ data?: { content?: unknown } } | undefined>;
  abort: () => Promise<void>;
}

interface CopilotClient {
  createSession: (config: Record<string, unknown>) => Promise<AgentSession>;
  resumeSession: (sessionId: string, config: Record<string, unknown>) => Promise<AgentSession>;
  listModels: () => Promise<CopilotModelDescriptor[]>;
  start?: () => Promise<void>;
  forceStop?: () => Promise<void>;
  stop?: () => Promise<void>;
  modelsCache?: unknown;
}

interface CopilotClientConstructor {
  new (config: {
    cliPath: string;
    autoStart: boolean;
    autoRestart: boolean;
    logLevel: string;
  }): CopilotClient;
}

let CopilotClientClass: CopilotClientConstructor | null = null;
let clientPromise: Promise<CopilotClient> | null = null;

// Cache session IDs (not objects) so sessions always use the current connection.
const threadSessionIds = new Map<string, string>();
// Track in-flight sessions for cancellation.
const inFlightSessions = new Map<string, AgentSession>();
const canceledThreads = new Set<string>();
// Serialize per-thread requests — each thread gets a queue lock.
const threadLocks = new Map<string, Promise<void>>();

/** Test helper: report how many per-thread queue locks are currently active. */
export function getThreadLockCountForTests(): number {
  return threadLocks.size;
}

interface NormalizedMcpServerConfig {
  command: string;
  args: string[];
  env?: Record<string, string>;
  tools: string[];
  type?: string;
  timeout?: number;
}

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

const getErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

const asOptionalString = (value: unknown): string | undefined =>
  typeof value === 'string' ? value : undefined;

const asOptionalReasoningEffort = (value: unknown): AgentRequest['reasoningEffort'] =>
  value === 'low' || value === 'medium' || value === 'high' || value === 'xhigh'
    ? value
    : undefined;

const asOptionalPermissionMode = (value: unknown): AgentRequest['permissionMode'] =>
  value === 'ask' || value === 'auto' || value === 'deny'
    ? value
    : undefined;

const normalizeCustomAgents = (value: unknown): AgentRequest['customAgents'] => {
  if (!Array.isArray(value)) return undefined;
  const normalized = value
    .filter((entry): entry is Record<string, unknown> => typeof entry === 'object' && entry !== null)
    .map((entry) => {
      if (!isNonEmptyString(entry.name) || !isNonEmptyString(entry.prompt)) return null;
      const tools = Array.isArray(entry.tools)
        ? entry.tools.filter((tool): tool is string => typeof tool === 'string')
        : entry.tools === null
          ? null
          : undefined;
      return {
        name: entry.name,
        displayName: asOptionalString(entry.displayName),
        description: asOptionalString(entry.description),
        prompt: entry.prompt,
        ...(tools !== undefined ? { tools } : {}),
      };
    })
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null);
  return normalized.length > 0 ? normalized : undefined;
};

const normalizeMcpServers = (value: unknown): AgentRequest['mcpServers'] => {
  if (!isPlainObject(value)) return undefined;
  const normalized: NonNullable<AgentRequest['mcpServers']> = {};
  for (const [name, config] of Object.entries(value)) {
    const parsed = normalizeMcpServerConfig(config);
    if (parsed) normalized[name] = parsed;
  }
  return Object.keys(normalized).length > 0 ? normalized : undefined;
};

function normalizeAgentRequest(rawRequest: unknown): {
  request: AgentRequest | null;
  threadId: string;
  requestId?: string;
  error?: string;
} {
  if (!isPlainObject(rawRequest)) {
    return { request: null, threadId: 'unknown', error: 'Invalid request payload' };
  }

  const threadId = asOptionalString(rawRequest.threadId) || 'unknown';
  const requestId = asOptionalString(rawRequest.requestId);
  if (!isNonEmptyString(rawRequest.threadId)) {
    return { request: null, threadId, requestId, error: 'Missing threadId' };
  }
  if (typeof rawRequest.message !== 'string') {
    return { request: null, threadId, requestId, error: 'Missing message' };
  }

  const context = isPlainObject(rawRequest.context) && isNonEmptyString(rawRequest.context.cwd)
    ? { cwd: rawRequest.context.cwd }
    : undefined;

  return {
    request: {
      threadId: rawRequest.threadId,
      requestId,
      cliSessionId: asOptionalString(rawRequest.cliSessionId),
      message: rawRequest.message,
      ...(context ? { context } : {}),
      model: asOptionalString(rawRequest.model),
      reasoningEffort: asOptionalReasoningEffort(rawRequest.reasoningEffort),
      permissionMode: asOptionalPermissionMode(rawRequest.permissionMode),
      mcpServers: normalizeMcpServers(rawRequest.mcpServers),
      customAgents: normalizeCustomAgents(rawRequest.customAgents),
    },
    threadId,
    requestId,
  };
}

interface ScriptedTestEvent {
  type: 'status' | 'thinking' | 'tool_start' | 'tool_end' | 'chunk' | 'usage' | 'done' | 'error';
  status?: string;
  content?: string;
  toolCallId?: string;
  toolName?: string;
  success?: boolean;
  result?: string;
  error?: string;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  totalTokens?: number;
  delayMs?: number;
}

interface StreamUsagePayload {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
}

const toTokenNumber = (value: unknown): number | undefined => {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed >= 0) return parsed;
  }
  return undefined;
};

const pickTokenNumber = (source: Record<string, unknown>, keys: string[]): number | undefined => {
  for (const key of keys) {
    const candidate = toTokenNumber(source[key]);
    if (candidate !== undefined) return candidate;
  }
  return undefined;
};

/** Normalize usage payloads from differing SDK/provider token field names. */
export function normalizeUsagePayload(rawData: unknown): StreamUsagePayload | null {
  if (!rawData || typeof rawData !== 'object') return null;
  const root = rawData as Record<string, unknown>;
  const nestedUsage = root.usage;
  const source = nestedUsage && typeof nestedUsage === 'object'
    ? nestedUsage as Record<string, unknown>
    : root;

  const inputRaw = pickTokenNumber(source, ['inputTokens', 'promptTokens', 'input_tokens', 'prompt_tokens']);
  const outputRaw = pickTokenNumber(source, ['outputTokens', 'completionTokens', 'output_tokens', 'completion_tokens']);
  const cacheReadRaw = pickTokenNumber(source, [
    'cacheReadTokens',
    'cacheReadInputTokens',
    'cache_read_tokens',
    'cache_read_input_tokens',
  ]);
  const cacheWriteRaw = pickTokenNumber(source, [
    'cacheWriteTokens',
    'cacheWriteInputTokens',
    'cacheCreationInputTokens',
    'cache_write_tokens',
    'cache_creation_input_tokens',
  ]);
  const totalRaw = pickTokenNumber(source, ['totalTokens', 'totalTokenCount', 'total_tokens']);

  if ([inputRaw, outputRaw, cacheReadRaw, cacheWriteRaw, totalRaw].every((v) => v === undefined)) {
    return null;
  }

  const inputTokens = inputRaw ?? 0;
  const outputTokens = outputRaw ?? 0;
  const cacheReadTokens = cacheReadRaw ?? 0;
  const cacheWriteTokens = cacheWriteRaw ?? 0;
  const totalTokens = totalRaw ?? (inputTokens + outputTokens + cacheReadTokens + cacheWriteTokens);

  return {
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    totalTokens,
  };
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const toStringArray = (value: unknown): string[] | null => {
  if (!Array.isArray(value)) return null;
  if (!value.every((entry) => typeof entry === 'string')) return null;
  return [...value];
};

const toStringRecord = (value: unknown): Record<string, string> | null => {
  if (!isPlainObject(value)) return null;
  const entries = Object.entries(value);
  if (!entries.every(([, v]) => typeof v === 'string')) return null;
  return Object.fromEntries(entries) as Record<string, string>;
};

/** Validate and normalize a single MCP server config object. */
export function normalizeMcpServerConfig(config: unknown): NormalizedMcpServerConfig | null {
  if (!isPlainObject(config)) return null;

  const command = typeof config.command === 'string' ? config.command.trim() : '';
  if (!command) return null;

  const args = config.args === undefined ? [] : toStringArray(config.args);
  if (!args) return null;

  const tools = config.tools === undefined ? ['*'] : toStringArray(config.tools);
  if (!tools) return null;

  const env = config.env === undefined ? undefined : toStringRecord(config.env);
  if (config.env !== undefined && !env) return null;

  const result: NormalizedMcpServerConfig = {
    command,
    args,
    tools,
    ...(env ? { env } : {}),
  };

  if (config.type !== undefined) {
    if (typeof config.type !== 'string') return null;
    result.type = config.type;
  }

  if (config.timeout !== undefined) {
    if (typeof config.timeout !== 'number' || !Number.isFinite(config.timeout) || config.timeout <= 0) {
      return null;
    }
    result.timeout = config.timeout;
  }

  return result;
}

/** Resolve the most likely tool call ID for a completion event. */
export function resolveRunningToolCallId(
  runningToolCallIds: string[],
  explicitToolCallId?: unknown,
): string {
  if (typeof explicitToolCallId === 'string' && explicitToolCallId.length > 0) {
    const index = runningToolCallIds.indexOf(explicitToolCallId);
    if (index >= 0) runningToolCallIds.splice(index, 1);
    return explicitToolCallId;
  }
  const nextRunningId = runningToolCallIds.shift();
  return nextRunningId || '';
}

/** Await a renderer response on a dynamic reply channel with timeout fallback. */
export function waitForIpcReply<T>(
  replyChannel: string,
  sendPrompt: () => void,
  onReply: (...args: unknown[]) => T,
  onTimeout: () => T,
  timeoutMs = 120000,
): Promise<T> {
  return new Promise<T>((resolve) => {
    let settled = false;
    let timeoutHandle: NodeJS.Timeout | undefined;
    let handler: ((_: unknown, ...args: unknown[]) => void) | undefined;

    const finish = (value: T) => {
      if (settled) return;
      settled = true;
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
        timeoutHandle = undefined;
      }
      if (handler) {
        ipcMain.removeListener(replyChannel, handler);
      }
      resolve(value);
    };

    handler = (_event: unknown, ...args: unknown[]) => {
      finish(onReply(...args));
    };

    ipcMain.once(replyChannel, handler);
    sendPrompt();
    timeoutHandle = setTimeout(() => {
      finish(onTimeout());
    }, timeoutMs);
  });
}

function sendStream(sender: Electron.WebContents, request: AgentRequest, payload: StreamPayload): void {
  sender.send(
    'agent:stream',
    request.threadId,
    request.requestId ? { ...payload, requestId: request.requestId } : payload,
  );
}

const toScriptedEventList = (value: unknown): ScriptedTestEvent[] | null =>
  Array.isArray(value) ? value as ScriptedTestEvent[] : null;

function getScriptedTestEvents(request: AgentRequest): ScriptedTestEvent[] | null {
  const raw = process.env.LOOM_TEST_AGENT_SCRIPT || process.env.LOOM_TEST_AGENT_EVENTS;
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    const directEvents = toScriptedEventList(parsed);
    if (directEvents) return directEvents;
    if (!isPlainObject(parsed)) return null;

    const nestedEvents = toScriptedEventList(parsed.events);
    if (nestedEvents) return nestedEvents;

    const byPrompt = isPlainObject(parsed.byPrompt) ? parsed.byPrompt : null;
    if (byPrompt) {
      const promptEvents = toScriptedEventList(byPrompt[request.message]);
      if (promptEvents) return promptEvents;
    }

    const defaultEvents = toScriptedEventList(parsed.default);
    if (defaultEvents) return defaultEvents;

    const keyedEvents = toScriptedEventList(parsed[request.message]);
    if (keyedEvents) return keyedEvents;
  } catch {
    return null;
  }
  return null;
}

const sleep = async (ms: number): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, ms));
};

/** Find the Copilot CLI binary path, falling back to plain `copilot`. */
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

async function loadClientClass(): Promise<CopilotClientConstructor> {
  if (!CopilotClientClass) {
    // Keep as runtime import to avoid webpack static bundling issues with ESM-only package.
    const dynamicImport = new Function('specifier', 'return import(specifier)') as
      (specifier: string) => Promise<{ CopilotClient: CopilotClientConstructor }>;
    const sdk = await dynamicImport('@github/copilot-sdk');
    CopilotClientClass = sdk.CopilotClient;
  }
  return CopilotClientClass;
}

async function getClient(): Promise<CopilotClient> {
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

/** Inject or clear a mock client for unit tests. */
export function setClientForTests(client: CopilotClient | null): void {
  clientPromise = client ? Promise.resolve(client) : null;
  if (!client) {
    CopilotClientClass = null;
  }
}

async function resetClient(): Promise<void> {
  const previousClientPromise = clientPromise;
  clientPromise = null;
  threadSessionIds.clear();
  inFlightSessions.clear();
  canceledThreads.clear();
  threadLocks.clear();
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
  const message = getErrorMessage(err);
  return /Connection is closed|Connection is disposed|ERR_STREAM_DESTROYED|write after a stream was destroyed|Pending response rejected/i.test(message);
}

export interface ProjectAgentConfig {
  name: string;
  displayName: string;
  description: string;
  prompt: string;
}

/** Load local markdown agents from .github/agents for prompt-time discovery. */
export function loadAgentsFromProject(cwd?: string): ProjectAgentConfig[] {
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

/** Load and normalize project MCP server definitions from supported config files. */
export function loadMcpFromProject(cwd?: string): Record<string, NormalizedMcpServerConfig> {
  if (!cwd) return {};
  const candidates = [
    path.join(cwd, '.vscode', 'mcp.json'),
    path.join(cwd, '.github', 'copilot', 'mcp.json'),
  ];
  for (const file of candidates) {
    try {
      if (!fs.existsSync(file)) continue;
      const raw = JSON.parse(fs.readFileSync(file, 'utf-8'));
      const serversCandidate = isPlainObject(raw) && isPlainObject(raw.servers) ? raw.servers : raw;
      if (!isPlainObject(serversCandidate)) return {};
      const result: Record<string, NormalizedMcpServerConfig> = {};
      for (const [name, cfg] of Object.entries(serversCandidate)) {
        const normalized = normalizeMcpServerConfig(cfg);
        if (!normalized) continue;
        result[name] = normalized;
      }
      return result;
    } catch { /* skip invalid files */ }
  }
  return {};
}

/** Return all existing skill directories that should be passed to the SDK session config. */
export function getProjectSkillDirectories(cwd?: string): string[] {
  if (!cwd) return [];
  const candidates = [
    path.join(cwd, '.github', 'copilot', 'skills'),
    path.join(cwd, '.copilot', 'skills'),
  ];
  const seen = new Set<string>();
  return candidates.filter((dir) => {
    if (seen.has(dir)) return false;
    seen.add(dir);
    try {
      return fs.existsSync(dir) && fs.statSync(dir).isDirectory();
    } catch {
      return false;
    }
  });
}

async function getOrCreateSession(
  client: CopilotClient,
  request: AgentRequest,
  sender: Electron.WebContents,
): Promise<AgentSession> {
  const permissionMode = request.permissionMode || 'ask';

  // Permission handler: auto-approve, deny, or prompt the user via IPC.
  const onPermissionRequest = async (req: Record<string, unknown>) => {
    if (permissionMode === 'auto') {
      return { kind: 'approved' };
    }
    if (permissionMode === 'deny') {
      return { kind: 'denied-by-rules' };
    }
    // Ask mode — send to renderer and await user decision.
    const replyChannel = `agent:permission-reply:${request.threadId}:${Date.now()}`;
    return waitForIpcReply(
      replyChannel,
      () => {
        sender.send('agent:permission-request', request.threadId, {
          ...req,
          replyChannel,
        });
      },
      (approved: unknown) =>
        approved === true
          ? { kind: 'approved' }
          : { kind: 'denied-interactively-by-user' },
      () => ({ kind: 'denied-interactively-by-user' }),
      120000,
    );
  };

  // User-input handler: forward ask_user requests to the renderer.
  const onUserInputRequest = async (req: Record<string, unknown>) => {
    const replyChannel = `agent:user-input-reply:${request.threadId}:${Date.now()}`;
    return waitForIpcReply(
      replyChannel,
      () => {
        sender.send('agent:user-input-request', request.threadId, {
          question: req.question,
          choices: req.choices,
          allowFreeform: req.allowFreeform,
          replyChannel,
        });
      },
      (answer: unknown) => ({
        answer: typeof answer === 'string' ? answer : '',
        wasFreeform: true,
      }),
      () => ({ answer: '', wasFreeform: true }),
      120000,
    );
  };

  const projectAgents = loadAgentsFromProject(request.context?.cwd);
  const projectMcp = loadMcpFromProject(request.context?.cwd);
  const projectSkillDirectories = getProjectSkillDirectories(request.context?.cwd);
  const baseConfig = {
    model: request.model,
    reasoningEffort: request.reasoningEffort,
    workingDirectory: request.context?.cwd,
    configDir: request.context?.cwd,
    streaming: true,
    onPermissionRequest,
    onUserInputRequest,
    mcpServers: { ...projectMcp, ...(request.mcpServers || {}) },
    customAgents: [...projectAgents, ...(request.customAgents || [])],
    skillDirectories: projectSkillDirectories,
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
  } catch (createErr: unknown) {
    const msg = getErrorMessage(createErr);
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
  ipcMain.on('agent:send', async (event, rawRequest: unknown) => {
    const normalized = normalizeAgentRequest(rawRequest);
    if (!normalized.request) {
      event.sender.send(
        'agent:stream',
        normalized.threadId,
        normalized.requestId
          ? { type: 'error', content: normalized.error || 'Invalid request', requestId: normalized.requestId }
          : { type: 'error', content: normalized.error || 'Invalid request' },
      );
      return;
    }
    const request = normalized.request;

    // Serialize requests per thread to prevent concurrent execution races.
    const prevLock = threadLocks.get(request.threadId) || Promise.resolve();
    let releaseLock: () => void = () => {};
    const lock = new Promise<void>((resolve) => { releaseLock = resolve; });
    threadLocks.set(request.threadId, lock);
    const completeLock = () => {
      if (threadLocks.get(request.threadId) === lock) {
        threadLocks.delete(request.threadId);
      }
      releaseLock();
    };
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
      completeLock();
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
          } finally {
            // Clear canceled flag so it doesn't leak into future requests.
            canceledThreads.delete(request.threadId);
          }
        }

        const session = await getOrCreateSession(client, request, event.sender);
        inFlightSessions.set(request.threadId, session);

        let toolCallCounter = 0;
        const nextFallbackToolCallId = () => `tc-${++toolCallCounter}`;
        const runningToolCallIds: string[] = [];
        let currentMessageId: string | undefined;
        unsubscribe = session.on((evt: AgentStreamEvent) => {
          const data = isPlainObject(evt.data) ? evt.data : {};
          if (evt.type === 'assistant.message_delta') {
            // Skip sub-agent responses — they belong to tool call output, not the main message.
            if (data.parentToolCallId) return;
            const content = asOptionalString(data.deltaContent) || asOptionalString(data.content) || '';
            if (!content) return;
            // When a new assistant turn starts (new messageId), signal the
            // renderer to replace accumulated content instead of appending.
            const msgId = asOptionalString(data.messageId);
            if (msgId && msgId !== currentMessageId) {
              currentMessageId = msgId;
              sendStream(event.sender, request, { type: 'turn_reset' });
            }
            sendStream(event.sender, request, { type: 'chunk', content });
          } else if (evt.type === 'assistant.reasoning') {
            const content = asOptionalString(data.content) || '';
            if (content) {
              sendStream(event.sender, request, { type: 'thinking', content });
            }
          } else if (evt.type === 'assistant.reasoning_delta') {
            const content = asOptionalString(data.deltaContent) || '';
            if (content) {
              sendStream(event.sender, request, { type: 'thinking', content });
            }
          } else if (evt.type === 'assistant.usage') {
            const usage = normalizeUsagePayload(data);
            if (usage) {
              sendStream(event.sender, request, {
                type: 'usage',
                ...usage,
              });
            }
          } else if (evt.type === 'assistant.intent') {
            sendStream(event.sender, request, {
              type: 'status',
              status: asOptionalString(data.intent) || 'Working...',
            });
          } else if (evt.type === 'tool.execution_start') {
            const toolCallId = asOptionalString(data.toolCallId) || nextFallbackToolCallId();
            runningToolCallIds.push(toolCallId);
            sendStream(event.sender, request, {
              type: 'tool_start',
              toolCallId,
              toolName: asOptionalString(data.toolName) || 'tool',
            });
          } else if (evt.type === 'tool.execution_complete' || evt.type === 'tool.execution_end') {
            const toolCallId = resolveRunningToolCallId(runningToolCallIds, data.toolCallId);
            const result = isPlainObject(data.result) ? data.result : {};
            const error = isPlainObject(data.error) ? data.error : {};
            sendStream(event.sender, request, {
              type: 'tool_end',
              toolCallId,
              success: data.success,
              result: asOptionalString(result.detailedContent) || asOptionalString(result.content),
              error: asOptionalString(error.message),
            });
          } else if (evt.type === 'skill.invoked') {
            sendStream(event.sender, request, {
              type: 'status',
              status: `⚡ Skill: ${asOptionalString(data.name) || 'unknown'}`,
            });
          } else if (evt.type === 'subagent.started') {
            const toolCallId = asOptionalString(data.toolCallId) || nextFallbackToolCallId();
            runningToolCallIds.push(toolCallId);
            const subagentName = asOptionalString(data.agentDisplayName)
              || asOptionalString(data.agentName)
              || 'subagent';
            sendStream(event.sender, request, {
              type: 'tool_start',
              toolCallId,
              toolName: `🤖 ${subagentName}`,
            });
          } else if (evt.type === 'subagent.completed' || evt.type === 'subagent.failed') {
            const toolCallId = resolveRunningToolCallId(runningToolCallIds, data.toolCallId);
            sendStream(event.sender, request, {
              type: 'tool_end',
              toolCallId,
              success: evt.type === 'subagent.completed',
              error: evt.type === 'subagent.failed'
                ? asOptionalString(data.error) || 'Subagent failed'
                : undefined,
            });
          } else if (evt.type === 'session.error') {
            sendStream(event.sender, request, {
              type: 'error',
              content: asOptionalString(data.message) || 'Unknown error',
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
    } catch (err: unknown) {
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
        } catch (retryErr: unknown) {
          sendStream(event.sender, request, {
            type: 'error',
            content: `Failed to initialize Copilot SDK: ${getErrorMessage(retryErr) || 'Connection recovery failed'}`,
          });
          return;
        }
      }

      sendStream(event.sender, request, {
        type: 'error',
        content: getErrorMessage(err),
      });
    } finally {
      completeLock();
    }
  });

  ipcMain.handle('agent:list-models', async () => {
    try {
      const client = await getClient();
      // Ensure the client connection is established (listModels doesn't auto-start).
      await client.start?.();
      // Clear the SDK's internal cache so we always fetch a fresh list.
      client.modelsCache = null;
      const models = await client.listModels();
      return {
        success: true,
        models: models.map((model) => {
          const id = model.id || model.name || 'unknown-model';
          const label = model.name || model.id || id;
          const supportedReasoningEfforts = Array.isArray(model.supportedReasoningEfforts)
            ? model.supportedReasoningEfforts.filter((entry): entry is string => typeof entry === 'string')
            : [];
          return {
            id,
            label,
            provider: inferProvider(id),
            supportedReasoningEfforts,
          };
        }),
      };
    } catch (err: unknown) {
      return { success: false, error: getErrorMessage(err) };
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
    for (const dir of getProjectSkillDirectories(projectPath)) {
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

