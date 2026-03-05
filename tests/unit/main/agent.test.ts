import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockIpcMain } from '../../utils/mockIpcMain';

describe('src/main/agent.ts', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useRealTimers();
    delete process.env.LOOM_TEST_MODE;
    delete process.env.LOOM_TEST_AGENT_RESPONSE;
    delete process.env.LOOM_TEST_AGENT_SCRIPT;
    delete process.env.LOOM_TEST_AGENT_EVENTS;
  });

  it('findCopilotPath resolves path and falls back when command fails', async () => {
    const mockIpcMain = createMockIpcMain();
    const execSyncMock = vi.fn().mockReturnValue('/usr/local/bin/copilot\n');

    vi.doMock('electron', () => ({ ipcMain: mockIpcMain.ipcMain }));
    vi.doMock('child_process', () => ({ execSync: execSyncMock }));

    const { findCopilotPath } = await import('../../../src/main/agent');
    expect(findCopilotPath()).toBe('/usr/local/bin/copilot');

    execSyncMock.mockImplementationOnce(() => {
      throw new Error('not found');
    });
    expect(findCopilotPath()).toBe('copilot');
  });

  it('isConnectionError detects reconnect-worthy errors', async () => {
    const mockIpcMain = createMockIpcMain();
    vi.doMock('electron', () => ({ ipcMain: mockIpcMain.ipcMain }));

    const { isConnectionError } = await import('../../../src/main/agent');
    expect(isConnectionError(new Error('Connection is closed'))).toBe(true);
    expect(isConnectionError(new Error('write after a stream was destroyed'))).toBe(true);
    expect(isConnectionError(new Error('Some other failure'))).toBe(false);
  });

  it('normalizeUsagePayload maps common Copilot usage fields', async () => {
    const mockIpcMain = createMockIpcMain();
    vi.doMock('electron', () => ({ ipcMain: mockIpcMain.ipcMain }));

    const { normalizeUsagePayload } = await import('../../../src/main/agent');
    expect(normalizeUsagePayload({
      usage: {
        promptTokens: '1200',
        completionTokens: 300,
        cacheReadInputTokens: 40,
        cacheCreationInputTokens: 10,
      },
    })).toEqual({
      inputTokens: 1200,
      outputTokens: 300,
      cacheReadTokens: 40,
      cacheWriteTokens: 10,
      totalTokens: 1550,
    });
    expect(normalizeUsagePayload({})).toBeNull();
  });

  it('resolveRunningToolCallId matches explicit IDs and falls back to oldest running call', async () => {
    const mockIpcMain = createMockIpcMain();
    vi.doMock('electron', () => ({ ipcMain: mockIpcMain.ipcMain }));

    const { resolveRunningToolCallId } = await import('../../../src/main/agent');
    const running = ['tc-1', 'tc-2'];
    expect(resolveRunningToolCallId(running)).toBe('tc-1');
    expect(running).toEqual(['tc-2']);
    expect(resolveRunningToolCallId(running, 'tc-2')).toBe('tc-2');
    expect(running).toEqual([]);
  });

  it('waitForIpcReply clears timeout/listener on early reply', async () => {
    vi.useFakeTimers();
    const mockIpcMain = createMockIpcMain();
    vi.doMock('electron', () => ({ ipcMain: mockIpcMain.ipcMain }));

    const { waitForIpcReply } = await import('../../../src/main/agent');
    const sendPrompt = vi.fn();
    const promise = waitForIpcReply(
      'agent:reply:test',
      sendPrompt,
      (approved: boolean) => approved,
      () => false,
      120000,
    );
    expect(sendPrompt).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(1);

    mockIpcMain.emit('agent:reply:test', true);
    await expect(promise).resolves.toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(120000);
    expect(mockIpcMain.ipcMain.removeListener).toHaveBeenCalledTimes(1);
  });

  it('loadAgentsFromProject reads markdown agents and trims metadata', async () => {
    const mockIpcMain = createMockIpcMain();
    vi.doMock('electron', () => ({ ipcMain: mockIpcMain.ipcMain }));

    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'loom-agent-fixture-'));
    const agentsDir = path.join(tmpRoot, '.github', 'agents');
    fs.mkdirSync(agentsDir, { recursive: true });
    fs.writeFileSync(path.join(agentsDir, 'review.agent.md'), '# Review code\nAct as reviewer.');

    const { loadAgentsFromProject } = await import('../../../src/main/agent');
    const agents = loadAgentsFromProject(tmpRoot);
    expect(agents).toHaveLength(1);
    expect(agents[0]).toMatchObject({
      name: 'review',
      displayName: 'Review code',
    });

    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('loadMcpFromProject validates server schema and skips malformed entries', async () => {
    const mockIpcMain = createMockIpcMain();
    vi.doMock('electron', () => ({ ipcMain: mockIpcMain.ipcMain }));

    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'loom-mcp-fixture-'));
    const vscodeDir = path.join(tmpRoot, '.vscode');
    fs.mkdirSync(vscodeDir, { recursive: true });
    fs.writeFileSync(
      path.join(vscodeDir, 'mcp.json'),
      JSON.stringify({
        servers: {
          fs: {
            command: 'npx',
            args: ['-y', '@modelcontextprotocol/server-filesystem'],
            env: { ROOT: '/tmp' },
          },
          browser: {
            command: 'npx',
          },
          badArgs: {
            command: 'npx',
            args: [1, 2, 3],
          },
          badEnv: {
            command: 'npx',
            env: { PORT: 8080 },
          },
          noCommand: {
            args: ['a'],
          },
          invalidNode: 'not-an-object',
        },
      }),
    );

    const { loadMcpFromProject } = await import('../../../src/main/agent');
    const config = loadMcpFromProject(tmpRoot);
    expect(Object.keys(config).sort()).toEqual(['browser', 'fs']);
    expect(config.fs).toEqual({
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-filesystem'],
      env: { ROOT: '/tmp' },
      tools: ['*'],
    });
    expect(config.browser).toEqual({
      command: 'npx',
      args: [],
      tools: ['*'],
    });

    fs.writeFileSync(path.join(vscodeDir, 'mcp.json'), '{invalid-json');
    expect(loadMcpFromProject(tmpRoot)).toEqual({});

    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('setupAgentHandlers registers channels and supports deterministic test mode', async () => {
    process.env.LOOM_TEST_MODE = '1';
    process.env.LOOM_TEST_AGENT_RESPONSE = 'fixture response';
    process.env.LOOM_TEST_AGENT_SCRIPT = JSON.stringify({
      byPrompt: {
        hello: [
          { type: 'status', status: 'Running scripted response' },
          { type: 'thinking', content: 'reasoning trace' },
          { type: 'tool_start', toolCallId: 'tc-1', toolName: 'read_bash' },
          { type: 'tool_end', toolCallId: 'tc-1', success: true, result: 'tool output' },
          { type: 'usage', inputTokens: 120, outputTokens: 45, cacheReadTokens: 30, cacheWriteTokens: 5, totalTokens: 200 },
          { type: 'chunk', content: 'fixture response' },
          { type: 'done', content: 'fixture response' },
        ],
      },
    });

    const mockIpcMain = createMockIpcMain();
    vi.doMock('electron', () => ({ ipcMain: mockIpcMain.ipcMain }));

    const { setupAgentHandlers, getThreadLockCountForTests } = await import('../../../src/main/agent');
    setupAgentHandlers();

    expect(mockIpcMain.handlers.has('agent:list-models')).toBe(true);
    expect(mockIpcMain.handlers.has('agent:list-skills')).toBe(true);
    expect(mockIpcMain.handlers.has('agent:list-agents')).toBe(true);
    expect(mockIpcMain.handlers.has('agent:list-project-mcp')).toBe(true);

    const listener = mockIpcMain.getListener('agent:send');
    expect(listener).toBeDefined();

    const send = vi.fn();
    await listener?.(
      { sender: { send } },
      {
        threadId: 'thread-1',
        requestId: 'req-1',
        message: 'hello',
      },
    );

    expect(getThreadLockCountForTests()).toBe(0);
    expect(send).toHaveBeenCalledWith('agent:stream', 'thread-1', expect.objectContaining({
      type: 'thinking',
      content: 'reasoning trace',
      requestId: 'req-1',
    }));
    expect(send).toHaveBeenCalledWith('agent:stream', 'thread-1', expect.objectContaining({
      type: 'tool_end',
      toolCallId: 'tc-1',
      result: 'tool output',
      requestId: 'req-1',
    }));
    expect(send).toHaveBeenCalledWith('agent:stream', 'thread-1', expect.objectContaining({
      type: 'usage',
      inputTokens: 120,
      outputTokens: 45,
      cacheReadTokens: 30,
      cacheWriteTokens: 5,
      totalTokens: 200,
      requestId: 'req-1',
    }));
    expect(send).toHaveBeenCalledWith('agent:stream', 'thread-1', expect.objectContaining({
      type: 'done',
      content: 'fixture response',
      requestId: 'req-1',
    }));
  });
});
