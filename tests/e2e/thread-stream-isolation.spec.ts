import { expect, Page, test } from '@playwright/test';
import { createGitFixtureRepo, GitFixtureRepo } from '../utils/createGitFixtureRepo';
import { launchLoomApp, LoomAppContext, setProjectInStore } from '../utils/electronApp';

async function launchFixtureApp(env?: Record<string, string>): Promise<{
  fixtureRepo: GitFixtureRepo;
  appContext: LoomAppContext;
}> {
  const fixtureRepo = createGitFixtureRepo();
  try {
    const appContext = await launchLoomApp({ env });
    await setProjectInStore(appContext.page, fixtureRepo.repoPath, 'fixture-project');
    return { fixtureRepo, appContext };
  } catch (error) {
    fixtureRepo.cleanup();
    throw error;
  }
}

async function createThread(page: Page, title: string): Promise<string> {
  return page.evaluate((threadTitle) => {
    const store = (window as any).__appStore;
    return store.getState().createThread(threadTitle, 'local');
  }, title);
}

async function setActiveThread(page: Page, threadId: string): Promise<void> {
  await page.evaluate((id) => {
    const store = (window as any).__appStore;
    store.getState().setActiveThread(id);
  }, threadId);
}

async function sendPrompt(page: Page, threadId: string, prompt: string): Promise<void> {
  await setActiveThread(page, threadId);
  await page.getByTestId('thread-input').fill(prompt);
  await page.keyboard.press('Enter');
}

async function waitForThreadCompletion(page: Page, threadId: string): Promise<void> {
  await page.waitForFunction((id) => {
    const store = (window as any).__appStore;
    const thread = store.getState().threads.find((t: any) => t.id === id);
    return thread?.status === 'completed';
  }, threadId);
}

test('renders thinking and tool-call entries with quiet tool output by default', async () => {
  const script = JSON.stringify({
    byPrompt: {
      'run tools and show reasoning': [
        { type: 'status', status: 'Running scripted response' },
        { type: 'thinking', content: 'Reasoning trace from script' },
        { type: 'tool_start', toolCallId: 'tc-1', toolName: 'read_bash' },
        { type: 'tool_end', toolCallId: 'tc-1', success: true, result: 'Tool result output' },
        { type: 'chunk', content: 'intermediate chunk' },
        { type: 'done', content: 'final scripted response' },
      ],
    },
  });

  const ctx = await launchFixtureApp({ LOOM_TEST_AGENT_SCRIPT: script });
  const { page } = ctx.appContext;

  try {
    const threadId = await createThread(page, 'reasoning-thread');
    await sendPrompt(page, threadId, 'run tools and show reasoning');
    await waitForThreadCompletion(page, threadId);

    await expect(page.getByText('final scripted response')).toBeVisible();
    await expect(page.getByText('read_bash')).toBeVisible();
    await expect(page.getByText('Tool result output')).toHaveCount(0);
    await page.evaluate(() => {
      const store = (window as any).__appStore;
      store.getState().setShowToolOutputDetails(true);
    });
    await page.getByRole('button', { name: /1 tool call/i }).click();
    await expect(page.getByText('Tool result output')).toBeVisible();
    await page.getByText('Thinking').first().click();
    await expect(page.getByText('Reasoning trace from script')).toBeVisible();

    const threadState = await page.evaluate((id) => {
      const store = (window as any).__appStore;
      const thread = store.getState().threads.find((t: any) => t.id === id);
      const assistant = thread?.messages.filter((m: any) => m.role === 'assistant').at(-1);
      return {
        thinking: assistant?.thinking,
        toolCalls: assistant?.toolCalls,
      };
    }, threadId);

    expect(threadState.thinking).toContain('Reasoning trace from script');
    expect(threadState.toolCalls?.[0]).toMatchObject({
      toolName: 'read_bash',
      status: 'done',
      result: 'Tool result output',
    });
  } finally {
    ctx.fixtureRepo.cleanup();
    await ctx.appContext.electronApp.close();
  }
});

test('keeps concurrent thread streams isolated with no bleed', async () => {
  const script = JSON.stringify({
    byPrompt: {
      'thread-a prompt': [
        { type: 'status', status: 'A running' },
        { type: 'chunk', content: 'A chunk 1', delayMs: 120 },
        { type: 'chunk', content: 'A chunk 2', delayMs: 120 },
        { type: 'done', content: 'Response for thread A' },
      ],
      'thread-b prompt': [
        { type: 'status', status: 'B running' },
        { type: 'chunk', content: 'B chunk 1', delayMs: 40 },
        { type: 'done', content: 'Response for thread B' },
      ],
    },
  });

  const ctx = await launchFixtureApp({ LOOM_TEST_AGENT_SCRIPT: script });
  const { page } = ctx.appContext;

  try {
    const threadA = await createThread(page, 'thread-a');
    const threadB = await createThread(page, 'thread-b');

    await sendPrompt(page, threadA, 'thread-a prompt');
    await sendPrompt(page, threadB, 'thread-b prompt');

    await Promise.all([
      waitForThreadCompletion(page, threadA),
      waitForThreadCompletion(page, threadB),
    ]);

    const state = await page.evaluate(([aId, bId]) => {
      const store = (window as any).__appStore;
      const allThreads = store.getState().threads;
      const a = allThreads.find((t: any) => t.id === aId);
      const b = allThreads.find((t: any) => t.id === bId);
      const aAssistant = a?.messages.filter((m: any) => m.role === 'assistant').at(-1)?.content || '';
      const bAssistant = b?.messages.filter((m: any) => m.role === 'assistant').at(-1)?.content || '';
      const aAllText = a?.messages.map((m: any) => m.content).join('\n') || '';
      const bAllText = b?.messages.map((m: any) => m.content).join('\n') || '';
      return { aAssistant, bAssistant, aAllText, bAllText };
    }, [threadA, threadB] as [string, string]);

    expect(state.aAssistant).toBe('Response for thread A');
    expect(state.bAssistant).toBe('Response for thread B');
    expect(state.aAllText).not.toContain('Response for thread B');
    expect(state.bAllText).not.toContain('Response for thread A');
  } finally {
    ctx.fixtureRepo.cleanup();
    await ctx.appContext.electronApp.close();
  }
});

test('prevents duplicate streaming structures during chunk flushes', async () => {
  const script = JSON.stringify({
    byPrompt: {
      'overlap check prompt': [
        { type: 'tool_start', toolCallId: 'dup-tool', toolName: 'write_bash' },
        { type: 'tool_start', toolCallId: 'dup-tool', toolName: 'write_bash' },
        { type: 'chunk', content: 'chunk one', delayMs: 50 },
        { type: 'chunk', content: 'chunk two', delayMs: 50 },
        { type: 'tool_end', toolCallId: 'dup-tool', success: true, result: 'ok' },
        { type: 'done', content: 'stable final output' },
      ],
    },
  });

  const ctx = await launchFixtureApp({ LOOM_TEST_AGENT_SCRIPT: script });
  const { page } = ctx.appContext;

  try {
    const threadId = await createThread(page, 'overlap-thread');
    await sendPrompt(page, threadId, 'overlap check prompt');
    await waitForThreadCompletion(page, threadId);

    await expect(page.getByText('stable final output')).toBeVisible();

    const assistant = await page.evaluate((id) => {
      const store = (window as any).__appStore;
      const thread = store.getState().threads.find((t: any) => t.id === id);
      return thread?.messages.filter((m: any) => m.role === 'assistant').at(-1);
    }, threadId);

    expect(assistant.content).toBe('stable final output');
    expect(assistant.toolCalls).toHaveLength(1);
    expect(assistant.toolCalls[0]).toMatchObject({
      id: 'dup-tool',
      status: 'done',
      result: 'ok',
    });
  } finally {
    ctx.fixtureRepo.cleanup();
    await ctx.appContext.electronApp.close();
  }
});
