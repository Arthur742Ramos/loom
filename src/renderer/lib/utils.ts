import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Returns the preload-exposed Electron IPC bridge, or null outside Electron. */
export function getElectronAPI() {
  return typeof window !== 'undefined' ? window.electronAPI ?? null : null;
}
