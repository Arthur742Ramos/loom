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

  // Auth
  AUTH_LOGIN: 'auth:login',
  AUTH_LOGOUT: 'auth:logout',
  AUTH_GET_USER: 'auth:get-user',

  // Project
  PROJECT_SELECT_DIR: 'project:select-dir',

  // Window
  WINDOW_MINIMIZE: 'window:minimize',
  WINDOW_MAXIMIZE: 'window:maximize',
  WINDOW_CLOSE: 'window:close',
} as const;
