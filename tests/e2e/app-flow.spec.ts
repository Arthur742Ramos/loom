import { test, expect } from '@playwright/test';
import { createGitFixtureRepo, GitFixtureRepo } from '../utils/createGitFixtureRepo';
import { launchLoomApp, LoomAppContext, setProjectInStore } from '../utils/electronApp';

let fixtureRepo: GitFixtureRepo;
let appContext: LoomAppContext;

test.beforeEach(async () => {
  fixtureRepo = createGitFixtureRepo();
  appContext = await launchLoomApp();
  await setProjectInStore(appContext.page, fixtureRepo.repoPath, 'fixture-project');
});

test.afterEach(async () => {
  fixtureRepo.cleanup();
  if (appContext) {
    await appContext.electronApp.close();
  }
});

test('opens app, creates thread, sends prompt, and receives response', async () => {
  const { page } = appContext;

  await page.getByTestId('new-thread-button').click();
  await expect(page.getByTestId('thread-panel')).toBeVisible();

  await page.getByTestId('thread-input').fill('Create a reusable date helper.');
  await page.keyboard.press('Enter');

  await expect(page.getByText('Mock response from Loom test mode')).toBeVisible();

  const status = await page.evaluate(() => {
    const store = (window as any).__appStore;
    const state = store.getState();
    const thread = state.threads.find((item: any) => item.id === state.activeThreadId);
    return thread?.status;
  });

  expect(status).toBe('completed');
});
