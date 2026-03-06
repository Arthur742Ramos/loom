import { expect, Page, test } from '@playwright/test';
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

const launchSidebarApp = async (withProject = false): Promise<{
  appContext: LoomAppContext;
  fixtureRepo: GitFixtureRepo | null;
}> => {
  const fixtureRepo = withProject ? createGitFixtureRepo() : null;
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
