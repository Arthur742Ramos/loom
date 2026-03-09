import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import type { ElectronAPI } from '../../shared/electron';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Returns the preload-exposed Electron IPC bridge, or null outside Electron. */
export function getElectronAPI(): ElectronAPI | null {
  return typeof window !== 'undefined' ? window.electronAPI ?? null : null;
}

export async function selectProjectFromDialog(): Promise<{ path: string; name: string } | null> {
  const api = getElectronAPI();
  if (!api) return null;
  const selectedPath = await api.invoke<string | null>('project:select-dir');
  if (typeof selectedPath !== 'string' || selectedPath.length === 0) return null;
  const name = selectedPath.split(/[/\\]/).pop() || selectedPath;
  return { path: selectedPath, name };
}
