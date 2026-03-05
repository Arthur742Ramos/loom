// Shared types for Loom

export interface Thread {
  id: string;
  title: string;
  cliSessionId: string;
  projectPath: string;
  projectName: string;
  mode: 'local' | 'worktree';
  status: 'idle' | 'running' | 'completed' | 'error';
  createdAt: number;
  messages: Message[];
  worktreePath?: string;
}

export interface ToolCallEntry {
  id: string;
  toolName: string;
  status: 'running' | 'done' | 'error';
  result?: string;
  error?: string;
}

export interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  status?: 'pending' | 'streaming' | 'done' | 'error';
  thinking?: string;
  toolCalls?: ToolCallEntry[];
  diff?: DiffEntry[];
  files?: FileChange[];
}

export interface DiffEntry {
  filePath: string;
  hunks: DiffHunk[];
  status: 'added' | 'modified' | 'deleted';
}

export interface DiffHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  content: string;
}

export interface FileChange {
  path: string;
  action: 'create' | 'edit' | 'delete';
  content?: string;
  staged: boolean;
}

export interface Project {
  id: string;
  name: string;
  path: string;
  lastOpened: number;
}

export interface AgentConfig {
  model: string;
  maxTokens: number;
  temperature: number;
  systemPrompt: string;
}

export interface TerminalSession {
  threadId: string;
  pid?: number;
}

// IPC Channel names
export const IPC = {
  // Git operations
  GIT_DIFF: 'git:diff',
  GIT_STATUS: 'git:status',
  GIT_STAGE: 'git:stage',
  GIT_COMMIT: 'git:commit',
  GIT_CREATE_WORKTREE: 'git:create-worktree',
  GIT_REMOVE_WORKTREE: 'git:remove-worktree',

  // Terminal
  TERMINAL_CREATE: 'terminal:create',
  TERMINAL_DATA: 'terminal:data',
  TERMINAL_RESIZE: 'terminal:resize',
  TERMINAL_DISPOSE: 'terminal:dispose',

  // Agent
  AGENT_SEND: 'agent:send',
  AGENT_STREAM: 'agent:stream',
  AGENT_CANCEL: 'agent:cancel',

  // Auth
  AUTH_LOGIN: 'auth:login',
  AUTH_LOGOUT: 'auth:logout',
  AUTH_GET_USER: 'auth:get-user',

  // Project
  PROJECT_OPEN: 'project:open',
  PROJECT_SELECT_DIR: 'project:select-dir',

  // Window
  WINDOW_MINIMIZE: 'window:minimize',
  WINDOW_MAXIMIZE: 'window:maximize',
  WINDOW_CLOSE: 'window:close',
} as const;
