import { app, BrowserWindow, ipcMain, dialog, Menu } from 'electron';
import * as path from 'path';
import { setupGitHandlers } from './git';
import { setupTerminalHandlers } from './terminal';
import { setupAgentHandlers } from './agent';
import { setupAuthHandlers } from './auth';

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
      nodeIntegration: true,
      contextIsolation: false,
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
  ipcMain.handle('test:screenshot', async (_event, name: string) => {
    try {
      const image = await mainWindow!.webContents.capturePage();
      const dir = path.join(__dirname, '..', '..', 'test-screenshots');
      if (!require('fs').existsSync(dir)) require('fs').mkdirSync(dir, { recursive: true });
      require('fs').writeFileSync(path.join(dir, `${name}.png`), image.toPNG());
      return { ok: true, path: path.join(dir, `${name}.png`) };
    } catch (e: any) {
      return { ok: false, error: e.message };
    }
  });

  // Expose executeJavaScript helper
  ipcMain.handle('test:exec', async (_event, js: string) => {
    return mainWindow!.webContents.executeJavaScript(js);
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
