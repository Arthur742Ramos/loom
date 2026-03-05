import { app, ipcMain } from 'electron';
import * as os from 'os';

// node-pty is loaded dynamically to avoid build issues
function loadPty(): any {
  try {
    return require('node-pty');
  } catch {
    console.warn('node-pty not available — terminal disabled');
    return null;
  }
}

const terminals = new Map<string, any>();

// Kill all terminals on app exit to prevent orphaned shell processes.
app.on('before-quit', () => {
  for (const [id, term] of terminals) {
    try { term.kill(); } catch {}
    terminals.delete(id);
  }
});

export function setupTerminalHandlers(ptyOverride?: any) {
  const pty = ptyOverride !== undefined ? ptyOverride : loadPty();
  ipcMain.handle('terminal:create', (_event, threadId: string, cwd: string) => {
    if (!pty) return { error: 'node-pty not available' };

    const shell = os.platform() === 'win32' ? 'powershell.exe' : (process.env.SHELL || '/bin/bash');

    // Sanitize environment — strip sensitive variables before passing to child shell.
    const safeEnv: Record<string, string> = {};
    const sensitiveKeys = /^(GITHUB_TOKEN|GITHUB_COPILOT_TOKEN|GH_TOKEN|AZURE_|AWS_|SECRET|PASSWORD|PRIVATE_KEY|LOOM_TEST)/i;
    for (const [k, v] of Object.entries(process.env)) {
      if (v !== undefined && !sensitiveKeys.test(k)) {
        safeEnv[k] = v;
      }
    }

    const term = pty.spawn(shell, [], {
      name: 'xterm-256color',
      cols: 120,
      rows: 30,
      cwd,
      env: safeEnv,
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
