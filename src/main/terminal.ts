import { ipcMain } from 'electron';
import * as os from 'os';

// node-pty is loaded dynamically to avoid build issues
let pty: any;
try {
  pty = require('node-pty');
} catch {
  console.warn('node-pty not available — terminal disabled');
}

const terminals = new Map<string, any>();

export function setupTerminalHandlers() {
  ipcMain.handle('terminal:create', (_event, threadId: string, cwd: string) => {
    if (!pty) return { error: 'node-pty not available' };

    const shell = os.platform() === 'win32' ? 'powershell.exe' : (process.env.SHELL || '/bin/bash');
    const term = pty.spawn(shell, [], {
      name: 'xterm-256color',
      cols: 120,
      rows: 30,
      cwd,
      env: process.env as Record<string, string>,
    });

    terminals.set(threadId, term);

    term.onData((data: string) => {
      _event.sender.send('terminal:data', threadId, data);
    });

    term.onExit(() => {
      terminals.delete(threadId);
    });

    return { pid: term.pid };
  });

  ipcMain.on('terminal:data', (_event, threadId: string, data: string) => {
    const term = terminals.get(threadId);
    if (term) term.write(data);
  });

  ipcMain.on('terminal:resize', (_event, threadId: string, cols: number, rows: number) => {
    const term = terminals.get(threadId);
    if (term) term.resize(cols, rows);
  });

  ipcMain.on('terminal:dispose', (_event, threadId: string) => {
    const term = terminals.get(threadId);
    if (term) {
      term.kill();
      terminals.delete(threadId);
    }
  });
}
