import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockIpcMain } from '../../utils/mockIpcMain';

const { execSyncMock } = vi.hoisted(() => ({
  execSyncMock: vi.fn(),
}));

const existsSyncMock = vi.fn(() => false);

describe('src/main/auth.ts', () => {
  let mockIpcMain: ReturnType<typeof createMockIpcMain>;

  beforeEach(() => {
    vi.resetModules();
    delete process.env.LOOM_TEST_MODE;
    delete process.env.LOOM_TEST_AUTH_USER;
    delete process.env.GITHUB_TOKEN;
    delete process.env.GITHUB_COPILOT_TOKEN;

    existsSyncMock.mockReturnValue(false);
    mockIpcMain = createMockIpcMain();

    vi.doMock('child_process', () => ({ execSync: execSyncMock }));
    vi.doMock('fs', () => ({
      existsSync: existsSyncMock,
      readFileSync: vi.fn(),
      writeFileSync: vi.fn(),
      unlinkSync: vi.fn(),
    }));
    vi.doMock('path', () => ({
      join: vi.fn((...parts: string[]) => parts.join('/')),
    }));
    vi.doMock('electron', () => ({
      ipcMain: mockIpcMain.ipcMain,
      shell: { openExternal: vi.fn() },
      safeStorage: {
        isEncryptionAvailable: vi.fn(() => false),
        encryptString: vi.fn((s: string) => Buffer.from(s)),
        decryptString: vi.fn((b: Buffer) => b.toString()),
      },
      app: { getPath: vi.fn(() => '/tmp/test-app') },
    }));
  });

  it('auth:get-user returns test user in test mode', async () => {
    process.env.LOOM_TEST_MODE = '1';
    process.env.LOOM_TEST_AUTH_USER = JSON.stringify({
      login: 'testuser',
      name: 'Test User',
      avatar_url: 'https://example.com/avatar.png',
    });

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

    const { setupAuthHandlers } = await import('../../../src/main/auth');
    setupAuthHandlers();

    const result = await mockIpcMain.invoke('auth:get-user');
    expect(result).toEqual({
      authenticated: true,
      user: { login: 'ghuser', name: 'GH User', avatar_url: 'https://example.com/gh.png' },
    });
    expect(fetchMock).toHaveBeenCalledWith('https://api.github.com/user', {
      headers: { Authorization: 'Bearer ghp_test123', 'User-Agent': 'Loom' },
    });

    vi.unstubAllGlobals();
  });

  it('auth:login in test mode returns success', async () => {
    process.env.LOOM_TEST_MODE = '1';

    const { setupAuthHandlers } = await import('../../../src/main/auth');
    setupAuthHandlers();

    const result = await mockIpcMain.invoke('auth:login');
    expect(result).toEqual({ success: true, message: 'Test mode login' });
  });

  it('auth:login starts device flow and returns user code', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        device_code: 'device-123',
        user_code: 'ABCD-1234',
        verification_uri: 'https://github.com/login/device',
        expires_in: 900,
        interval: 5,
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const { setupAuthHandlers } = await import('../../../src/main/auth');
    setupAuthHandlers();

    const handler = mockIpcMain.handlers.get('auth:login')!;
    const result = await handler({ sender: { send: vi.fn() } });
    expect(result).toEqual({
      success: true,
      userCode: 'ABCD-1234',
      verificationUri: 'https://github.com/login/device',
      expiresIn: 900,
    });

    vi.unstubAllGlobals();
  });

  it('auth:logout in test mode returns success', async () => {
    process.env.LOOM_TEST_MODE = '1';

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

    const { setupAuthHandlers } = await import('../../../src/main/auth');
    setupAuthHandlers();

    const result = await mockIpcMain.invoke('auth:get-user');
    expect(result).toEqual({ authenticated: false });
    expect(execSyncMock).toHaveBeenCalledWith('gh auth token', { encoding: 'utf-8', timeout: 10000 });
  });
});
