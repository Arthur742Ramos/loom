import { describe, it, expect, vi, beforeEach } from 'vitest';
import { cn, getElectronAPI, selectProjectFromDialog } from '../../../src/renderer/lib/utils';

describe('cn', () => {
  it('merges class names', () => {
    expect(cn('foo', 'bar')).toBe('foo bar');
  });

  it('handles conditional classes', () => {
    expect(cn('base', false && 'hidden', 'end')).toBe('base end');
  });

  it('deduplicates tailwind classes', () => {
    expect(cn('p-2', 'p-4')).toBe('p-4');
  });

  it('handles empty input', () => {
    expect(cn()).toBe('');
  });
});

describe('getElectronAPI', () => {
  beforeEach(() => {
    delete (window as Record<string, unknown>).electronAPI;
  });

  it('returns null when electronAPI is not defined', () => {
    expect(getElectronAPI()).toBeNull();
  });

  it('returns the API when defined', () => {
    const mockApi = { invoke: vi.fn() };
    (window as Record<string, unknown>).electronAPI = mockApi;
    expect(getElectronAPI()).toBe(mockApi);
  });
});

describe('selectProjectFromDialog', () => {
  beforeEach(() => {
    delete (window as Record<string, unknown>).electronAPI;
  });

  it('returns null without electronAPI', async () => {
    expect(await selectProjectFromDialog()).toBeNull();
  });

  it('returns null when dialog is cancelled', async () => {
    (window as Record<string, unknown>).electronAPI = {
      invoke: vi.fn().mockResolvedValue(null),
    };
    expect(await selectProjectFromDialog()).toBeNull();
  });

  it('returns path and name for selected directory', async () => {
    (window as Record<string, unknown>).electronAPI = {
      invoke: vi.fn().mockResolvedValue('/home/user/my-project'),
    };
    const result = await selectProjectFromDialog();
    expect(result).toEqual({ path: '/home/user/my-project', name: 'my-project' });
  });

  it('handles paths with backslashes (Windows)', async () => {
    (window as Record<string, unknown>).electronAPI = {
      invoke: vi.fn().mockResolvedValue('C:\\Users\\dev\\project'),
    };
    const result = await selectProjectFromDialog();
    expect(result).toEqual({ path: 'C:\\Users\\dev\\project', name: 'project' });
  });
});
