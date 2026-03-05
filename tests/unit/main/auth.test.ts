import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockIpcMain } from '../../utils/mockIpcMain';

const { execSyncMock, execFileSyncMock, spawnMock } = vi.hoisted(() => ({
  execSyncMock: vi.fn(),
  execFileSyncMock: vi.fn(),
  spawnMock: vi.fn(() => ({ unref: vi.fn() })),
}));

describe('src/main/auth.ts', () => {
  beforeEach(() => {
    vi.resetModules();
    delete process.env.LOOM_TEST_MODE;
    delete process.env.LOOM_TEST_AUTH_USER;
    delete process.env.GITHUB_TOKEN;
    delete process.env.GITHUB_COPILOT_TOKEN;

    vi.doMock('child_process', () => ({
      execSync: execSyncMock,
      execFileSync: execFileSyncMock,
      spawn: spawnMock,
    }));
  });

  it('auth:get-user returns test user in test mode', async () => {
    process.env.LOOM_TEST_MODE = '1';
    process.env.LOOM_TEST_AUTH_USER = JSON.stringify({
      login: 'testuser',
      name: 'Test User',
      avatar_url: 'https://example.com/avatar.png',
    });

    const mockIpcMain = createMockIpcMain();
    vi.doMock('electron', () => ({ ipcMain: mockIpcMain.ipcMain, shell: { openExternal: vi.fn() } }));

    const { setupAuthHandlers } = await import('../../../src/main/auth');
    setupAuthHandlers();

    const result = await mockIpcMain.invoke('auth:get-user');
    expect(result).toEqual({
      authenticated: true,
      user: {
        login: 'testuser',
        name: 'Test User',
        avatar_url: 'https://example.com/avatar.png',
      },
    });
  });

  it('auth:get-user returns authenticated:false when no token available', async () => {
    execSyncMock.mockImplementation(() => {
      throw new Error('gh not found');
    });

    const mockIpcMain = createMockIpcMain();
    vi.doMock('electron', () => ({ ipcMain: mockIpcMain.ipcMain, shell: { openExternal: vi.fn() } }));

    const { setupAuthHandlers } = await import('../../../src/main/auth');
    setupAuthHandlers();

    const result = await mockIpcMain.invoke('auth:get-user');
    expect(result).toEqual({ authenticated: false });
  });

  it('auth:get-user returns user when GITHUB_TOKEN is set', async () => {
    process.env.GITHUB_TOKEN = 'ghp_test123';

    const mockUser = { login: 'ghuser', name: 'GH User', avatar_url: 'https://example.com/gh.png' };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue(mockUser),
    });
    vi.stubGlobal('fetch', fetchMock);

    const mockIpcMain = createMockIpcMain();
    vi.doMock('electron', () => ({ ipcMain: mockIpcMain.ipcMain, shell: { openExternal: vi.fn() } }));

    const { setupAuthHandlers } = await import('../../../src/main/auth');
    setupAuthHandlers();

    const result = await mockIpcMain.invoke('auth:get-user');
    expect(result).toEqual({
      authenticated: true,
      user: {
        login: 'ghuser',
        name: 'GH User',
        avatar_url: 'https://example.com/gh.png',
      },
    });
    expect(fetchMock).toHaveBeenCalledWith('https://api.github.com/user', {
      headers: {
        Authorization: 'Bearer ghp_test123',
        'User-Agent': 'Loom',
      },
    });

    vi.unstubAllGlobals();
  });

  it('auth:login in test mode returns success', async () => {
    process.env.LOOM_TEST_MODE = '1';

    const mockIpcMain = createMockIpcMain();
    vi.doMock('electron', () => ({ ipcMain: mockIpcMain.ipcMain, shell: { openExternal: vi.fn() } }));

    const { setupAuthHandlers } = await import('../../../src/main/auth');
    setupAuthHandlers();

    const result = await mockIpcMain.invoke('auth:login');
    expect(result).toEqual({ success: true, message: 'Test mode login' });
  });

  it('auth:logout in test mode returns success', async () => {
    process.env.LOOM_TEST_MODE = '1';

    const mockIpcMain = createMockIpcMain();
    vi.doMock('electron', () => ({ ipcMain: mockIpcMain.ipcMain, shell: { openExternal: vi.fn() } }));

    const { setupAuthHandlers } = await import('../../../src/main/auth');
    setupAuthHandlers();

    const result = await mockIpcMain.invoke('auth:logout');
    expect(result).toEqual({ success: true });
  });

  it('getTokenFromGhCli returns null on timeout', async () => {
    execSyncMock.mockImplementation(() => {
      const err = new Error('Command timed out');
      (err as any).killed = true;
      throw err;
    });

    const mockIpcMain = createMockIpcMain();
    vi.doMock('electron', () => ({ ipcMain: mockIpcMain.ipcMain, shell: { openExternal: vi.fn() } }));

    const { setupAuthHandlers } = await import('../../../src/main/auth');
    setupAuthHandlers();

    const result = await mockIpcMain.invoke('auth:get-user');
    expect(result).toEqual({ authenticated: false });
    expect(execSyncMock).toHaveBeenCalledWith('gh auth token', { encoding: 'utf-8', timeout: 10000 });
  });
});
