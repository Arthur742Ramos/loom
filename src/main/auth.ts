import { ipcMain, shell } from 'electron';

interface GitHubUser {
  login: string;
  name: string | null;
  avatar_url: string;
}

async function getTokenFromGhCli(): Promise<string | null> {
  try {
    const { execSync } = require('child_process');
    const token = execSync('gh auth token', { encoding: 'utf-8' }).trim();
    return token || null;
  } catch {
    return null;
  }
}

async function getToken(): Promise<string | null> {
  return (
    process.env.GITHUB_TOKEN ||
    process.env.GITHUB_COPILOT_TOKEN ||
    (await getTokenFromGhCli())
  );
}

async function fetchGitHubUser(token: string): Promise<GitHubUser | null> {
  try {
    const response = await fetch('https://api.github.com/user', {
      headers: {
        Authorization: `Bearer ${token}`,
        'User-Agent': 'Loom',
      },
    });
    if (!response.ok) return null;
    const data = await response.json();
    return {
      login: data.login,
      name: data.name,
      avatar_url: data.avatar_url,
    };
  } catch {
    return null;
  }
}

export function setupAuthHandlers() {
  // Try to get the current user from existing credentials
  ipcMain.handle('auth:get-user', async () => {
    const token = await getToken();
    if (!token) return { authenticated: false };
    const user = await fetchGitHubUser(token);
    if (!user) return { authenticated: false };
    return { authenticated: true, user };
  });

  // Login via gh CLI device flow
  ipcMain.handle('auth:login', async () => {
    try {
      const { execFileSync } = require('child_process');
      // Check if gh is installed
      try {
        execFileSync('gh', ['--version'], { encoding: 'utf-8' });
      } catch {
        // gh CLI not installed — open install page
        shell.openExternal('https://cli.github.com');
        return { success: false, error: 'GitHub CLI not installed. Opening install page...' };
      }

      // Launch gh auth login in a visible terminal so user can complete the flow
      const { spawn } = require('child_process');
      const isWin = process.platform === 'win32';

      if (isWin) {
        spawn('cmd.exe', ['/c', 'start', 'cmd', '/k', 'gh auth login -h github.com -p https -w'], {
          detached: true,
          stdio: 'ignore',
        }).unref();
      } else {
        const termCmd =
          process.platform === 'darwin'
            ? ['open', ['-a', 'Terminal', '--args', 'gh', 'auth', 'login', '-h', 'github.com', '-p', 'https', '-w']]
            : ['x-terminal-emulator', ['-e', 'gh auth login -h github.com -p https -w']];
        spawn(termCmd[0] as string, termCmd[1] as string[], {
          detached: true,
          stdio: 'ignore',
        }).unref();
      }

      return { success: true, message: 'Login window opened. Complete login in the terminal, then click "Check login status".' };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // Logout
  ipcMain.handle('auth:logout', async () => {
    try {
      const { execSync } = require('child_process');
      execSync('gh auth logout -h github.com', { encoding: 'utf-8', input: 'Y\n' });
      return { success: true };
    } catch {
      return { success: true }; // Already logged out
    }
  });
}
