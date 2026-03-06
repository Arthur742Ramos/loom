import { expect, test } from '@playwright/test';
import { createGitFixtureRepo, GitFixtureRepo } from '../utils/createGitFixtureRepo';
import { launchLoomApp, LoomAppContext, setProjectInStore, stabilizePageForScreenshot } from '../utils/electronApp';

let fixtureRepo: GitFixtureRepo | null = null;
let appContext: LoomAppContext | null = null;

test.beforeEach(async () => {
  fixtureRepo = createGitFixtureRepo();
  appContext = await launchLoomApp();
  await setProjectInStore(appContext.page, fixtureRepo.repoPath, 'fixture-project');
});

test.afterEach(async () => {
  fixtureRepo?.cleanup();
  fixtureRepo = null;
  if (appContext) {
    await appContext.electronApp.close();
    appContext = null;
  }
});

test('restores per-thread drafts when switching threads', async () => {
  if (!appContext) throw new Error('App context not initialized');
  const { page } = appContext;

  const [threadA, threadB] = await page.evaluate(() => {
    const store = (window as any).__appStore;
    const state = store.getState();
    const firstThreadId = state.createThread('Draft thread A', 'local');
    const secondThreadId = state.createThread('Draft thread B', 'local');
    state.setActiveThread(firstThreadId);
    return [firstThreadId, secondThreadId];
  });

  await page.getByTestId('thread-input').fill('Draft answer for thread A');
  await page.evaluate((threadId) => {
    const store = (window as any).__appStore;
    store.getState().setActiveThread(threadId);
  }, threadB);
  await page.getByTestId('thread-input').fill('Draft answer for thread B');
  await page.evaluate((threadId) => {
    const store = (window as any).__appStore;
    store.getState().setActiveThread(threadId);
  }, threadA);

  await expect(page.getByRole('heading', { name: 'Draft thread A' })).toBeVisible();
  await expect(page.getByTestId('thread-input')).toHaveValue('Draft answer for thread A');
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.());
  await stabilizePageForScreenshot(page);
  await expect(page.getByTestId('thread-panel')).toHaveScreenshot('thread-panel-draft-restoration.png', {
    maxDiffPixelRatio: 0.03,
  });
});
