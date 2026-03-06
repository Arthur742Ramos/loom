// Shared IPC channel constants for Loom.
// Type definitions live in their respective modules:
//   - Thread/ChatMessage/ToolCallEntry → renderer/store/appStore.ts
//   - DiffFile/DiffHunk/DiffLine       → main/git.ts

export const IPC = {
  // Git operations
  GIT_DIFF: 'git:diff',
  GIT_STATUS: 'git:status',
  GIT_STAGE: 'git:stage',
  GIT_COMMIT: 'git:commit',
  GIT_LIST_BRANCHES: 'git:list-branches',
  GIT_CHECKOUT: 'git:checkout',
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
  AGENT_LIST_MODELS: 'agent:list-models',
  AGENT_LIST_SKILLS: 'agent:list-skills',
  AGENT_LIST_AGENTS: 'agent:list-agents',
  AGENT_LIST_PROJECT_MCP: 'agent:list-project-mcp',
  AGENT_PERMISSION_REQUEST: 'agent:permission-request',
  AGENT_USER_INPUT_REQUEST: 'agent:user-input-request',

  // Auth
  AUTH_LOGIN: 'auth:login',
  AUTH_LOGIN_CANCEL: 'auth:login-cancel',
  AUTH_LOGIN_COMPLETE: 'auth:login-complete',
  AUTH_LOGOUT: 'auth:logout',
  AUTH_GET_USER: 'auth:get-user',

  // Project
  PROJECT_SELECT_DIR: 'project:select-dir',
  APP_GET_VERSION: 'app:get-version',

  // Window
  WINDOW_MINIMIZE: 'window:minimize',
  WINDOW_MAXIMIZE: 'window:maximize',
  WINDOW_CLOSE: 'window:close',

  // Updater
  UPDATER_CHECK: 'updater:check',
  UPDATER_INSTALL: 'updater:install',
  UPDATER_STATUS: 'updater:status',

  // Test hooks
  TEST_SCREENSHOT: 'test:screenshot',
  TEST_EXEC: 'test:exec',
} as const;

export interface DiffLine {
  type: 'add' | 'del' | 'ctx';
  oldLine: number | null;
  newLine: number | null;
  content: string;
}

export interface DiffHunk {
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  header: string;
  lines: DiffLine[];
}

export interface DiffFile {
  path: string;
  oldPath?: string;
  status: 'added' | 'modified' | 'deleted' | 'renamed';
  hunks: DiffHunk[];
  additions: number;
  deletions: number;
}

export interface GitBranchListResult {
  branches: string[];
  current: string | null;
  detached: boolean;
  error?: string;
}

export interface GitCheckoutResult {
  success?: boolean;
  current?: string | null;
  error?: string;
}
