import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export const FALLBACK_MODELS = [
  { id: 'claude-sonnet-4', label: 'Claude Sonnet 4', provider: 'Anthropic' },
  { id: 'gpt-4.1', label: 'GPT 4.1', provider: 'OpenAI' },
  { id: 'gpt-5.1-codex', label: 'GPT 5.1 Codex', provider: 'OpenAI' },
  { id: 'gemini-3-pro-preview', label: 'Gemini 3 Pro Preview', provider: 'Google' },
] as const;

export interface ModelInfo {
  id: string;
  label: string;
  provider: string;
  supportedReasoningEfforts?: string[];
}

export interface Thread {
  id: string;
  title: string;
  cliSessionId: string; // stable UUID for copilot --resume
  projectPath: string;
  projectName: string;
  mode: 'local' | 'worktree';
  status: 'idle' | 'running' | 'completed' | 'error';
  createdAt: number;
  messages: ChatMessage[];
  tokenUsage?: ThreadTokenUsage;
  worktreePath?: string;
}

export interface ThreadTokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
}

export interface ToolCallEntry {
  id: string;
  toolName: string;
  status: 'running' | 'done' | 'error';
  result?: string;
  error?: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  status: 'pending' | 'streaming' | 'done' | 'error';
  thinking?: string;
  toolCalls?: ToolCallEntry[];
}

export interface GitHubUser {
  login: string;
  name: string | null;
  avatar_url: string;
}

export interface ProjectEntry {
  path: string;
  name: string;
}

export interface McpServerConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  tools?: string[];
  type?: string;
  timeout?: number;
}

interface ListModelsResult {
  success: boolean;
  models: ModelInfo[];
}

interface AppState {
  // Auth
  githubUser: GitHubUser | null;
  setGitHubUser: (user: GitHubUser | null) => void;

  // Project
  projects: ProjectEntry[];
  projectPath: string | null;
  projectName: string | null;
  setProject: (path: string, name: string) => void;

  // Model
  selectedModel: string;
  setSelectedModel: (model: string) => void;
  reasoningEffort: 'low' | 'medium' | 'high' | 'xhigh';
  setReasoningEffort: (effort: 'low' | 'medium' | 'high' | 'xhigh') => void;
  availableModels: ModelInfo[];
  modelsLoading: boolean;
  fetchModels: () => Promise<void>;

  // Threads
  threads: Thread[];
  activeThreadId: string | null;
  setActiveThread: (id: string | null) => void;
  createThread: (title: string, mode: 'local' | 'worktree') => string;
  removeThread: (id: string) => void;
  updateThread: (id: string, updates: Partial<Thread>) => void;
  addThreadTokenUsage: (threadId: string, usage: ThreadTokenUsage) => void;

  // Messages
  addMessage: (threadId: string, message: ChatMessage) => void;
  updateMessage: (threadId: string, messageId: string, updates: Partial<ChatMessage>) => void;
  appendToMessage: (threadId: string, messageId: string, content: string) => void;
  appendThinking: (threadId: string, messageId: string, content: string) => void;
  addToolCall: (threadId: string, messageId: string, toolCall: ToolCallEntry) => void;
  updateToolCallStatus: (
    threadId: string,
    messageId: string,
    toolCallId: string,
    status: 'done' | 'error',
    details?: { result?: string; error?: string },
  ) => void;

  // Permissions
  permissionMode: 'ask' | 'auto' | 'deny';
  setPermissionMode: (mode: 'ask' | 'auto' | 'deny') => void;

  // MCP
  mcpServers: Record<string, McpServerConfig>;
  addMcpServer: (name: string, config: McpServerConfig) => void;
  updateMcpServer: (name: string, config: McpServerConfig) => void;
  removeMcpServer: (name: string) => void;

  // UI
  sidebarCollapsed: boolean;
  toggleSidebar: () => void;
  activeTab: 'chat' | 'diff' | 'terminal';
  setActiveTab: (tab: 'chat' | 'diff' | 'terminal') => void;
  showSettings: boolean;
  setShowSettings: (show: boolean) => void;
  showToolOutputDetails: boolean;
  setShowToolOutputDetails: (show: boolean) => void;

  // Chat input insertion (used by Sidebar to inject mentions)
  pendingInputInsertion: string | null;
  insertIntoChatInput: (text: string) => void;
  consumeInputInsertion: () => string | null;

  // Theme
  theme: 'light' | 'dark' | 'system';
  setTheme: (theme: 'light' | 'dark' | 'system') => void;
}

let threadCounter = 0;
let fetchModelsRequestId = 0;
const emptyThreadTokenUsage = (): ThreadTokenUsage => ({
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  totalTokens: 0,
});

const updateThreadList = (
  threads: Thread[],
  threadId: string,
  updater: (thread: Thread) => Thread,
): Thread[] => {
  let changed = false;
  const nextThreads = threads.map((thread) => {
    if (thread.id !== threadId) return thread;
    const updatedThread = updater(thread);
    if (updatedThread !== thread) changed = true;
    return updatedThread;
  });
  return changed ? nextThreads : threads;
};

const updateMessageList = (
  thread: Thread,
  messageId: string,
  updater: (message: ChatMessage) => ChatMessage,
): Thread => {
  let changed = false;
  const nextMessages = thread.messages.map((message) => {
    if (message.id !== messageId) return message;
    const updatedMessage = updater(message);
    if (updatedMessage !== message) changed = true;
    return updatedMessage;
  });
  return changed ? { ...thread, messages: nextMessages } : thread;
};

const appStore = create<AppState>()(
  persist(
    (set, get) => ({
      // Auth
      githubUser: null,
      setGitHubUser: (user) => set({ githubUser: user }),

      // Project
      projects: [],
      projectPath: null,
      projectName: null,
      setProject: (path, name) =>
        set((s) => ({
          projects: s.projects.some((p) => p.path === path)
            ? s.projects
            : [...s.projects, { path, name }],
          projectPath: path,
          projectName: name,
        })),

      // Model
      selectedModel: 'claude-sonnet-4',
      setSelectedModel: (model) => set({ selectedModel: model }),
      reasoningEffort: 'medium',
      setReasoningEffort: (effort) => set({ reasoningEffort: effort }),
      availableModels: [...FALLBACK_MODELS],
      modelsLoading: false,
      fetchModels: async () => {
        const api = typeof window !== 'undefined' ? window.electronAPI : null;
        if (!api) return;
        const requestId = ++fetchModelsRequestId;
        set({ modelsLoading: true });
        try {
          const result = await api.invoke<ListModelsResult>('agent:list-models');
          // Only apply if this is still the latest request.
          if (requestId !== fetchModelsRequestId) return;
          if (result.success && result.models.length > 0) {
            set({ availableModels: result.models });
          }
        } catch {
          // keep fallback models
        }
        if (requestId === fetchModelsRequestId) {
          set({ modelsLoading: false });
        }
      },

      // Threads
      threads: [],
      activeThreadId: null,

      setActiveThread: (id) =>
        set((s) => {
          if (!id) return { activeThreadId: null };
          const thread = s.threads.find((t) => t.id === id);
          if (thread?.projectPath && thread?.projectName) {
            return {
              activeThreadId: id,
              projectPath: thread.projectPath,
              projectName: thread.projectName,
            };
          }
          return { activeThreadId: id };
        }),

      createThread: (title, mode) => {
        const projectPath = get().projectPath;
        const projectName = get().projectName;
        if (!projectPath || !projectName) return '';
        const id = `thread-${Date.now()}-${++threadCounter}`;
        const cliSessionId = crypto.randomUUID();
        const thread: Thread = {
          id,
          title,
          cliSessionId,
          projectPath,
          projectName,
          mode,
          status: 'idle',
          createdAt: Date.now(),
          messages: [],
        };
        set((s) => ({
          threads: [thread, ...s.threads],
          activeThreadId: id,
          activeTab: 'chat',
        }));
        return id;
      },

      removeThread: (id) =>
        set((s) => ({
          threads: s.threads.filter((t) => t.id !== id),
          activeThreadId: s.activeThreadId === id ? null : s.activeThreadId,
        })),

      updateThread: (id, updates) =>
        set((s) => ({
          threads: updateThreadList(s.threads, id, (thread) => ({ ...thread, ...updates })),
        })),

      addThreadTokenUsage: (threadId, usage) =>
        set((s) => ({
          threads: updateThreadList(s.threads, threadId, (thread) => {
            const previous = thread.tokenUsage ?? emptyThreadTokenUsage();
            return {
              ...thread,
              tokenUsage: {
                inputTokens: previous.inputTokens + usage.inputTokens,
                outputTokens: previous.outputTokens + usage.outputTokens,
                cacheReadTokens: previous.cacheReadTokens + usage.cacheReadTokens,
                cacheWriteTokens: previous.cacheWriteTokens + usage.cacheWriteTokens,
                totalTokens: previous.totalTokens + usage.totalTokens,
              },
            };
          }),
        })),

      // Messages
      addMessage: (threadId, message) =>
        set((s) => ({
          threads: updateThreadList(s.threads, threadId, (thread) => ({
            ...thread,
            messages: [...thread.messages, message],
          })),
        })),

      updateMessage: (threadId, messageId, updates) =>
        set((s) => ({
          threads: updateThreadList(s.threads, threadId, (thread) =>
            updateMessageList(thread, messageId, (message) => ({ ...message, ...updates })),
          ),
        })),

      appendToMessage: (threadId, messageId, content) =>
        set((s) => ({
          threads: updateThreadList(s.threads, threadId, (thread) =>
            updateMessageList(thread, messageId, (message) => ({
              ...message,
              content: message.content + content,
            })),
          ),
        })),

      appendThinking: (threadId, messageId, content) =>
        set((s) => ({
          threads: updateThreadList(s.threads, threadId, (thread) =>
            updateMessageList(thread, messageId, (message) => ({
              ...message,
              thinking: (message.thinking || '') + content,
            })),
          ),
        })),

      addToolCall: (threadId, messageId, toolCall) =>
        set((s) => ({
          threads: updateThreadList(s.threads, threadId, (thread) =>
            updateMessageList(thread, messageId, (message) => {
              const existingToolCalls = message.toolCalls || [];
              if (existingToolCalls.some((tc) => tc.id === toolCall.id)) return message;
              return {
                ...message,
                toolCalls: [...existingToolCalls, toolCall],
              };
            }),
          ),
        })),

      updateToolCallStatus: (threadId, messageId, toolCallId, status, details) =>
        set((s) => ({
          threads: updateThreadList(s.threads, threadId, (thread) =>
            updateMessageList(thread, messageId, (message) => {
              const existingToolCalls = message.toolCalls || [];
              let changed = false;
              const nextToolCalls = existingToolCalls.map((toolCall) => {
                if (toolCall.id !== toolCallId) return toolCall;
                changed = true;
                return {
                  ...toolCall,
                  status,
                  ...(details?.result !== undefined ? { result: details.result } : {}),
                  ...(details?.error !== undefined ? { error: details.error } : {}),
                };
              });
              if (!changed) return message;
              return {
                ...message,
                toolCalls: nextToolCalls,
              };
            }),
          ),
        })),

      // Permissions
      permissionMode: 'ask' as const,
      setPermissionMode: (mode: 'ask' | 'auto' | 'deny') => set({ permissionMode: mode }),

      // MCP
      mcpServers: {} as Record<string, McpServerConfig>,
      addMcpServer: (name, config) => set((s) => ({
        mcpServers: { ...s.mcpServers, [name]: config },
      })),
      updateMcpServer: (name, config) => set((s) => ({
        mcpServers: { ...s.mcpServers, [name]: config },
      })),
      removeMcpServer: (name) => set((s) => {
        const { [name]: _, ...rest } = s.mcpServers;
        return { mcpServers: rest };
      }),

      // UI
      sidebarCollapsed: false,
      toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
      activeTab: 'chat',
      setActiveTab: (tab) => set({ activeTab: tab }),
      showSettings: false,
      setShowSettings: (show) => set({ showSettings: show }),
      showToolOutputDetails: false,
      setShowToolOutputDetails: (show) => set({ showToolOutputDetails: show }),

      // Chat input insertion
      pendingInputInsertion: null,
      insertIntoChatInput: (text) => set({ pendingInputInsertion: text }),
      consumeInputInsertion: () => {
        const val = get().pendingInputInsertion;
        if (val !== null) set({ pendingInputInsertion: null });
        return val;
      },

      // Theme
      theme: 'system',
      setTheme: (theme) => set({ theme }),
    }),
    {
      name: 'loom-state',
      partialize: (state) => {
        // Prune threads for persistence: keep last 50 messages per thread,
        // and only keep the 100 most recent threads.
        const MAX_THREADS = 100;
        const MAX_MESSAGES_PER_THREAD = 50;
        const trimmedThreads = state.threads
          .slice(0, MAX_THREADS)
          .map((t) => ({
            ...t,
            messages: t.messages.slice(-MAX_MESSAGES_PER_THREAD),
          }));
        return {
          githubUser: state.githubUser,
          projects: state.projects,
          projectPath: state.projectPath,
          projectName: state.projectName,
          selectedModel: state.selectedModel,
          reasoningEffort: state.reasoningEffort,
          permissionMode: state.permissionMode,
          threads: trimmedThreads,
          activeThreadId: state.activeThreadId,
          mcpServers: state.mcpServers,
          showToolOutputDetails: state.showToolOutputDetails,
          theme: state.theme,
        };
      },
      storage: {
        getItem: (name) => {
          try {
            const str = localStorage.getItem(name);
            return str ? JSON.parse(str) : null;
          } catch {
            return null;
          }
        },
        setItem: (name, value) => {
          try {
            const str = JSON.stringify(value);
            // Guard against exceeding localStorage quota (~5MB).
            if (str.length > 4 * 1024 * 1024) {
              console.warn('Loom state too large to persist, skipping save');
              return;
            }
            localStorage.setItem(name, str);
          } catch {
            // Quota exceeded or serialization error — skip silently.
          }
        },
        removeItem: (name) => { localStorage.removeItem(name); },
      },
    },
  ),
);

// Expose store for testing/debugging (development and explicit test mode)
if (process.env.NODE_ENV !== 'production' || window.electronAPI?.isTestMode === true) {
  window.__appStore = appStore;
}

export const useAppStore = appStore;
