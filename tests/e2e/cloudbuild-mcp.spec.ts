import { expect, test } from '@playwright/test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { launchLoomApp, LoomAppContext, setProjectInStore } from '../utils/electronApp';

test('loads CloudBuild MCP auth headers from project config', async () => {
  const repoPath = fs.mkdtempSync(path.join(os.tmpdir(), 'loom-cloudbuild-mcp-'));
  const mcpDir = path.join(repoPath, '.vscode');
  fs.mkdirSync(mcpDir, { recursive: true });
  fs.writeFileSync(
    path.join(mcpDir, 'mcp.json'),
    JSON.stringify({
      servers: {
        cloudbuild: {
          type: 'http',
          url: 'https://cloudbuildmcp.azurewebsites.net/cloudbuildmcp/',
          headers: { Authorization: 'Bearer test-token' },
        },
      },
    }),
  );

  let appContext: LoomAppContext | null = null;
  try {
    appContext = await launchLoomApp();
    await setProjectInStore(appContext.page, repoPath, 'cloudbuild');

    const projectMcp = await appContext.page.evaluate(async (projectPath) => (
      await (window as any).electronAPI.invoke('agent:list-project-mcp', projectPath)
    ), repoPath);

    expect(projectMcp).toMatchObject({
      cloudbuild: {
        type: 'http',
        url: 'https://cloudbuildmcp.azurewebsites.net/cloudbuildmcp/',
        headers: { Authorization: 'Bearer test-token' },
        tools: ['*'],
      },
    });
  } finally {
    if (appContext) {
      await appContext.electronApp.close();
    }
    fs.rmSync(repoPath, { recursive: true, force: true });
  }
});
