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

const getErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const warnAuthIssue = (message: string, error: unknown): void => {
  console.warn(`[auth] ${message}: ${getErrorMessage(error)}`);
};

// --- Token persistence via Electron safeStorage ---

/** Resolve the on-disk token location used for persisted auth state. */
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
  } catch (error: unknown) {
    warnAuthIssue('Failed to load stored token', error);
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
  } catch (error: unknown) {
    warnAuthIssue('Failed to persist token', error);
  }
}

function clearStoredToken(): void {
  try {
    const tokenPath = getTokenPath();
    if (fs.existsSync(tokenPath)) fs.unlinkSync(tokenPath);
  } catch (error: unknown) {
    warnAuthIssue('Failed to clear stored token', error);
  }
}

// --- GitHub helpers ---

function getTestUser(): GitHubUser | null {
  const raw = process.env.LOOM_TEST_AUTH_USER;
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed?.login || !parsed?.avatar_url) return null;
    return { login: parsed.login, name: parsed.name ?? null, avatar_url: parsed.avatar_url };
  } catch (error: unknown) {
    warnAuthIssue('Failed to parse LOOM_TEST_AUTH_USER', error);
    return null;
  }
}

async function getTokenFromGhCli(): Promise<string | null> {
  try {
    const token = execSync('gh auth token', { encoding: 'utf-8', timeout: 10000 }).trim();
    return token || null;
  } catch (error: unknown) {
    warnAuthIssue('Failed to read GitHub token from gh CLI', error);
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
  } catch (error: unknown) {
    warnAuthIssue('Failed to fetch GitHub user', error);
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
    } catch (error: unknown) {
      warnAuthIssue('Device flow polling failed', error);
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
        return {
          success: false,
          error: `Failed to initiate GitHub login (HTTP ${codeResponse.status})`,
        };
      }

      const payload = await codeResponse.json() as Record<string, unknown>;
      const deviceCode = typeof payload.device_code === 'string' ? payload.device_code : '';
      const userCode = typeof payload.user_code === 'string' ? payload.user_code : '';
      const verificationUri = typeof payload.verification_uri === 'string' ? payload.verification_uri : '';
      const expiresIn = typeof payload.expires_in === 'number' ? payload.expires_in : 0;
      const interval = typeof payload.interval === 'number' ? payload.interval : 0;

      if (!deviceCode || !userCode || !verificationUri || expiresIn <= 0 || interval <= 0) {
        return { success: false, error: 'GitHub login response was missing required device-flow fields' };
      }

      shell.openExternal(verificationUri);
      pollForToken(_event.sender, deviceCode, interval, expiresIn);

      return {
        success: true,
        userCode,
        verificationUri,
        expiresIn,
      };
    } catch (err: unknown) {
      return { success: false, error: `GitHub login failed: ${getErrorMessage(err)}` };
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
    } catch (error: unknown) {
      warnAuthIssue('Failed to logout from gh CLI', error);
    }

    return { success: true };
  });
}
