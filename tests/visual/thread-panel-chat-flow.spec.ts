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

test('shows jump-to-latest while reviewing earlier chat history', async () => {
  if (!appContext) throw new Error('App context not initialized');
  const { page } = appContext;

  await page.evaluate(() => {
    const store = (window as any).__appStore;
    const state = store.getState();
    const threadId = state.createThread('Long chat thread', 'local');

    for (let index = 0; index < 18; index += 1) {
      state.addMessage(threadId, {
        id: `user-${index}`,
        role: 'user',
        content: `Question ${index + 1}: ${'Need more context. '.repeat(3)}`,
        timestamp: Date.now() + index,
        status: 'done',
      });
      state.addMessage(threadId, {
        id: `assistant-${index}`,
        role: 'assistant',
        content: `Answer ${index + 1}: ${'Here is a detailed response to keep the transcript tall. '.repeat(4)}`,
        timestamp: Date.now() + index + 100,
        status: 'done',
      });
    }

    state.setTheme('light');
    state.setActiveThread(threadId);
  });

  await expect(page.getByRole('heading', { name: 'Long chat thread' })).toBeVisible();
  await page.getByTestId('thread-scroll-container').evaluate((element) => {
    element.scrollTop = 0;
    element.dispatchEvent(new Event('scroll', { bubbles: true }));
  });
  await expect(page.getByTestId('thread-jump-to-latest')).toBeVisible();
  await expect(page.getByTestId('thread-jump-to-latest')).toContainText('Jump to latest');
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.());
  await stabilizePageForScreenshot(page);
  await expect(page.getByTestId('thread-jump-to-latest-shell')).toHaveScreenshot('thread-panel-jump-to-latest.png', {
    mask: [page.getByTestId('thread-jump-to-latest-label')],
    maskColor: '#ffffff',
    maxDiffPixelRatio: 0.03,
  });
});

test('renders the polished chat conversation flow', async () => {
  if (!appContext) throw new Error('App context not initialized');
  const { page } = appContext;

  await page.evaluate(() => {
    const store = (window as any).__appStore;
    const state = store.getState();
    const threadId = state.createThread('Polished conversation', 'local');

    state.addMessage(threadId, {
      id: 'user-1',
      role: 'user',
      content: 'Improve the chat UI and make the conversation easier to scan.',
      timestamp: Date.now(),
      status: 'done',
    });
    state.addMessage(threadId, {
      id: 'assistant-1',
      role: 'assistant',
      content: 'I reorganized the response into clearer sections, surfaced tool activity inline, and upgraded the composer so the next step feels obvious.',
      timestamp: Date.now() + 1,
      status: 'done',
      thinking: 'Audit the message hierarchy, surface the agent workflow inline, and make the composer feel persistent without overwhelming the user.',
      toolCalls: [
        {
          id: 'tool-1',
          toolName: 'read_file',
          status: 'done',
          result: 'Inspected ThreadPanel.tsx and renderer styles to map the current chat layout before polishing the flow. '.repeat(8),
        },
      ],
    });

    state.addThreadTokenUsage(threadId, {
      inputTokens: 2200,
      outputTokens: 540,
      cacheReadTokens: 180,
      cacheWriteTokens: 0,
      totalTokens: 2920,
    });
    state.setActiveThread(threadId);
  });

  await page.getByTestId('thread-input').fill('Follow up with an even tighter interaction flow.');
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.());
  await stabilizePageForScreenshot(page);
  await expect(page.getByTestId('thread-panel')).toHaveScreenshot('thread-panel-conversation-polish.png', {
    maxDiffPixelRatio: 0.03,
  });
});
