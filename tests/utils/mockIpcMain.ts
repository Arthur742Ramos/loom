import { vi } from 'vitest';

type Handler = (_event: any, ...args: any[]) => any;

export function createMockIpcMain() {
  const handlers = new Map<string, Handler>();
  const listeners = new Map<string, Set<Handler>>();
  const onceListeners = new Map<string, Set<Handler>>();

  const ipcMain = {
    handle: vi.fn((channel: string, handler: Handler) => {
      handlers.set(channel, handler);
    }),
    on: vi.fn((channel: string, listener: Handler) => {
      if (!listeners.has(channel)) listeners.set(channel, new Set());
      listeners.get(channel)!.add(listener);
    }),
    once: vi.fn((channel: string, listener: Handler) => {
      if (!onceListeners.has(channel)) onceListeners.set(channel, new Set());
      onceListeners.get(channel)!.add(listener);
    }),
    removeListener: vi.fn((channel: string, listener: Handler) => {
      listeners.get(channel)?.delete(listener);
      onceListeners.get(channel)?.delete(listener);
    }),
    removeHandler: vi.fn((channel: string) => {
      handlers.delete(channel);
    }),
  };

  const invoke = async (channel: string, ...args: any[]) => {
    const handler = handlers.get(channel);
    if (!handler) throw new Error(`No handler registered for ${channel}`);
    return handler({}, ...args);
  };

  const emit = (channel: string, ...args: any[]) => {
    const event = { sender: { send: vi.fn() } };
    for (const listener of listeners.get(channel) ?? []) {
      listener(event, ...args);
    }
    const once = onceListeners.get(channel);
    if (once) {
      onceListeners.delete(channel);
      for (const listener of once) {
        listener(event, ...args);
      }
    }
    return event;
  };

  const getListener = (channel: string): Handler | undefined => {
    const channelListeners = listeners.get(channel);
    return channelListeners ? [...channelListeners][0] : undefined;
  };

  const reset = () => {
    handlers.clear();
    listeners.clear();
    onceListeners.clear();
    ipcMain.handle.mockClear();
    ipcMain.on.mockClear();
    ipcMain.once.mockClear();
    ipcMain.removeListener.mockClear();
    ipcMain.removeHandler.mockClear();
  };

  return { ipcMain, handlers, listeners, onceListeners, invoke, emit, getListener, reset };
}
