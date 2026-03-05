import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ThreadPanel } from '../../../src/renderer/components/ThreadPanel';
import { useAppStore } from '../../../src/renderer/store/appStore';
import { createMockIpcRenderer, installElectronMock, MockIpcRenderer } from '../../utils/mockElectronRenderer';
import { resetAppStore } from '../../utils/resetAppStore';

describe('ThreadPanel', () => {
  let ipcRenderer: MockIpcRenderer;
  let restoreRequire: () => void;
  let threadId: string;

  beforeEach(() => {
    resetAppStore();
    ipcRenderer = createMockIpcRenderer();
    restoreRequire = installElectronMock(ipcRenderer);

    const store = useAppStore.getState();
    store.setProject('/tmp/project', 'project');
    threadId = store.createThread('Test thread', 'local');
    store.setActiveThread(threadId);
    store.setPermissionMode('auto');
    store.addMcpServer('filesystem', { command: 'npx', args: ['-y', 'server-filesystem'], tools: ['*'] });
  });

  afterEach(() => {
    restoreRequire();
    resetAppStore();
  });

  it('sends message payload and handles streamed completion', async () => {
    render(<ThreadPanel />);

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
        result: 'Tool output',
        requestId,
      });
      ipcRenderer.emit('agent:stream', threadId, { type: 'chunk', content: 'partial', requestId });
      ipcRenderer.emit('agent:stream', threadId, { type: 'done', content: 'final response', requestId });
    });

    await waitFor(() => expect(screen.getByText('final response')).toBeInTheDocument());
    expect(screen.queryByText('stale')).not.toBeInTheDocument();
    expect(screen.getByText('Analyzing context')).toBeInTheDocument();
    expect(screen.getByTestId('thinking-toggle')).toHaveTextContent('Thinking');
    const thinkingBlock = screen.getByTestId('thinking-block');
    const finalResponse = screen.getByText('final response');
    expect(
      thinkingBlock.compareDocumentPosition(finalResponse) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeGreaterThan(0);
    // Completed tool calls are collapsed by default — summary is visible
    const toolSummary = screen.getByText(/1 tool call/);
    expect(toolSummary).toBeInTheDocument();
    // Expand to see individual tool call names
    fireEvent.click(toolSummary);
    await waitFor(() => expect(screen.getByText('read_bash')).toBeInTheDocument());
    expect(screen.queryByText('Tool output')).not.toBeInTheDocument();
    act(() => {
      useAppStore.getState().setShowToolOutputDetails(true);
    });
    await waitFor(() => expect(screen.getByText('Tool output')).toBeInTheDocument());
    expect(useAppStore.getState().threads.find((thread) => thread.id === threadId)?.status).toBe('completed');
  });

  it('collapses long thinking and expands on demand', async () => {
    render(<ThreadPanel />);

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
});
