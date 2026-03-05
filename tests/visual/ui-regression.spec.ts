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

let fixtureRepo: GitFixtureRepo;
let appContext: LoomAppContext;

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
  fixtureRepo.cleanup();
  await appContext.electronApp.close();
});

test('matches key UI screenshots', async () => {
  const { page } = appContext;
  await expect(page.getByTestId('login-button')).toContainText('Sign in with GitHub');
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.());

  await expect(page.getByTestId('sidebar')).toHaveScreenshot('sidebar.png', { maxDiffPixelRatio: 0.03 });
  await expect(page.getByTestId('thread-panel')).toHaveScreenshot('thread-panel.png', { maxDiffPixelRatio: 0.03 });

  await page.getByTestId('settings-button').click();
  await expect(page.getByTestId('settings-panel')).toHaveScreenshot('settings-panel.png', { maxDiffPixelRatio: 0.03 });
  await page.getByTestId('settings-close-button').click();

  await page.getByTestId('tab-diff').click();
  await expect(page.getByTestId('diff-view')).toContainText('src.ts');
  await expect(page.getByTestId('diff-view')).toHaveScreenshot('diff-viewer.png', { maxDiffPixelRatio: 0.03 });
});
