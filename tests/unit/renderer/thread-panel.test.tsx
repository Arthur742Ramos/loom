import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ThreadPanel } from '../../../src/renderer/components/ThreadPanel';
import { TooltipProvider } from '../../../src/renderer/components/ui/tooltip';
import { useAppStore } from '../../../src/renderer/store/appStore';
import { createMockIpcRenderer, installElectronMock, MockIpcRenderer } from '../../utils/mockElectronRenderer';
import { resetAppStore } from '../../utils/resetAppStore';

describe('ThreadPanel', () => {
  let ipcRenderer: MockIpcRenderer;
  let restoreRequire: () => void;
  let threadId: string;
  let clipboardWriteText: ReturnType<typeof vi.fn>;
  let originalRequestAnimationFrame: typeof window.requestAnimationFrame;
  let originalCancelAnimationFrame: typeof window.cancelAnimationFrame;
  const renderThreadPanel = async () => {
    await act(async () => {
      render(<TooltipProvider><ThreadPanel /></TooltipProvider>);
      await Promise.resolve();
    });
  };

  beforeEach(() => {
    resetAppStore();
    ipcRenderer = createMockIpcRenderer();
    restoreRequire = installElectronMock(ipcRenderer);
    originalRequestAnimationFrame = window.requestAnimationFrame;
    originalCancelAnimationFrame = window.cancelAnimationFrame;
    window.requestAnimationFrame = ((callback: FrameRequestCallback) => {
      callback(0);
      return 0;
    }) as typeof window.requestAnimationFrame;
    window.cancelAnimationFrame = (() => {}) as typeof window.cancelAnimationFrame;
    clipboardWriteText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(window.navigator, 'clipboard', {
      configurable: true,
      value: { writeText: clipboardWriteText },
    });

    act(() => {
      const store = useAppStore.getState();
      store.setProject('/tmp/project', 'project');
      threadId = store.createThread('Test thread', 'local');
      store.setActiveThread(threadId);
      store.setPermissionMode('auto');
      store.addMcpServer('filesystem', { command: 'npx', args: ['-y', 'server-filesystem'], tools: ['*'] });
    });
  });

  afterEach(() => {
    cleanup();
    window.requestAnimationFrame = originalRequestAnimationFrame;
    window.cancelAnimationFrame = originalCancelAnimationFrame;
    restoreRequire();
    resetAppStore();
  });

  it('sends message payload and handles streamed completion', async () => {
    await renderThreadPanel();
    const toolOutput = 'Tool output '.repeat(40).trim();

    const input = screen.getByTestId('thread-input');
    fireEvent.change(input, { target: { value: 'Hello from test' } });
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });

    await waitFor(() =>
      expect(ipcRenderer.send).toHaveBeenCalledWith(
        'agent:send',
        expect.objectContaining({
          threadId,
          requestId: expect.any(String),
          message: 'Hello from test',
          model: 'claude-sonnet-4',
          reasoningEffort: 'medium',
          permissionMode: 'auto',
          context: { cwd: '/tmp/project' },
        }),
      ),
    );

    const requestPayload = ipcRenderer.send.mock.calls.find((call) => call[0] === 'agent:send')?.[1];
    const requestId = requestPayload?.requestId as string;

    act(() => {
      ipcRenderer.emit('agent:stream', threadId, { type: 'chunk', content: 'stale', requestId: 'wrong-request' });
      ipcRenderer.emit('agent:stream', threadId, { type: 'thinking', content: 'Analyzing context', requestId });
      ipcRenderer.emit('agent:stream', threadId, {
        type: 'tool_start',
        toolCallId: 'tc-1',
        toolName: 'read_bash',
        requestId,
      });
      ipcRenderer.emit('agent:stream', threadId, {
        type: 'tool_end',
        toolCallId: 'tc-1',
        success: true,
        result: toolOutput,
        requestId,
      });
      ipcRenderer.emit('agent:stream', threadId, {
        type: 'usage',
        inputTokens: 1200,
        outputTokens: 300,
        totalTokens: 1500,
        requestId,
      });
      ipcRenderer.emit('agent:stream', threadId, { type: 'chunk', content: 'partial', requestId });
      ipcRenderer.emit('agent:stream', threadId, { type: 'done', content: 'final response', requestId });
    });

    await waitFor(() => expect(screen.getByText('final response')).toBeInTheDocument());
    expect(screen.queryByText('stale')).not.toBeInTheDocument();
    expect(screen.getByText('Analyzing context')).toBeInTheDocument();
    expect(screen.getByTestId('thinking-toggle')).toHaveTextContent('Reasoning trace');
    const thinkingBlock = screen.getByTestId('thinking-block');
    const finalResponse = screen.getByText('final response');
    expect(
      thinkingBlock.compareDocumentPosition(finalResponse) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeGreaterThan(0);
    await waitFor(() => expect(screen.getByText('read_bash')).toBeInTheDocument());
    expect(screen.queryByText((content) => content === toolOutput)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Show output' }));
    await waitFor(() => expect(screen.getByText((content) => content === toolOutput)).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /Reuse prompt/i }));
    expect(screen.getByTestId('thread-input')).toHaveValue('Hello from test');
    fireEvent.click(screen.getByRole('button', { name: /Copy answer/i }));
    await waitFor(() => expect(clipboardWriteText).toHaveBeenCalledWith('final response'));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Copied' })).toBeInTheDocument());
    const tokenCounter = screen.getByTestId('token-counter');
    expect(tokenCounter).toHaveTextContent('1.5K tokens');
    await act(async () => {
      fireEvent.focus(tokenCounter);
      await Promise.resolve();
    });
    await waitFor(() => expect(screen.getByTestId('token-counter-tooltip')).toBeInTheDocument());
    const tokenTooltip = screen.getByTestId('token-counter-tooltip');
    expect(tokenTooltip).toHaveTextContent('Prompt');
    expect(tokenTooltip).toHaveTextContent('Completion');
    expect(tokenTooltip).toHaveTextContent('Total');
    expect(tokenTooltip).toHaveTextContent('1,200');
    expect(tokenTooltip).toHaveTextContent('300');
    expect(tokenTooltip).toHaveTextContent('1,500');
    expect(useAppStore.getState().threads.find((thread) => thread.id === threadId)?.status).toBe('completed');
  });

  it('collapses long thinking and expands on demand', async () => {
    await renderThreadPanel();

    const input = screen.getByTestId('thread-input');
    fireEvent.change(input, { target: { value: 'Show long reasoning' } });
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });

    await waitFor(() =>
      expect(ipcRenderer.send).toHaveBeenCalledWith(
        'agent:send',
        expect.objectContaining({
          threadId,
          requestId: expect.any(String),
        }),
      ),
    );

    const requestPayload = ipcRenderer.send.mock.calls.find((call) => call[0] === 'agent:send')?.[1];
    const requestId = requestPayload?.requestId as string;
    const longThinking = `reasoning-${'x'.repeat(620)}`;

    act(() => {
      ipcRenderer.emit('agent:stream', threadId, { type: 'thinking', content: longThinking, requestId });
      ipcRenderer.emit('agent:stream', threadId, { type: 'done', content: 'short answer', requestId });
    });

    await waitFor(() => expect(screen.getByText('short answer')).toBeInTheDocument());
    expect(screen.queryByText((content) => content === longThinking)).not.toBeInTheDocument();
    expect(screen.queryByTestId('thinking-show-more')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('thinking-toggle'));
    await waitFor(() => expect(screen.getByTestId('thinking-show-more')).toBeInTheDocument());
    expect(screen.queryByText((content) => content === longThinking)).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('thinking-show-more'));
    expect(screen.getByText((content) => content === longThinking)).toBeInTheDocument();
  });

  it('shows a fallback error message when stream error content is missing', async () => {
    await renderThreadPanel();

    const input = screen.getByTestId('thread-input');
    fireEvent.change(input, { target: { value: 'Trigger error fallback' } });
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });

    await waitFor(() =>
      expect(ipcRenderer.send).toHaveBeenCalledWith(
        'agent:send',
        expect.objectContaining({
          threadId,
          requestId: expect.any(String),
        }),
      ),
    );

    const requestPayload = ipcRenderer.send.mock.calls.find((call) => call[0] === 'agent:send')?.[1];
    const requestId = requestPayload?.requestId as string;

    act(() => {
      ipcRenderer.emit('agent:stream', threadId, { type: 'error', requestId });
    });

    await waitFor(() => expect(screen.getByText('Error: Unknown agent error')).toBeInTheDocument());
    expect(useAppStore.getState().threads.find((thread) => thread.id === threadId)?.status).toBe('error');
  });

  it('marks tool calls done even when tool_end omits toolCallId', async () => {
    await renderThreadPanel();

    const input = screen.getByTestId('thread-input');
    fireEvent.change(input, { target: { value: 'Run tool without id' } });
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });

    await waitFor(() =>
      expect(ipcRenderer.send).toHaveBeenCalledWith(
        'agent:send',
        expect.objectContaining({
          threadId,
          requestId: expect.any(String),
        }),
      ),
    );

    const requestPayload = ipcRenderer.send.mock.calls.find((call) => call[0] === 'agent:send')?.[1];
    const requestId = requestPayload?.requestId as string;

    act(() => {
      ipcRenderer.emit('agent:stream', threadId, {
        type: 'tool_start',
        toolName: 'read_bash',
        requestId,
      });
      ipcRenderer.emit('agent:stream', threadId, {
        type: 'tool_end',
        success: true,
        result: 'ok',
        requestId,
      });
      ipcRenderer.emit('agent:stream', threadId, { type: 'done', content: 'done', requestId });
    });

    await waitFor(() => expect(screen.getByText('done')).toBeInTheDocument());
    const thread = useAppStore.getState().threads.find((t) => t.id === threadId);
    const assistantMessage = [...(thread?.messages || [])]
      .reverse()
      .find((message) => message.role === 'assistant');
    expect(assistantMessage?.toolCalls).toHaveLength(1);
    expect(assistantMessage?.toolCalls?.[0]).toMatchObject({
      toolName: 'read_bash',
      status: 'done',
      result: 'ok',
    });
  });

  it('keeps permission and ask_user prompts scoped per thread across thread switches', async () => {
    const store = useAppStore.getState();
    const secondThreadId = store.createThread('Second thread', 'local');
    store.setActiveThread(threadId);

    await renderThreadPanel();

    act(() => {
      ipcRenderer.emit('agent:permission-request', secondThreadId, {
        kind: 'run',
        replyChannel: 'perm-reply-2',
      });
    });
    expect(screen.queryByText(/Allow .* access\?/)).not.toBeInTheDocument();

    act(() => {
      useAppStore.getState().setActiveThread(secondThreadId);
    });
    await waitFor(() => expect(screen.getByText('Allow')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Allow' }));
    expect(ipcRenderer.sendReply).toHaveBeenCalledWith('perm-reply-2', true);

    act(() => {
      useAppStore.getState().setActiveThread(threadId);
      ipcRenderer.emit('agent:user-input-request', secondThreadId, {
        question: 'Proceed?',
        allowFreeform: true,
        replyChannel: 'ask-reply-2',
      });
    });
    expect(screen.queryByText('Proceed?')).not.toBeInTheDocument();

    act(() => {
      useAppStore.getState().setActiveThread(secondThreadId);
    });
    await waitFor(() => expect(screen.getByText('Proceed?')).toBeInTheDocument());
    const answerInput = screen.getByPlaceholderText('Type your answer...');
    fireEvent.change(answerInput, { target: { value: 'yes' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(ipcRenderer.sendReply).toHaveBeenCalledWith('ask-reply-2', 'yes');
  });

  it('keeps unsent drafts scoped to each thread and preserves the next thread after deletion', async () => {
    const store = useAppStore.getState();
    const secondThreadId = store.createThread('Second thread', 'local');
    store.setActiveThread(threadId);

    await renderThreadPanel();

    const input = screen.getByTestId('thread-input') as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: 'Draft for thread one' } });
    expect(input).toHaveValue('Draft for thread one');

    act(() => {
      useAppStore.getState().setActiveThread(secondThreadId);
    });
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Second thread' })).toBeInTheDocument());
    expect(screen.getByTestId('thread-input')).toHaveValue('');

    fireEvent.change(screen.getByTestId('thread-input'), { target: { value: 'Draft for thread two' } });
    expect(screen.getByTestId('thread-input')).toHaveValue('Draft for thread two');

    act(() => {
      useAppStore.getState().setActiveThread(threadId);
    });
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Test thread' })).toBeInTheDocument());
    expect(screen.getByTestId('thread-input')).toHaveValue('Draft for thread one');

    act(() => {
      useAppStore.getState().removeThread(threadId);
    });
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Second thread' })).toBeInTheDocument());
    expect(screen.getByTestId('thread-input')).toHaveValue('Draft for thread two');
  });

  it('applies starter prompt suggestions to the composer when the thread is empty', async () => {
    await renderThreadPanel();

    fireEvent.click(screen.getByRole('button', { name: /Plan the work/i }));

    expect(screen.getByTestId('thread-input')).toHaveValue(
      'Review project and propose the best implementation plan before making changes.',
    );
    expect(screen.getByTestId('thread-draft-indicator')).toHaveTextContent('Draft saved locally');
  });

  it('restores scroll position when switching between threads', async () => {
    const store = useAppStore.getState();
    const secondThreadId = store.createThread('Second thread', 'local');
    store.setActiveThread(threadId);

    await renderThreadPanel();

    const scrollContainer = screen.getByTestId('thread-scroll-container');
    let scrollTop = 0;
    Object.defineProperty(scrollContainer, 'scrollHeight', {
      configurable: true,
      get: () => 1200,
    });
    Object.defineProperty(scrollContainer, 'clientHeight', {
      configurable: true,
      get: () => 400,
    });
    Object.defineProperty(scrollContainer, 'scrollTop', {
      configurable: true,
      get: () => scrollTop,
      set: (value: number) => {
        scrollTop = value;
      },
    });

    act(() => {
      useAppStore.getState().addMessage(threadId, {
        id: 'thread-one-user',
        role: 'user',
        content: 'Thread one history',
        timestamp: 1,
        status: 'done',
      });
      useAppStore.getState().addMessage(threadId, {
        id: 'thread-one-assistant',
        role: 'assistant',
        content: 'Thread one reply',
        timestamp: 2,
        status: 'done',
      });
      useAppStore.getState().addMessage(secondThreadId, {
        id: 'thread-two-user',
        role: 'user',
        content: 'Thread two history',
        timestamp: 3,
        status: 'done',
      });
      useAppStore.getState().addMessage(secondThreadId, {
        id: 'thread-two-assistant',
        role: 'assistant',
        content: 'Thread two reply',
        timestamp: 4,
        status: 'done',
      });
    });

    await waitFor(() => expect(scrollTop).toBe(1200));

    act(() => {
      scrollTop = 240;
      fireEvent.scroll(scrollContainer);
      useAppStore.getState().setActiveThread(secondThreadId);
    });

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Second thread' })).toBeInTheDocument());
    await waitFor(() => expect(scrollTop).toBe(1200));

    act(() => {
      scrollTop = 120;
      fireEvent.scroll(scrollContainer);
      useAppStore.getState().setActiveThread(threadId);
    });

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Test thread' })).toBeInTheDocument());
    await waitFor(() => expect(scrollTop).toBe(240));
  });

  it('shows jump-to-latest when scrolled away from the bottom and preserves scroll position', async () => {
    await renderThreadPanel();

    const scrollContainer = screen.getByTestId('thread-scroll-container');
    let scrollTop = 0;
    Object.defineProperty(scrollContainer, 'scrollHeight', {
      configurable: true,
      get: () => 1200,
    });
    Object.defineProperty(scrollContainer, 'clientHeight', {
      configurable: true,
      get: () => 400,
    });
    Object.defineProperty(scrollContainer, 'scrollTop', {
      configurable: true,
      get: () => scrollTop,
      set: (value: number) => {
        scrollTop = value;
      },
    });

    act(() => {
      useAppStore.getState().addMessage(threadId, {
        id: 'msg-history-user',
        role: 'user',
        content: 'Earlier context',
        timestamp: 1,
        status: 'done',
      });
      useAppStore.getState().addMessage(threadId, {
        id: 'msg-history-assistant',
        role: 'assistant',
        content: 'Initial answer',
        timestamp: 2,
        status: 'done',
      });
    });

    await waitFor(() => expect(scrollTop).toBe(1200));
    expect(screen.queryByTestId('thread-jump-to-latest')).not.toBeInTheDocument();

    act(() => {
      scrollTop = 200;
      fireEvent.scroll(scrollContainer);
    });

    await waitFor(() => expect(screen.getByTestId('thread-jump-to-latest')).toBeInTheDocument());

    act(() => {
      useAppStore.getState().addMessage(threadId, {
        id: 'msg-new-assistant',
        role: 'assistant',
        content: 'Latest answer',
        timestamp: 3,
        status: 'done',
      });
    });

    await waitFor(() => expect(screen.getByText('Latest answer')).toBeInTheDocument());
    expect(scrollTop).toBe(200);

    fireEvent.click(screen.getByTestId('thread-jump-to-latest'));
    await waitFor(() => expect(scrollTop).toBe(1200));
    await waitFor(() => expect(screen.queryByTestId('thread-jump-to-latest')).not.toBeInTheDocument());
  });

  it('cancels title editing when switching threads', async () => {
    const store = useAppStore.getState();
    const secondThreadId = store.createThread('Second thread', 'local');
    store.setActiveThread(threadId);

    await renderThreadPanel();

    fireEvent.doubleClick(screen.getByRole('heading', { name: 'Test thread' }));
    const titleInput = screen.getByDisplayValue('Test thread');
    fireEvent.change(titleInput, { target: { value: 'Draft rename' } });

    act(() => {
      useAppStore.getState().setActiveThread(secondThreadId);
    });

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Second thread' })).toBeInTheDocument());
    expect(screen.queryByDisplayValue('Draft rename')).not.toBeInTheDocument();
    expect(useAppStore.getState().threads.find((thread) => thread.id === secondThreadId)?.title).toBe('Second thread');
  });

  it('prevents sending another prompt while the thread is running', async () => {
    useAppStore.getState().updateThread(threadId, { status: 'running' });
    await renderThreadPanel();

    const input = screen.getByTestId('thread-input');
    expect(input).toBeDisabled();
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });

    expect(ipcRenderer.send).not.toHaveBeenCalledWith('agent:send', expect.anything());
  });
});
