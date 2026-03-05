import { vi } from 'vitest';

type Listener = (_event: unknown, ...args: any[]) => void;

export interface MockIpcRenderer {
  invoke: ReturnType<typeof vi.fn>;
  send: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
  once: ReturnType<typeof vi.fn>;
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
      return ipcRenderer;
    }),
    once: vi.fn((channel: string, listener: Listener) => {
      if (!onceListeners.has(channel)) onceListeners.set(channel, new Set());
      onceListeners.get(channel)!.add(listener);
      return ipcRenderer;
    }),
    removeListener: vi.fn((channel: string, listener: Listener) => {
      listeners.get(channel)?.delete(listener);
      onceListeners.get(channel)?.delete(listener);
      return ipcRenderer;
    }),
    emit: (channel: string, ...args: any[]) => {
      for (const listener of listeners.get(channel) ?? []) {
        listener({}, ...args);
      }
      const once = onceListeners.get(channel);
      if (once) {
        onceListeners.delete(channel);
        for (const listener of once) {
          listener({}, ...args);
        }
      }
    },
    reset: () => {
      listeners.clear();
      onceListeners.clear();
      ipcRenderer.invoke.mockReset();
      ipcRenderer.send.mockReset();
      ipcRenderer.on.mockClear();
      ipcRenderer.once.mockClear();
      ipcRenderer.removeListener.mockClear();
    },
  };

  return ipcRenderer;
}

export function installElectronMock(ipcRenderer: MockIpcRenderer): () => void {
  const originalRequire = (window as any).require;
  (window as any).require = (moduleName: string) => {
    if (moduleName === 'electron') {
      return { ipcRenderer };
    }
    throw new Error(`Unsupported module in test require(): ${moduleName}`);
  };

  return () => {
    if (originalRequire) {
      (window as any).require = originalRequire;
      return;
    }
    delete (window as any).require;
  };
}
