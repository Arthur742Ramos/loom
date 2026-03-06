import { execSync } from 'node:child_process';

const failures = [];
const warnings = [];

const log = (message) => {
  console.log(`[live-smoke] ${message}`);
};

const errorMessage = (error) => {
  if (error instanceof Error) return error.message;
  return String(error);
};

const runCommand = (command) => {
  try {
    return execSync(command, {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  } catch (error) {
    const stderr = error && typeof error === 'object' && 'stderr' in error
      ? String(error.stderr || '').trim()
      : '';
    const stdout = error && typeof error === 'object' && 'stdout' in error
      ? String(error.stdout || '').trim()
      : '';
    const details = stderr || stdout || errorMessage(error);
    throw new Error(`${command} failed: ${details}`);
  }
};

const findCopilotPath = () => {
  try {
    if (process.platform === 'win32') {
      const out = runCommand('where.exe copilot.exe copilot.cmd copilot');
      const candidates = out.split(/\r?\n/).map((entry) => entry.trim()).filter(Boolean);
      return candidates.find((entry) => !entry.includes('node_modules')) || candidates[0];
    }
    return runCommand('which copilot').split(/\r?\n/)[0];
  } catch {
    return 'copilot';
  }
};

const runCheck = async (name, fn) => {
  try {
    await fn();
  } catch (error) {
    const message = `${name} check failed: ${errorMessage(error)}`;
    failures.push(message);
    log(`ERROR: ${message}`);
  }
};

await runCheck('GitHub auth', async () => {
  runCommand('gh auth status -h github.com');
  const token = runCommand('gh auth token');
  if (!token) {
    throw new Error('gh auth token returned an empty token');
  }
  const userResponse = await fetch('https://api.github.com/user', {
    headers: {
      Authorization: `Bearer ${token}`,
      'User-Agent': 'loom-live-smoke',
    },
  });
  if (!userResponse.ok) {
    throw new Error(`GitHub user lookup returned HTTP ${userResponse.status}`);
  }
  const user = await userResponse.json();
  log(`GitHub auth OK (@${user.login || 'unknown'}).`);
});

await runCheck('Copilot CLI', async () => {
  const cliPath = findCopilotPath();
  const versionOut = runCommand(`"${cliPath}" --version`);
  if (!versionOut) {
    throw new Error('copilot --version returned empty output');
  }
  log(`Copilot CLI detected (${versionOut.split(/\r?\n/)[0]}).`);
});

await runCheck('Copilot model listing', async () => {
  const { CopilotClient } = await import('@github/copilot-sdk');
  const client = new CopilotClient({
    cliPath: findCopilotPath(),
  });
  try {
    await client.start?.();
    client.modelsCache = null;
    const models = await client.listModels();
    if (!Array.isArray(models) || models.length === 0) {
      throw new Error('No models were returned from Copilot SDK');
    }
    log(`Copilot SDK returned ${models.length} model(s).`);
  } finally {
    await (client.forceStop ?? client.stop)?.call(client);
  }
});

await runCheck('MCP endpoint reachability', async () => {
  const mcpUrl = process.env.LOOM_LIVE_MCP_URL?.trim();
  if (!mcpUrl) {
    warnings.push('LOOM_LIVE_MCP_URL is not set; MCP reachability check skipped.');
    log('MCP check skipped (LOOM_LIVE_MCP_URL not configured).');
    return;
  }

  const headers = {
    'User-Agent': 'loom-live-smoke',
  };
  const rawAuthHeader = process.env.LOOM_LIVE_MCP_AUTH_HEADER?.trim();
  if (rawAuthHeader) {
    const separatorIndex = rawAuthHeader.indexOf(':');
    if (separatorIndex > 0) {
      const key = rawAuthHeader.slice(0, separatorIndex).trim();
      const value = rawAuthHeader.slice(separatorIndex + 1).trim();
      if (key && value) {
        headers[key] = value;
      }
    } else {
      headers.Authorization = rawAuthHeader;
    }
  }

  const response = await fetch(mcpUrl, { method: 'GET', headers });
  if (response.status >= 500) {
    throw new Error(`MCP endpoint returned HTTP ${response.status}`);
  }
  if (response.status === 401 || response.status === 403) {
    warnings.push(`MCP endpoint reachable but unauthorized (HTTP ${response.status}).`);
    log(`MCP endpoint reachable but unauthorized (HTTP ${response.status}).`);
    return;
  }
  if (!response.ok) {
    throw new Error(`MCP endpoint returned HTTP ${response.status}`);
  }
  log(`MCP endpoint reachable (HTTP ${response.status}).`);
});

if (warnings.length > 0) {
  for (const warning of warnings) {
    log(`WARNING: ${warning}`);
  }
}

if (failures.length > 0) {
  for (const failure of failures) {
    console.error(`[live-smoke] ${failure}`);
  }
  process.exit(1);
}

log('All live integration smoke checks passed.');
