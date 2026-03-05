import { ipcMain, shell, safeStorage, app } from 'electron';
import { execSync } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';

const GITHUB_CLIENT_ID = 'Iv1.b507a08c87ecfe98';
const DEVICE_CODE_URL = 'https://github.com/login/device/code';
const ACCESS_TOKEN_URL = 'https://github.com/login/oauth/access_token';

interface GitHubUser {
  login: string;
  name: string | null;
  avatar_url: string;
}

// --- Token persistence via Electron safeStorage ---

function getTokenPath(): string {
  return path.join(app.getPath('userData'), '.loom-token');
}

function loadStoredToken(): string | null {
  try {
    const tokenPath = getTokenPath();
    if (!fs.existsSync(tokenPath)) return null;
    const data = fs.readFileSync(tokenPath);
    if (safeStorage.isEncryptionAvailable()) {
      return safeStorage.decryptString(data);
    }
    return data.toString('utf-8');
  } catch {
    return null;
  }
}

function storeToken(token: string): void {
  try {
    const tokenPath = getTokenPath();
    if (safeStorage.isEncryptionAvailable()) {
      fs.writeFileSync(tokenPath, safeStorage.encryptString(token));
    } else {
      fs.writeFileSync(tokenPath, token, 'utf-8');
    }
  } catch {
    // Token won't persist across restarts
  }
}

function clearStoredToken(): void {
  try {
    const tokenPath = getTokenPath();
    if (fs.existsSync(tokenPath)) fs.unlinkSync(tokenPath);
  } catch {}
}

// --- GitHub helpers ---

function getTestUser(): GitHubUser | null {
  const raw = process.env.LOOM_TEST_AUTH_USER;
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed?.login || !parsed?.avatar_url) return null;
    return { login: parsed.login, name: parsed.name ?? null, avatar_url: parsed.avatar_url };
  } catch {
    return null;
  }
}

async function getTokenFromGhCli(): Promise<string | null> {
  try {
    const token = execSync('gh auth token', { encoding: 'utf-8', timeout: 10000 }).trim();
    return token || null;
  } catch {
    return null;
  }
}

async function getToken(): Promise<string | null> {
  return (
    process.env.GITHUB_TOKEN ||
    process.env.GITHUB_COPILOT_TOKEN ||
    loadStoredToken() ||
    (await getTokenFromGhCli())
  );
}

async function fetchGitHubUser(token: string): Promise<GitHubUser | null> {
  try {
    const response = await fetch('https://api.github.com/user', {
      headers: { Authorization: `Bearer ${token}`, 'User-Agent': 'Loom' },
    });
    if (!response.ok) return null;
    const data = await response.json();
    return { login: data.login, name: data.name, avatar_url: data.avatar_url };
  } catch {
    return null;
  }
}

// --- Device flow polling ---

let activeDeviceFlowAbort: AbortController | null = null;

async function pollForToken(
  sender: Electron.WebContents,
  deviceCode: string,
  interval: number,
  expiresIn: number,
): Promise<void> {
  if (activeDeviceFlowAbort) activeDeviceFlowAbort.abort();
  const abort = new AbortController();
  activeDeviceFlowAbort = abort;

  const deadline = Date.now() + expiresIn * 1000;
  let pollInterval = Math.max(interval, 5) * 1000;

  while (Date.now() < deadline && !abort.signal.aborted) {
    await new Promise((resolve) => setTimeout(resolve, pollInterval));
    if (abort.signal.aborted) return;

    try {
      const response = await fetch(ACCESS_TOKEN_URL, {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: GITHUB_CLIENT_ID,
          device_code: deviceCode,
          grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        }),
      });

      const data = await response.json();

      if (data.access_token) {
        storeToken(data.access_token);
        const user = await fetchGitHubUser(data.access_token);
        try { sender.send('auth:login-complete', { authenticated: true, user }); } catch {}
        activeDeviceFlowAbort = null;
        return;
      }

      if (data.error === 'slow_down') {
        pollInterval += 5000;
        continue;
      }

      if (data.error === 'expired_token' || data.error === 'access_denied') {
        try { sender.send('auth:login-complete', { authenticated: false, error: data.error }); } catch {}
        activeDeviceFlowAbort = null;
        return;
      }
      // authorization_pending — keep polling
    } catch {
      // Network error — retry on next interval
    }
  }
  activeDeviceFlowAbort = null;
}

// --- IPC handlers ---

export function setupAuthHandlers() {
  ipcMain.handle('auth:get-user', async () => {
    if (process.env.LOOM_TEST_MODE === '1') {
      const testUser = getTestUser();
      return testUser ? { authenticated: true, user: testUser } : { authenticated: false };
    }

    const token = await getToken();
    if (!token) return { authenticated: false };
    const user = await fetchGitHubUser(token);
    if (!user) return { authenticated: false };
    return { authenticated: true, user };
  });

  // OAuth Device Flow login
  ipcMain.handle('auth:login', async (_event) => {
    if (process.env.LOOM_TEST_MODE === '1') {
      return { success: true, message: 'Test mode login' };
    }

    try {
      const codeResponse = await fetch(DEVICE_CODE_URL, {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: GITHUB_CLIENT_ID, scope: 'read:user' }),
      });

      if (!codeResponse.ok) {
        return { success: false, error: 'Failed to initiate GitHub login' };
      }

      const { device_code, user_code, verification_uri, expires_in, interval } =
        await codeResponse.json();

      shell.openExternal(verification_uri);
      pollForToken(_event.sender, device_code, interval, expires_in);

      return {
        success: true,
        userCode: user_code,
        verificationUri: verification_uri,
        expiresIn: expires_in,
      };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // Cancel an in-progress device flow
  ipcMain.handle('auth:login-cancel', () => {
    if (activeDeviceFlowAbort) {
      activeDeviceFlowAbort.abort();
      activeDeviceFlowAbort = null;
    }
    return { success: true };
  });

  // Logout — clear stored token and gh CLI session
  ipcMain.handle('auth:logout', async () => {
    if (process.env.LOOM_TEST_MODE === '1') {
      return { success: true };
    }

    if (activeDeviceFlowAbort) {
      activeDeviceFlowAbort.abort();
      activeDeviceFlowAbort = null;
    }

    clearStoredToken();

    try {
      execSync('gh auth logout -h github.com', { encoding: 'utf-8', input: 'Y\n', timeout: 10000 });
    } catch {
      // Already logged out or gh not installed
    }

    return { success: true };
  });
}
