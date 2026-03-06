import * as fs from 'fs';
import * as path from 'path';
import { expect, test } from '@playwright/test';
import { createGitFixtureRepo, GitFixtureRepo } from '../utils/createGitFixtureRepo';
import { launchLoomApp, LoomAppContext, setProjectInStore } from '../utils/electronApp';

let fixtureRepo: GitFixtureRepo | null = null;
let appContext: LoomAppContext | null = null;

const LARGE_DIFF_LINE_COUNT = 240;

test.beforeEach(async () => {
  fixtureRepo = createGitFixtureRepo();
  if (!fixtureRepo) throw new Error('Fixture repo not initialized');

  const diffLines = Array.from(
    { length: LARGE_DIFF_LINE_COUNT },
    (_, index) => `export const line${index} = ${index};`,
  ).join('\n');
  fs.writeFileSync(path.join(fixtureRepo.repoPath, 'src.ts'), `${diffLines}\n`, 'utf-8');

  appContext = await launchLoomApp();
  await setProjectInStore(appContext.page, fixtureRepo.repoPath, 'fixture-project');
});

test.afterEach(async () => {
  if (appContext) {
    await appContext.electronApp.close();
    appContext = null;
  }
  fixtureRepo?.cleanup();
  fixtureRepo = null;
});

test('diff view scrolls when the diff is taller than the panel', async () => {
  if (!appContext) throw new Error('App context not initialized');
  const { page } = appContext;

  await page.getByTestId('new-thread-button').click();
  await page.getByTestId('tab-diff').click();

  await expect(page.getByTestId('diff-view')).toContainText('src.ts');
  const scrollContainer = page.getByTestId('diff-scroll-container');
  await expect(scrollContainer).toBeVisible();

  await expect.poll(async () => scrollContainer.evaluate(
    (element) => element.scrollHeight - element.clientHeight,
  )).toBeGreaterThan(0);
  const dimensions = await scrollContainer.evaluate((element) => ({
    clientHeight: element.clientHeight,
    scrollHeight: element.scrollHeight,
  }));
  expect(dimensions.scrollHeight).toBeGreaterThan(dimensions.clientHeight);

  await scrollContainer.hover();
  await page.mouse.wheel(0, 1200);

  await expect.poll(async () => scrollContainer.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
});
