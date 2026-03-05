import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import { IPC } from '../shared/types';

/**
 * Preload script — exposes a safe IPC bridge to the renderer process.
 * With contextIsolation enabled, the renderer can only access these
 * explicitly exposed methods, not raw Node.js or Electron APIs.
 */

type IpcCallback = (...args: unknown[]) => void;
type IpcSubscription = (_event: IpcRendererEvent, ...args: unknown[]) => void;

const SEND_CHANNELS = [
  IPC.AGENT_SEND,
  IPC.AGENT_CANCEL,
  IPC.TERMINAL_DATA,
  IPC.TERMINAL_RESIZE,
  IPC.TERMINAL_DISPOSE,
  IPC.WINDOW_MINIMIZE,
  IPC.WINDOW_MAXIMIZE,
  IPC.WINDOW_CLOSE,
  IPC.UPDATER_INSTALL,
] as const;

const INVOKE_CHANNELS = [
  IPC.AUTH_GET_USER,
  IPC.AUTH_LOGIN,
  IPC.AUTH_LOGOUT,
  IPC.AUTH_LOGIN_CANCEL,
  IPC.GIT_STATUS,
  IPC.GIT_DIFF,
  IPC.GIT_STAGE,
  IPC.GIT_COMMIT,
  IPC.GIT_CREATE_WORKTREE,
  IPC.GIT_REMOVE_WORKTREE,
  IPC.TERMINAL_CREATE,
  IPC.AGENT_LIST_MODELS,
  IPC.AGENT_LIST_SKILLS,
  IPC.AGENT_LIST_AGENTS,
  IPC.AGENT_LIST_PROJECT_MCP,
  IPC.PROJECT_SELECT_DIR,
  IPC.UPDATER_CHECK,
  IPC.TEST_SCREENSHOT,
  IPC.TEST_EXEC,
] as const;

const RECEIVE_CHANNELS = [
  IPC.AGENT_STREAM,
  IPC.AGENT_PERMISSION_REQUEST,
  IPC.AGENT_USER_INPUT_REQUEST,
  IPC.TERMINAL_DATA,
  IPC.AUTH_LOGIN_COMPLETE,
  IPC.UPDATER_STATUS,
] as const;

const listenerMapByChannel = new Map<string, WeakMap<IpcCallback, IpcSubscription>>();

const isAllowedChannel = <T extends readonly string[]>(allowed: T, channel: string): channel is T[number] =>
  (allowed as readonly string[]).includes(channel);

const getListenerMap = (channel: string): WeakMap<IpcCallback, IpcSubscription> => {
  const existing = listenerMapByChannel.get(channel);
  if (existing) return existing;
  const created = new WeakMap<IpcCallback, IpcSubscription>();
  listenerMapByChannel.set(channel, created);
  return created;
};

contextBridge.exposeInMainWorld('electronAPI', {
  isTestMode: process.env.LOOM_TEST_MODE === '1',

  // IPC send (fire-and-forget)
  send: (channel: string, ...args: unknown[]) => {
    if (isAllowedChannel(SEND_CHANNELS, channel)) {
      ipcRenderer.send(channel, ...args);
    }
  },

  // IPC invoke (request-response)
  invoke: (channel: string, ...args: unknown[]) => {
    if (isAllowedChannel(INVOKE_CHANNELS, channel)) {
      return ipcRenderer.invoke(channel, ...args);
    }
    return Promise.reject(new Error(`IPC channel not allowed: ${channel}`));
  },

  // IPC on (subscribe to events)
  on: (channel: string, callback: IpcCallback) => {
    if (isAllowedChannel(RECEIVE_CHANNELS, channel)) {
      const subscription: IpcSubscription = (_event, ...args) => callback(...args);
      ipcRenderer.on(channel, subscription);
      getListenerMap(channel).set(callback, subscription);
      // Return unsubscribe function.
      return () => {
        getListenerMap(channel).delete(callback);
        ipcRenderer.removeListener(channel, subscription);
      };
    }
    return () => {};
  },

  // IPC once (one-shot listener)
  once: (channel: string, callback: IpcCallback) => {
    if (isAllowedChannel(RECEIVE_CHANNELS, channel)) {
      ipcRenderer.once(channel, (_event, ...args) => callback(...args));
    }
  },

  // Dynamic reply channels for permission/input flows.
  sendReply: (channel: string, ...args: unknown[]) => {
    if (channel.startsWith('agent:permission-reply:') || channel.startsWith('agent:user-input-reply:')) {
      ipcRenderer.send(channel, ...args);
    }
  },

  removeListener: (channel: string, callback: IpcCallback) => {
    if (isAllowedChannel(RECEIVE_CHANNELS, channel)) {
      const subscription = getListenerMap(channel).get(callback);
      if (subscription) {
        getListenerMap(channel).delete(callback);
        ipcRenderer.removeListener(channel, subscription);
      }
    }
  },
});
