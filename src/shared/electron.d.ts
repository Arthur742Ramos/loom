/** Type declarations for the preload-exposed electronAPI bridge. */

export type AppStoreHook = typeof import('../renderer/store/appStore').useAppStore;

export interface ElectronAPI {
  isTestMode: boolean;
  send: (channel: string, ...args: unknown[]) => void;
  invoke: <T = unknown>(channel: string, ...args: unknown[]) => Promise<T>;
  on: <TArgs extends unknown[]>(channel: string, callback: (...args: TArgs) => void) => () => void;
  once: <TArgs extends unknown[]>(channel: string, callback: (...args: TArgs) => void) => void;
  sendReply: (channel: string, ...args: unknown[]) => void;
  removeListener: <TArgs extends unknown[]>(channel: string, callback: (...args: TArgs) => void) => void;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
    __appStore?: AppStoreHook;
  }
}

export {};
