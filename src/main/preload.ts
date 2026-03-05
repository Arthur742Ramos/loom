import { contextBridge, ipcRenderer } from 'electron';

/**
 * Preload script — exposes a safe IPC bridge to the renderer process.
 * With contextIsolation enabled, the renderer can only access these
 * explicitly exposed methods, not raw Node.js or Electron APIs.
 */

contextBridge.exposeInMainWorld('electronAPI', {
  // IPC send (fire-and-forget)
  send: (channel: string, ...args: any[]) => {
    const allowedSendChannels = [
      'agent:send', 'agent:cancel',
      'terminal:data', 'terminal:resize', 'terminal:dispose',
      'window:minimize', 'window:maximize', 'window:close',
    ];
    if (allowedSendChannels.includes(channel)) {
      ipcRenderer.send(channel, ...args);
    }
  },

  // IPC invoke (request-response)
  invoke: (channel: string, ...args: any[]) => {
    const allowedInvokeChannels = [
      'auth:get-user', 'auth:login', 'auth:logout',
      'git:status', 'git:diff', 'git:stage', 'git:commit',
      'git:create-worktree', 'git:remove-worktree',
      'terminal:create',
      'agent:list-models', 'agent:list-skills', 'agent:list-agents', 'agent:list-project-mcp',
      'project:select-dir',
      'test:screenshot', 'test:exec',
    ];
    if (allowedInvokeChannels.includes(channel)) {
      return ipcRenderer.invoke(channel, ...args);
    }
    return Promise.reject(new Error(`IPC channel not allowed: ${channel}`));
  },

  // IPC on (subscribe to events)
  on: (channel: string, callback: (...args: any[]) => void) => {
    const allowedReceiveChannels = [
      'agent:stream', 'agent:permission-request', 'agent:user-input-request',
      'terminal:data',
    ];
    if (allowedReceiveChannels.includes(channel)) {
      const subscription = (_event: any, ...args: any[]) => callback(...args);
      ipcRenderer.on(channel, subscription);
      // Return unsubscribe function.
      return () => { ipcRenderer.removeListener(channel, subscription); };
    }
    return () => {};
  },

  // IPC once (one-shot listener)
  once: (channel: string, callback: (...args: any[]) => void) => {
    const allowedReceiveChannels = [
      'agent:stream', 'agent:permission-request', 'agent:user-input-request',
      'terminal:data',
    ];
    if (allowedReceiveChannels.includes(channel)) {
      ipcRenderer.once(channel, (_event, ...args) => callback(...args));
    }
  },

  // Dynamic reply channels for permission/input flows.
  sendReply: (channel: string, ...args: any[]) => {
    if (channel.startsWith('agent:permission-reply:') || channel.startsWith('agent:user-input-reply:')) {
      ipcRenderer.send(channel, ...args);
    }
  },

  removeListener: (channel: string, callback: (...args: any[]) => void) => {
    const allowedReceiveChannels = [
      'agent:stream', 'agent:permission-request', 'agent:user-input-request',
      'terminal:data',
    ];
    if (allowedReceiveChannels.includes(channel)) {
      ipcRenderer.removeListener(channel, callback);
    }
  },
});
