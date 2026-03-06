import { expect, Page, test } from '@playwright/test';
import { createGitFixtureRepo, GitFixtureRepo } from '../utils/createGitFixtureRepo';
import { launchLoomApp, LoomAppContext, setProjectInStore, stabilizePageForScreenshot } from '../utils/electronApp';

type InvokeOverride = {
  delayMs?: number;
  result?: unknown;
  error?: string;
};

const diffFixture = {
  files: [
    {
      path: 'src.ts',
      status: 'modified',
      additions: 2,
      deletions: 1,
      hunks: [
        {
          oldStart: 1,
          oldCount: 2,
          newStart: 1,
          newCount: 3,
          header: 'export const value',
          lines: [
            { type: 'ctx', oldLine: 1, newLine: 1, content: 'export const value = 1;' },
            { type: 'del', oldLine: 2, newLine: null, content: 'export const removed = true;' },
            { type: 'add', oldLine: null, newLine: 2, content: 'export const updated = true;' },
            { type: 'add', oldLine: null, newLine: 3, content: 'export const extra = true;' },
          ],
        },
      ],
    },
    {
      path: 'new-file.ts',
      status: 'added',
      additions: 1,
      deletions: 0,
      hunks: [
        {
          oldStart: 0,
          oldCount: 0,
          newStart: 1,
          newCount: 1,
          header: 'new file mode 100644',
          lines: [
            { type: 'add', oldLine: null, newLine: 1, content: 'export const created = true;' },
          ],
        },
      ],
    },
  ],
};

let fixtureRepo: GitFixtureRepo | null = null;
let appContext: LoomAppContext | null = null;

async function installInvokeOverrides(page: Page, overrides: Record<string, InvokeOverride>): Promise<void> {
  await page.evaluate((serializedOverrides) => {
    const api = (window as any).electronAPI;
    const originalInvoke = api.invoke.bind(api);

    // Create wrapper function that applies overrides
    const overriddenInvoke = (channel: string, ...args: unknown[]) => {
      const override = (serializedOverrides as Record<string, InvokeOverride>)[channel];
      if (!override) {
        return originalInvoke(channel, ...args);
      }

      // Return a promise that applies the override
      return new Promise((resolve, reject) => {
        if (override.delayMs) {
          setTimeout(async () => {
            try {
              if (override.error) {
                throw new Error(override.error);
              }
              resolve(override.result);
            } catch (err) {
              reject(err);
            }
          }, override.delayMs);
        } else {
          try {
            if (override.error) {
              throw new Error(override.error);
            }
            resolve(override.result);
          } catch (err) {
            reject(err);
          }
        }
      });
    };

    // Use the test-only __setInvokeImpl method to swap the implementation
    if (typeof api.__setInvokeImpl === 'function') {
      api.__setInvokeImpl(overriddenInvoke);
    } else {
      throw new Error('electronAPI.__setInvokeImpl not available - is test mode enabled?');
    }
  }, overrides);
}

test.beforeEach(async () => {
  fixtureRepo = createGitFixtureRepo();
  appContext = await launchLoomApp();
  await setProjectInStore(appContext.page, fixtureRepo.repoPath, 'fixture-project');
  await appContext.page.evaluate(() => {
    const store = (window as any).__appStore;
    store.getState().setTheme('light');
  });
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

test('matches the settings panel while version info is loading', async () => {
  if (!appContext) throw new Error('App context not initialized');
  const { page } = appContext;

  await installInvokeOverrides(page, {
    'app:get-version': {
      delayMs: 1500,
      result: { version: '0.3.0' },
    },
  });

  await page.getByTestId('settings-button').click();
  await expect(page.getByTestId('settings-version-loading')).toBeVisible();
  await expect(page.getByTestId('settings-panel')).toHaveScreenshot('settings-panel-loading.png', { maxDiffPixelRatio: 0.03 });
});

test('matches the settings panel while diagnostics are running', async () => {
  if (!appContext) throw new Error('App context not initialized');
  const { page } = appContext;

  await installInvokeOverrides(page, {
    'app:get-version': {
      result: { version: '0.3.0' },
    },
    'auth:get-user': {
      delayMs: 1500,
      result: { authenticated: true, user: { login: 'octocat' } },
    },
    'agent:list-models': {
      delayMs: 1500,
      result: { success: true, models: [{ id: 'gpt-4.1' }] },
    },
    'agent:list-project-mcp': {
      delayMs: 1500,
      result: { cloudbuild: { url: 'https://cloudbuild.example.com/mcp' } },
    },
  });

  await page.getByTestId('settings-button').click();
  await expect(page.getByText('v0.3.0')).toBeVisible();

  await page.getByTestId('settings-run-diagnostics').click();
  await expect(page.getByTestId('settings-diagnostics-loading')).toBeVisible();
  await expect(page.getByTestId('settings-panel')).toHaveScreenshot('settings-panel-diagnostics-loading.png', { maxDiffPixelRatio: 0.03 });
});

test('matches diff view loading and polished loaded states', async () => {
  if (!appContext) throw new Error('App context not initialized');
  const { page } = appContext;

  await installInvokeOverrides(page, {
    'git:diff': {
      delayMs: 1500,
      result: diffFixture,
    },
  });

  await page.getByTestId('new-thread-button').click();
  await page.getByTestId('tab-diff').click();

  await expect(page.getByTestId('diff-loading')).toBeVisible();
  await expect(page.getByTestId('diff-view')).toHaveScreenshot('diff-view-loading.png', { maxDiffPixelRatio: 0.03 });

  await expect(page.getByRole('button', { name: /src\.ts/i })).toBeVisible();
  await expect(page.getByTestId('diff-view')).toHaveScreenshot('diff-view-polished.png', { maxDiffPixelRatio: 0.03 });
});
