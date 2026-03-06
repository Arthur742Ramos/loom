import { expect, Page, test } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { createGitFixtureRepo, GitFixtureRepo } from '../utils/createGitFixtureRepo';
import { launchLoomApp, LoomAppContext, setProjectInStore, stabilizePageForScreenshot } from '../utils/electronApp';

const openDiscoverySections = async (page: Page): Promise<void> => {
  await page.getByRole('button', { name: 'MCP Servers' }).click();
  await page.getByRole('button', { name: 'Skills' }).click();
  await page.getByRole('button', { name: 'Agents' }).click();
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.());
};

const setDiscoveryTestState = async (
  page: Page,
  mode: 'loading' | 'error',
): Promise<void> => {
  await page.evaluate((modeValue) => {
    (window as any).__sidebarDiscoveryTestState = {
      skills: { mode: modeValue, error: 'Mock skills failure' },
      agents: { mode: modeValue, error: 'Mock agents failure' },
      mcp: { mode: modeValue, error: 'Mock MCP failure' },
    };
  }, mode);
};

const preparePopulatedDiscoveryRepo = (repoPath: string): void => {
  const githubCopilotDir = path.join(repoPath, '.github', 'copilot');
  fs.mkdirSync(path.join(githubCopilotDir, 'skills'), { recursive: true });
  fs.mkdirSync(path.join(repoPath, '.github', 'agents'), { recursive: true });
  fs.writeFileSync(path.join(repoPath, '.github', 'copilot-instructions.md'), '# Project instructions\nFollow the latest guidance.\n');
  fs.writeFileSync(path.join(githubCopilotDir, 'skills', 'build.md'), '# Build\nRun the build before opening a PR.\n');
  fs.writeFileSync(path.join(repoPath, '.github', 'agents', 'reviewer.agent.md'), '# Reviewer\nCheck changes for regressions.\n');
  fs.writeFileSync(
    path.join(githubCopilotDir, 'mcp.json'),
    JSON.stringify({
      servers: {
        cloudbuild: {
          url: 'https://example.invalid/mcp',
        },
      },
    }, null, 2),
  );
};

const prepareMcpRecoveryRepo = (repoPath: string): void => {
  preparePopulatedDiscoveryRepo(repoPath);
  fs.mkdirSync(path.join(repoPath, '.vscode'), { recursive: true });
  fs.writeFileSync(path.join(repoPath, '.vscode', 'mcp.json'), '{invalid-json');
};

const launchSidebarApp = async (
  withProject = false,
  setupRepo?: (repoPath: string) => void,
): Promise<{
  appContext: LoomAppContext;
  fixtureRepo: GitFixtureRepo | null;
}> => {
  const fixtureRepo = withProject ? createGitFixtureRepo() : null;
  if (fixtureRepo && setupRepo) {
    setupRepo(fixtureRepo.repoPath);
  }
  const appContext = await launchLoomApp();
  if (fixtureRepo) {
    await setProjectInStore(appContext.page, fixtureRepo.repoPath, 'fixture-project');
  }
  await appContext.page.evaluate(() => {
    const store = (window as any).__appStore;
    store.getState().setTheme('light');
  });
  await stabilizePageForScreenshot(appContext.page);
  return { appContext, fixtureRepo };
};

const closeSidebarApp = async (
  appContext: LoomAppContext | null,
  fixtureRepo: GitFixtureRepo | null,
): Promise<void> => {
  fixtureRepo?.cleanup();
  if (appContext) {
    await appContext.electronApp.close();
  }
};

test('matches sidebar discovery guidance without a project', async () => {
  let appContext: LoomAppContext | null = null;

  try {
    ({ appContext } = await launchSidebarApp(false));
    await openDiscoverySections(appContext.page);

    await expect(appContext.page.getByTestId('mcp-no-project')).toBeVisible();
    await expect(appContext.page.getByTestId('skills-no-project')).toBeVisible();
    await expect(appContext.page.getByTestId('agents-no-project')).toBeVisible();
    await expect(appContext.page.getByTestId('sidebar')).toHaveScreenshot('sidebar-discovery-no-project.png', { maxDiffPixelRatio: 0.03 });
  } finally {
    await closeSidebarApp(appContext, null);
  }
});

test('matches sidebar discovery empty states for a project', async () => {
  let appContext: LoomAppContext | null = null;
  let fixtureRepo: GitFixtureRepo | null = null;

  try {
    ({ appContext, fixtureRepo } = await launchSidebarApp(true));
    await openDiscoverySections(appContext.page);

    await expect(appContext.page.getByTestId('mcp-empty-state')).toBeVisible();
    await expect(appContext.page.getByTestId('skills-empty-state')).toBeVisible();
    await expect(appContext.page.getByTestId('agents-empty-state')).toBeVisible();
    await expect(appContext.page.getByTestId('sidebar')).toHaveScreenshot('sidebar-discovery-empty.png', { maxDiffPixelRatio: 0.03 });
  } finally {
    await closeSidebarApp(appContext, fixtureRepo);
  }
});

test('matches sidebar discovery loading states', async () => {
  let appContext: LoomAppContext | null = null;
  let fixtureRepo: GitFixtureRepo | null = null;

  try {
    ({ appContext, fixtureRepo } = await launchSidebarApp(true));
    await setDiscoveryTestState(appContext.page, 'loading');
    await openDiscoverySections(appContext.page);

    await expect(appContext.page.getByTestId('mcp-loading')).toBeVisible();
    await expect(appContext.page.getByTestId('skills-loading')).toBeVisible();
    await expect(appContext.page.getByTestId('agents-loading')).toBeVisible();
    await expect(appContext.page.getByTestId('sidebar')).toHaveScreenshot('sidebar-discovery-loading.png', { maxDiffPixelRatio: 0.03 });
  } finally {
    await closeSidebarApp(appContext, fixtureRepo);
  }
});

test('matches sidebar discovery error states', async () => {
  let appContext: LoomAppContext | null = null;
  let fixtureRepo: GitFixtureRepo | null = null;

  try {
    ({ appContext, fixtureRepo } = await launchSidebarApp(true));
    await setDiscoveryTestState(appContext.page, 'error');
    await openDiscoverySections(appContext.page);

    await expect(appContext.page.getByTestId('mcp-error')).toBeVisible();
    await expect(appContext.page.getByTestId('skills-error')).toBeVisible();
    await expect(appContext.page.getByTestId('agents-error')).toBeVisible();
    await expect(appContext.page.getByTestId('sidebar')).toHaveScreenshot('sidebar-discovery-errors.png', { maxDiffPixelRatio: 0.03 });
  } finally {
    await closeSidebarApp(appContext, fixtureRepo);
  }
});

test('matches sidebar discovery populated states', async () => {
  let appContext: LoomAppContext | null = null;
  let fixtureRepo: GitFixtureRepo | null = null;

  try {
    ({ appContext, fixtureRepo } = await launchSidebarApp(true, preparePopulatedDiscoveryRepo));
    await openDiscoverySections(appContext.page);

    await expect(appContext.page.getByTestId('skills-summary')).toBeVisible();
    await expect(appContext.page.getByTestId('agents-summary')).toBeVisible();
    await expect(appContext.page.getByTestId('mcp-summary')).toBeVisible();
    await expect(appContext.page.getByText('cloudbuild')).toBeVisible();
    await expect(appContext.page.getByTestId('sidebar')).toHaveScreenshot('sidebar-discovery-populated.png', { maxDiffPixelRatio: 0.03 });
  } finally {
    await closeSidebarApp(appContext, fixtureRepo);
  }
});

test('matches MCP recovery diagnostics in the sidebar', async () => {
  let appContext: LoomAppContext | null = null;
  let fixtureRepo: GitFixtureRepo | null = null;

  try {
    ({ appContext, fixtureRepo } = await launchSidebarApp(true, prepareMcpRecoveryRepo));
    await appContext.page.getByRole('button', { name: 'MCP Servers' }).click();

    await expect(appContext.page.getByTestId('mcp-diagnostics-warning')).toBeVisible();
    await expect(appContext.page.getByText('Skipped .vscode/mcp.json because it contains invalid JSON.')).toBeVisible();
    await expect(appContext.page.getByTestId('sidebar')).toHaveScreenshot('sidebar-discovery-recovery.png', { maxDiffPixelRatio: 0.03 });
  } finally {
    await closeSidebarApp(appContext, fixtureRepo);
  }
});
