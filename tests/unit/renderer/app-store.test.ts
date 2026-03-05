import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppStore, ChatMessage, ToolCallEntry } from '../../../src/renderer/store/appStore';
import { createMockIpcRenderer, installElectronMock, MockIpcRenderer } from '../../utils/mockElectronRenderer';
import { resetAppStore } from '../../utils/resetAppStore';

describe('appStore', () => {
  beforeEach(() => {
    resetAppStore();
  });

  afterEach(() => {
    resetAppStore();
  });

  // ─── createThread ───────────────────────────────────────────────

  describe('createThread', () => {
    it('creates thread with correct fields', () => {
      useAppStore.getState().setProject('/tmp/proj', 'proj');

      const id = useAppStore.getState().createThread('My Thread', 'local');

      expect(id).toBeTruthy();
      const thread = useAppStore.getState().threads.find((t) => t.id === id);
      expect(thread).toBeDefined();
      expect(thread!.title).toBe('My Thread');
      expect(thread!.mode).toBe('local');
      expect(thread!.projectPath).toBe('/tmp/proj');
      expect(thread!.projectName).toBe('proj');
      expect(thread!.status).toBe('idle');
      expect(thread!.messages).toEqual([]);
      expect(thread!.cliSessionId).toBeTruthy();
      expect(useAppStore.getState().activeThreadId).toBe(id);
    });

    it('returns empty string when no project is set', () => {
      const id = useAppStore.getState().createThread('No project', 'local');
      expect(id).toBe('');
      expect(useAppStore.getState().threads).toHaveLength(0);
    });
  });

  // ─── addMessage / appendToMessage / updateMessage ───────────────

  describe('message operations', () => {
    let threadId: string;
    const msg: ChatMessage = {
      id: 'msg-1',
      role: 'user',
      content: 'Hello',
      timestamp: Date.now(),
      status: 'done',
    };

    beforeEach(() => {
      useAppStore.getState().setProject('/tmp/proj', 'proj');
      threadId = useAppStore.getState().createThread('t', 'local');
    });

    it('addMessage adds a message to the thread', () => {
      useAppStore.getState().addMessage(threadId, msg);

      const messages = useAppStore.getState().threads.find((t) => t.id === threadId)!.messages;
      expect(messages).toHaveLength(1);
      expect(messages[0].content).toBe('Hello');
    });

    it('appendToMessage appends content to existing message', () => {
      useAppStore.getState().addMessage(threadId, msg);
      useAppStore.getState().appendToMessage(threadId, 'msg-1', ' world');

      const messages = useAppStore.getState().threads.find((t) => t.id === threadId)!.messages;
      expect(messages[0].content).toBe('Hello world');
    });

    it('updateMessage merges partial updates', () => {
      useAppStore.getState().addMessage(threadId, msg);
      useAppStore.getState().updateMessage(threadId, 'msg-1', { status: 'error' });

      const messages = useAppStore.getState().threads.find((t) => t.id === threadId)!.messages;
      expect(messages[0].status).toBe('error');
      expect(messages[0].content).toBe('Hello');
    });
  });

  // ─── appendThinking ─────────────────────────────────────────────

  describe('appendThinking', () => {
    it('appends to message.thinking', () => {
      useAppStore.getState().setProject('/tmp/proj', 'proj');
      const threadId = useAppStore.getState().createThread('t', 'local');
      const msg: ChatMessage = {
        id: 'msg-1',
        role: 'assistant',
        content: '',
        timestamp: Date.now(),
        status: 'streaming',
      };
      useAppStore.getState().addMessage(threadId, msg);

      useAppStore.getState().appendThinking(threadId, 'msg-1', 'thought A');
      useAppStore.getState().appendThinking(threadId, 'msg-1', ' thought B');

      const messages = useAppStore.getState().threads.find((t) => t.id === threadId)!.messages;
      expect(messages[0].thinking).toBe('thought A thought B');
    });
  });

  // ─── addToolCall ────────────────────────────────────────────────

  describe('addToolCall', () => {
    it('adds tool call entries to a message', () => {
      useAppStore.getState().setProject('/tmp/proj', 'proj');
      const threadId = useAppStore.getState().createThread('t', 'local');
      const msg: ChatMessage = {
        id: 'msg-1',
        role: 'assistant',
        content: '',
        timestamp: Date.now(),
        status: 'streaming',
      };
      useAppStore.getState().addMessage(threadId, msg);

      const tc: ToolCallEntry = { id: 'tc-1', toolName: 'read_file', status: 'running' };
      useAppStore.getState().addToolCall(threadId, 'msg-1', tc);

      const messages = useAppStore.getState().threads.find((t) => t.id === threadId)!.messages;
      expect(messages[0].toolCalls).toHaveLength(1);
      expect(messages[0].toolCalls![0].toolName).toBe('read_file');
    });

    it('does not duplicate tool calls with same id', () => {
      useAppStore.getState().setProject('/tmp/proj', 'proj');
      const threadId = useAppStore.getState().createThread('t', 'local');
      const msg: ChatMessage = {
        id: 'msg-1',
        role: 'assistant',
        content: '',
        timestamp: Date.now(),
        status: 'streaming',
      };
      useAppStore.getState().addMessage(threadId, msg);

      const tc: ToolCallEntry = { id: 'tc-1', toolName: 'read_file', status: 'running' };
      useAppStore.getState().addToolCall(threadId, 'msg-1', tc);
      useAppStore.getState().addToolCall(threadId, 'msg-1', tc);

      const messages = useAppStore.getState().threads.find((t) => t.id === threadId)!.messages;
      expect(messages[0].toolCalls).toHaveLength(1);
    });
  });

  // ─── updateToolCallStatus ──────────────────────────────────────

  describe('updateToolCallStatus', () => {
    it('updates tool call status and details', () => {
      useAppStore.getState().setProject('/tmp/proj', 'proj');
      const threadId = useAppStore.getState().createThread('t', 'local');
      const msg: ChatMessage = {
        id: 'msg-1',
        role: 'assistant',
        content: '',
        timestamp: Date.now(),
        status: 'streaming',
      };
      useAppStore.getState().addMessage(threadId, msg);

      const tc: ToolCallEntry = { id: 'tc-1', toolName: 'edit_file', status: 'running' };
      useAppStore.getState().addToolCall(threadId, 'msg-1', tc);
      useAppStore.getState().updateToolCallStatus(threadId, 'msg-1', 'tc-1', 'done', {
        result: 'File edited',
      });

      const toolCalls = useAppStore.getState().threads.find((t) => t.id === threadId)!.messages[0].toolCalls!;
      expect(toolCalls[0].status).toBe('done');
      expect(toolCalls[0].result).toBe('File edited');
    });
  });

  // ─── fetchModels race condition ─────────────────────────────────

  describe('fetchModels', () => {
    let ipcRenderer: MockIpcRenderer;
    let restoreRequire: () => void;

    beforeEach(() => {
      ipcRenderer = createMockIpcRenderer();
      restoreRequire = installElectronMock(ipcRenderer);
    });

    afterEach(() => {
      restoreRequire();
    });

    it('second call supersedes first (race condition)', async () => {
      let firstResolve: (v: any) => void;
      let secondResolve: (v: any) => void;

      const firstPromise = new Promise((r) => { firstResolve = r; });
      const secondPromise = new Promise((r) => { secondResolve = r; });

      let callCount = 0;
      ipcRenderer.invoke.mockImplementation(async () => {
        callCount++;
        if (callCount === 1) return firstPromise;
        return secondPromise;
      });

      const p1 = useAppStore.getState().fetchModels();
      const p2 = useAppStore.getState().fetchModels();

      // Resolve second call first with desired models
      secondResolve!({
        success: true,
        models: [{ id: 'model-b', label: 'Model B', provider: 'B' }],
      });
      await p2;

      // Resolve first call after — its result should be discarded
      firstResolve!({
        success: true,
        models: [{ id: 'model-a', label: 'Model A', provider: 'A' }],
      });
      await p1;

      const models = useAppStore.getState().availableModels;
      expect(models).toHaveLength(1);
      expect(models[0].id).toBe('model-b');
    });
  });

  // ─── setProject ─────────────────────────────────────────────────

  describe('setProject', () => {
    it('adds to projects list and sets active project', () => {
      useAppStore.getState().setProject('/tmp/a', 'a');

      expect(useAppStore.getState().projects).toEqual([{ path: '/tmp/a', name: 'a' }]);
      expect(useAppStore.getState().projectPath).toBe('/tmp/a');
      expect(useAppStore.getState().projectName).toBe('a');
    });

    it('does not duplicate existing project', () => {
      useAppStore.getState().setProject('/tmp/a', 'a');
      useAppStore.getState().setProject('/tmp/a', 'a');

      expect(useAppStore.getState().projects).toHaveLength(1);
    });
  });

  // ─── removeThread ───────────────────────────────────────────────

  describe('removeThread', () => {
    it('removes thread and deactivates if active', () => {
      useAppStore.getState().setProject('/tmp/proj', 'proj');
      const id = useAppStore.getState().createThread('t', 'local');

      expect(useAppStore.getState().activeThreadId).toBe(id);

      useAppStore.getState().removeThread(id);

      expect(useAppStore.getState().threads).toHaveLength(0);
      expect(useAppStore.getState().activeThreadId).toBeNull();
    });

    it('does not deactivate a different active thread', () => {
      useAppStore.getState().setProject('/tmp/proj', 'proj');
      const id1 = useAppStore.getState().createThread('t1', 'local');
      const id2 = useAppStore.getState().createThread('t2', 'local');

      // id2 is active after creation
      expect(useAppStore.getState().activeThreadId).toBe(id2);

      useAppStore.getState().removeThread(id1);

      expect(useAppStore.getState().threads).toHaveLength(1);
      expect(useAppStore.getState().activeThreadId).toBe(id2);
    });
  });
});
