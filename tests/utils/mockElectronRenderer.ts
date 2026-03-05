import { vi } from 'vitest';

type Listener = (...args: any[]) => void;

export interface MockIpcRenderer {
  invoke: ReturnType<typeof vi.fn>;
  send: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
  once: ReturnType<typeof vi.fn>;
  sendReply: ReturnType<typeof vi.fn>;
  removeListener: ReturnType<typeof vi.fn>;
  emit: (channel: string, ...args: any[]) => void;
  reset: () => void;
}

export function createMockIpcRenderer(): MockIpcRenderer {
  const listeners = new Map<string, Set<Listener>>();
  const onceListeners = new Map<string, Set<Listener>>();

  const ipcRenderer: MockIpcRenderer = {
    invoke: vi.fn(),
    send: vi.fn(),
    on: vi.fn((channel: string, listener: Listener) => {
      if (!listeners.has(channel)) listeners.set(channel, new Set());
      listeners.get(channel)!.add(listener);
      // Return unsubscribe function matching preload API.
      return () => { listeners.get(channel)?.delete(listener); };
    }),
    once: vi.fn((channel: string, listener: Listener) => {
      if (!onceListeners.has(channel)) onceListeners.set(channel, new Set());
      onceListeners.get(channel)!.add(listener);
    }),
    sendReply: vi.fn((channel: string, ...args: any[]) => {
      // Simulate sending to reply channels — fire matching once listeners.
      const once = onceListeners.get(channel);
      if (once) {
        onceListeners.delete(channel);
        for (const listener of once) {
          listener(...args);
        }
      }
    }),
    removeListener: vi.fn((channel: string, listener: Listener) => {
      listeners.get(channel)?.delete(listener);
      onceListeners.get(channel)?.delete(listener);
    }),
    emit: (channel: string, ...args: any[]) => {
      for (const listener of listeners.get(channel) ?? []) {
        listener(...args);
      }
      const once = onceListeners.get(channel);
      if (once) {
        onceListeners.delete(channel);
        for (const listener of once) {
          listener(...args);
        }
      }
    },
    reset: () => {
      listeners.clear();
      onceListeners.clear();
      ipcRenderer.invoke.mockReset();
      ipcRenderer.send.mockReset();
      ipcRenderer.sendReply.mockReset();
      ipcRenderer.on.mockClear();
      ipcRenderer.once.mockClear();
      ipcRenderer.removeListener.mockClear();
    },
  };

  return ipcRenderer;
}

/** Installs mock as window.electronAPI (matching the preload bridge). */
export function installElectronMock(ipcRenderer: MockIpcRenderer): () => void {
  const originalAPI = window.electronAPI;
  (window as any).electronAPI = ipcRenderer;

  return () => {
    if (originalAPI) {
      (window as any).electronAPI = originalAPI;
    } else {
      delete (window as any).electronAPI;
    }
  };
}
