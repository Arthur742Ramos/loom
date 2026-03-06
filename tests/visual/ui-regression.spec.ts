import * as fs from 'fs';
import * as path from 'path';
import { expect, test } from '@playwright/test';
import { createGitFixtureRepo, GitFixtureRepo } from '../utils/createGitFixtureRepo';
import { launchLoomApp, LoomAppContext, setProjectInStore, stabilizePageForScreenshot } from '../utils/electronApp';

type FixtureMessage = {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  status: 'pending' | 'streaming' | 'done' | 'error';
};

let fixtureRepo: GitFixtureRepo | null = null;
let appContext: LoomAppContext | null = null;

test.beforeEach(async () => {
  fixtureRepo = createGitFixtureRepo();
  appContext = await launchLoomApp();
  await setProjectInStore(appContext.page, fixtureRepo.repoPath, 'fixture-project');

  const threadFixture = JSON.parse(
    fs.readFileSync(path.resolve(process.cwd(), 'tests/fixtures/thread-state.json'), 'utf-8'),
  ) as { title: string; messages: FixtureMessage[] };

  await appContext.page.evaluate((fixture) => {
    const store = (window as any).__appStore;
    const state = store.getState();
    const threadId = state.createThread(fixture.title, 'local');
    for (const message of fixture.messages) {
      state.addMessage(threadId, {
        ...message,
        timestamp: Date.now(),
      });
    }
    state.updateThread(threadId, { status: 'completed' });
    state.setTheme('light');
    state.setActiveThread(threadId);
  }, threadFixture);

  await stabilizePageForScreenshot(appContext.page);
});

test.afterEach(async () => {
  fixtureRepo?.cleanup();
  fixtureRepo = null;
  if (appContext) {
    await appContext.electronApp.close();
    appContext = null;
  }
});

test('matches shared shell screenshots', async () => {
  if (!appContext) throw new Error('App context not initialized');
  const { page } = appContext;
  await expect(page.getByTestId('login-button')).toContainText('Sign in with GitHub');
  await expect(page.getByTestId('project-branch-summary')).toContainText('main');
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.());

  await expect(page.getByTestId('sidebar')).toHaveScreenshot('sidebar.png', { maxDiffPixelRatio: 0.03 });
  await page.getByTestId('project-branch-switcher').selectOption('feature/neat-switcher');
  await expect(page.getByTestId('project-branch-summary')).toContainText('feature/neat-switcher');
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.());
  await expect(page.getByTestId('sidebar')).toHaveScreenshot('sidebar-branch-switcher.png', { maxDiffPixelRatio: 0.03 });
  await expect(page.getByTestId('thread-panel')).toHaveScreenshot('thread-panel.png', { maxDiffPixelRatio: 0.03 });
});
