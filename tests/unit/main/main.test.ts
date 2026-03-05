import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockIpcMain } from '../../utils/mockIpcMain';

describe('src/main/main.ts', () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.LOOM_TEST_MODE = '1';
  });

  const setupMainModule = async () => {
    const mockIpcMain = createMockIpcMain();
    const appListeners = new Map<string, Array<(...args: any[]) => void>>();
    const browserWindows: any[] = [];

    class MockBrowserWindow {
      public webContents: any;

      private listeners = new Map<string, (...args: any[]) => void>();

      constructor() {
        this.webContents = {
          capturePage: vi.fn(),
          executeJavaScript: vi.fn(),
          send: vi.fn(),
          openDevTools: vi.fn(),
          isDestroyed: vi.fn(() => false),
        };
        browserWindows.push(this);
      }

      loadURL = vi.fn();

      loadFile = vi.fn();

      minimize = vi.fn();

      maximize = vi.fn();

      unmaximize = vi.fn();

      close = vi.fn(() => {
        this.listeners.get('closed')?.();
      });

      isMaximized = vi.fn(() => false);

      isDestroyed = vi.fn(() => false);

      on = vi.fn((event: string, cb: (...args: any[]) => void) => {
        this.listeners.set(event, cb);
      });

      emit = (event: string, ...args: any[]) => {
        this.listeners.get(event)?.(...args);
      };
    }

    const app = {
      whenReady: vi.fn(() => Promise.resolve()),
      on: vi.fn((event: string, cb: (...args: any[]) => void) => {
        if (!appListeners.has(event)) appListeners.set(event, []);
        appListeners.get(event)!.push(cb);
      }),
      quit: vi.fn(),
    };

    vi.doMock('electron', () => ({
      app,
      BrowserWindow: MockBrowserWindow,
      ipcMain: mockIpcMain.ipcMain,
      dialog: { showOpenDialog: vi.fn().mockResolvedValue({ canceled: true, filePaths: [] }) },
      Menu: { setApplicationMenu: vi.fn() },
    }));
    vi.doMock('../../../src/main/git', () => ({ setupGitHandlers: vi.fn() }));
    vi.doMock('../../../src/main/terminal', () => ({ setupTerminalHandlers: vi.fn() }));
    vi.doMock('../../../src/main/agent', () => ({ setupAgentHandlers: vi.fn() }));
    vi.doMock('../../../src/main/auth', () => ({ setupAuthHandlers: vi.fn() }));
    vi.doMock('electron-updater', () => ({ autoUpdater: { on: vi.fn() } }));

    await import('../../../src/main/main');
    await Promise.resolve();

    return { mockIpcMain, appListeners, browserWindows };
  };

  it('re-registers test handlers when the window is recreated', async () => {
    const { mockIpcMain, appListeners, browserWindows } = await setupMainModule();
    expect(browserWindows).toHaveLength(1);

    browserWindows[0].emit('closed');
    appListeners.get('activate')?.forEach((cb) => cb());

    expect(browserWindows).toHaveLength(2);
    expect(mockIpcMain.ipcMain.removeHandler).toHaveBeenCalledWith('test:screenshot');
    expect(mockIpcMain.ipcMain.removeHandler).toHaveBeenCalledWith('test:exec');
    const removeHandlerCalls = mockIpcMain.ipcMain.removeHandler.mock.calls;
    expect(
      removeHandlerCalls.filter((call) => call[0] === 'test:screenshot'),
    ).toHaveLength(2);
    expect(
      removeHandlerCalls.filter((call) => call[0] === 'test:exec'),
    ).toHaveLength(2);
  });

  it('returns structured errors when test handlers run without an active window', async () => {
    const { mockIpcMain, browserWindows } = await setupMainModule();
    browserWindows[0].emit('closed');

    const screenshotHandler = mockIpcMain.handlers.get('test:screenshot');
    const execHandler = mockIpcMain.handlers.get('test:exec');
    expect(screenshotHandler).toBeDefined();
    expect(execHandler).toBeDefined();

    await expect(screenshotHandler?.({}, 'shot')).resolves.toEqual({
      ok: false,
      error: 'Main window unavailable',
    });
    await expect(execHandler?.({}, '1+1')).resolves.toEqual({
      ok: false,
      error: 'Main window unavailable',
    });
  });
});
