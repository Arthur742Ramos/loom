import { app, BrowserWindow, ipcMain, dialog, Menu } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { setupGitHandlers } from './git';
import { setupTerminalHandlers } from './terminal';
import { setupAgentHandlers } from './agent';
import { setupAuthHandlers } from './auth';
import { autoUpdater } from 'electron-updater';

// Suppress ERR_STREAM_DESTROYED rejections from vscode-jsonrpc when the
// Copilot SDK's underlying process exits between messages.  The agent
// module's retry logic already handles reconnection; these extra rejections
// originate from queued writes inside the SDK that nobody awaits.
process.on('unhandledRejection', (reason: unknown) => {
  if (
    reason instanceof Error &&
    /ERR_STREAM_DESTROYED|write after a stream was destroyed/i.test(reason.message)
  ) {
    return; // swallowed – reconnection is handled in agent.ts
  }
  console.error('Unhandled rejection:', reason);
});

let mainWindow: BrowserWindow | null = null;

if (process.env.LOOM_TEST_MODE === '1') {
  const loomTestUserDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'loom-test-user-data-'));
  if (typeof app.setPath === 'function') {
    app.setPath('userData', loomTestUserDataDir);
  }
}

const getErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

function getMainWebContents(): Electron.WebContents | null {
  if (!mainWindow || mainWindow.isDestroyed()) return null;
  if (mainWindow.webContents.isDestroyed()) return null;
  return mainWindow.webContents;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#ece9e6',
    transparent: false,
    titleBarStyle: 'hiddenInset',
    frame: true,
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      preload: path.join(__dirname, 'preload.js'),
    },
    icon: path.join(__dirname, '..', 'renderer', 'icon.png'),
  });

  if (process.env.DEV_SERVER === '1') {
    mainWindow.loadURL('http://localhost:9000');
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  }

  // Remove the default menu bar (File, Edit, View, etc.)
  Menu.setApplicationMenu(null);

  // Expose screenshot helper via IPC for testing
  ipcMain.removeHandler('test:screenshot');
  ipcMain.handle('test:screenshot', async (_event, name: string) => {
    try {
      const webContents = getMainWebContents();
      if (!webContents) return { ok: false, error: 'Main window unavailable' };
      const image = await webContents.capturePage();
      const dir = path.join(__dirname, '..', '..', 'test-screenshots');
       if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
       fs.writeFileSync(path.join(dir, `${name}.png`), image.toPNG());
       return { ok: true, path: path.join(dir, `${name}.png`) };
     } catch (error: unknown) {
       return { ok: false, error: getErrorMessage(error) };
     }
   });

  // Expose executeJavaScript helper
  ipcMain.removeHandler('test:exec');
  ipcMain.handle('test:exec', async (_event, js: string) => {
    const webContents = getMainWebContents();
    if (!webContents) return { ok: false, error: 'Main window unavailable' };
    return webContents.executeJavaScript(js);
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  createWindow();
  setupGitHandlers();
  setupTerminalHandlers();
  setupAgentHandlers();
  setupAuthHandlers();

  // Window control IPC
  ipcMain.on('window:minimize', () => mainWindow?.minimize());
  ipcMain.on('window:maximize', () => {
    if (mainWindow?.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow?.maximize();
    }
  });
  ipcMain.on('window:close', () => mainWindow?.close());

  // Directory picker
  ipcMain.handle('project:select-dir', async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      properties: ['openDirectory'],
      title: 'Select Project Folder',
    });
    return result.canceled ? null : result.filePaths[0];
  });

  ipcMain.handle('app:get-version', async () => ({ version: app.getVersion() }));

  // Auto-update — checks GitHub Releases for new versions
  if (process.env.NODE_ENV !== 'development' && process.env.LOOM_TEST_MODE !== '1') {
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.logger = null; // suppress verbose logging

    autoUpdater.on('update-available', (info) => {
      mainWindow?.webContents.send('updater:status', {
        status: 'available',
        version: info.version,
      });
    });

    autoUpdater.on('update-downloaded', (info) => {
      mainWindow?.webContents.send('updater:status', {
        status: 'downloaded',
        version: info.version,
      });
    });

    autoUpdater.on('error', (err) => {
      console.error('Auto-update error:', err.message);
    });

    // Check for updates after a short delay to not slow down startup
    setTimeout(() => autoUpdater.checkForUpdates().catch(() => {}), 5000);

    // IPC for manual check / install
    ipcMain.handle('updater:check', async () => {
      try {
        const result = await autoUpdater.checkForUpdates();
        return { available: !!result?.updateInfo, version: result?.updateInfo?.version };
      } catch {
        return { available: false };
      }
    });

    ipcMain.on('updater:install', () => {
      autoUpdater.quitAndInstall(false, true);
    });
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow();
  }
});
