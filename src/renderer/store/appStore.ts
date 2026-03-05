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
  worktreePath?: string;
}

export interface ToolCallEntry {
  id: string;
  toolName: string;
  status: 'running' | 'done';
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

  // Messages
  addMessage: (threadId: string, message: ChatMessage) => void;
  updateMessage: (threadId: string, messageId: string, updates: Partial<ChatMessage>) => void;
  appendToMessage: (threadId: string, messageId: string, content: string) => void;
  appendThinking: (threadId: string, messageId: string, content: string) => void;
  addToolCall: (threadId: string, messageId: string, toolCall: ToolCallEntry) => void;
  updateToolCallStatus: (threadId: string, messageId: string, toolCallId: string, status: 'done') => void;

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

  // Theme
  theme: 'light' | 'dark' | 'system';
  setTheme: (theme: 'light' | 'dark' | 'system') => void;
}

let threadCounter = 0;

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
        if (typeof window === 'undefined' || !(window as any).require) return;
        set({ modelsLoading: true });
        try {
          const { ipcRenderer } = (window as any).require('electron');
          const result = await ipcRenderer.invoke('agent:list-models');
          if (result.success && result.models.length > 0) {
            set({ availableModels: result.models });
          }
        } catch {
          // keep fallback models
        }
        set({ modelsLoading: false });
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
          threads: s.threads.map((t) => (t.id === id ? { ...t, ...updates } : t)),
        })),

      // Messages
      addMessage: (threadId, message) =>
        set((s) => ({
          threads: s.threads.map((t) =>
            t.id === threadId ? { ...t, messages: [...t.messages, message] } : t,
          ),
        })),

      updateMessage: (threadId, messageId, updates) =>
        set((s) => ({
          threads: s.threads.map((t) =>
            t.id === threadId
              ? {
                  ...t,
                  messages: t.messages.map((m) =>
                    m.id === messageId ? { ...m, ...updates } : m,
                  ),
                }
              : t,
          ),
        })),

      appendToMessage: (threadId, messageId, content) =>
        set((s) => ({
          threads: s.threads.map((t) =>
            t.id === threadId
              ? {
                  ...t,
                  messages: t.messages.map((m) =>
                    m.id === messageId ? { ...m, content: m.content + content } : m,
                  ),
                }
              : t,
          ),
        })),

      appendThinking: (threadId, messageId, content) =>
        set((s) => ({
          threads: s.threads.map((t) =>
            t.id === threadId
              ? {
                  ...t,
                  messages: t.messages.map((m) =>
                    m.id === messageId ? { ...m, thinking: (m.thinking || '') + content } : m,
                  ),
                }
              : t,
          ),
        })),

      addToolCall: (threadId, messageId, toolCall) =>
        set((s) => ({
          threads: s.threads.map((t) =>
            t.id === threadId
              ? {
                  ...t,
                  messages: t.messages.map((m) =>
                    m.id === messageId ? { ...m, toolCalls: [...(m.toolCalls || []), toolCall] } : m,
                  ),
                }
              : t,
          ),
        })),

      updateToolCallStatus: (threadId, messageId, toolCallId, status) =>
        set((s) => ({
          threads: s.threads.map((t) =>
            t.id === threadId
              ? {
                  ...t,
                  messages: t.messages.map((m) =>
                    m.id === messageId
                      ? {
                          ...m,
                          toolCalls: (m.toolCalls || []).map((tc) =>
                            tc.id === toolCallId ? { ...tc, status } : tc,
                          ),
                        }
                      : m,
                  ),
                }
              : t,
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

      // Theme
      theme: 'system',
      setTheme: (theme) => set({ theme }),
    }),
    {
      name: 'loom-state',
      partialize: (state) => ({
        githubUser: state.githubUser,
        projects: state.projects,
        projectPath: state.projectPath,
        projectName: state.projectName,
        selectedModel: state.selectedModel,
        reasoningEffort: state.reasoningEffort,
        permissionMode: state.permissionMode,
        threads: state.threads,
        activeThreadId: state.activeThreadId,
        mcpServers: state.mcpServers,
        theme: state.theme,
      }),
    },
  ),
);

// Expose store for testing/debugging
(window as any).__appStore = appStore;

export const useAppStore = appStore;
