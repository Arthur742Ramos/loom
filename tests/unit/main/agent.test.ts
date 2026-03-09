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

  it('loadAgentsFromProject skips unreadable agent files', async () => {
    const mockIpcMain = createMockIpcMain();
    vi.doMock('electron', () => ({ ipcMain: mockIpcMain.ipcMain }));

    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'loom-agent-skip-fixture-'));
    const agentsDir = path.join(tmpRoot, '.github', 'agents');
    fs.mkdirSync(agentsDir, { recursive: true });
    const goodPath = path.join(agentsDir, 'good.agent.md');
    const badPath = path.join(agentsDir, 'bad.agent.md');
    fs.writeFileSync(goodPath, '# Good agent\nHandle the happy path.');
    fs.mkdirSync(badPath, { recursive: true });

    const { loadAgentsFromProject } = await import('../../../src/main/agent');
    const agents = loadAgentsFromProject(tmpRoot);

    expect(agents).toHaveLength(1);
    expect(agents[0]).toMatchObject({
      name: 'good',
      displayName: 'Good agent',
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
          remote: {
            url: 'https://example-mcp.example.com/sse',
            type: 'sse',
          },
          remotePlain: {
            url: 'http://localhost:3000/mcp',
          },
          remoteAuth: {
            url: 'https://cloudbuildmcp.azurewebsites.net/cloudbuildmcp/',
            type: 'http',
            headers: { Authorization: 'Bearer test-token' },
          },
          badArgs: {
            command: 'npx',
            args: [1, 2, 3],
          },
          badEnv: {
            command: 'npx',
            env: { PORT: 8080 },
          },
          badHeaders: {
            url: 'https://example-mcp.example.com/sse',
            headers: { Authorization: 123 },
          },
          noCommandOrUrl: {
            args: ['a'],
          },
          invalidNode: 'not-an-object',
          emptyUrl: {
            url: '  ',
          },
        },
      }),
    );

    const { loadMcpFromProject } = await import('../../../src/main/agent');
    const config = loadMcpFromProject(tmpRoot);
    expect(Object.keys(config).sort()).toEqual(['browser', 'fs', 'remote', 'remoteAuth', 'remotePlain']);
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
    expect(config.remote).toEqual({
      url: 'https://example-mcp.example.com/sse',
      type: 'sse',
      tools: ['*'],
    });
    expect(config.remotePlain).toEqual({
      url: 'http://localhost:3000/mcp',
      tools: ['*'],
    });
    expect(config.remoteAuth).toEqual({
      url: 'https://cloudbuildmcp.azurewebsites.net/cloudbuildmcp/',
      type: 'http',
      headers: { Authorization: 'Bearer test-token' },
      tools: ['*'],
    });

    fs.writeFileSync(path.join(vscodeDir, 'mcp.json'), '{invalid-json');
    expect(loadMcpFromProject(tmpRoot)).toEqual({});

    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('loadMcpFromProject falls back to the secondary config when the first one is invalid', async () => {
    const mockIpcMain = createMockIpcMain();
    vi.doMock('electron', () => ({ ipcMain: mockIpcMain.ipcMain }));

    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'loom-mcp-fallback-fixture-'));
    const vscodeDir = path.join(tmpRoot, '.vscode');
    const githubCopilotDir = path.join(tmpRoot, '.github', 'copilot');
    fs.mkdirSync(vscodeDir, { recursive: true });
    fs.mkdirSync(githubCopilotDir, { recursive: true });
    fs.writeFileSync(path.join(vscodeDir, 'mcp.json'), '{invalid-json');
    fs.writeFileSync(
      path.join(githubCopilotDir, 'mcp.json'),
      JSON.stringify({
        servers: {
          cloudbuild: {
            url: 'https://example.invalid/mcp',
          },
        },
      }),
    );

    const { loadMcpFromProject } = await import('../../../src/main/agent');
    expect(loadMcpFromProject(tmpRoot)).toEqual({
      cloudbuild: {
        url: 'https://example.invalid/mcp',
        tools: ['*'],
      },
    });

    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('inspectProjectMcp reports recovery warnings and the config source it used', async () => {
    const mockIpcMain = createMockIpcMain();
    vi.doMock('electron', () => ({ ipcMain: mockIpcMain.ipcMain }));

    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'loom-mcp-diagnostics-fixture-'));
    const vscodeDir = path.join(tmpRoot, '.vscode');
    const githubCopilotDir = path.join(tmpRoot, '.github', 'copilot');
    fs.mkdirSync(vscodeDir, { recursive: true });
    fs.mkdirSync(githubCopilotDir, { recursive: true });
    fs.writeFileSync(path.join(vscodeDir, 'mcp.json'), '{invalid-json');
    fs.writeFileSync(
      path.join(githubCopilotDir, 'mcp.json'),
      JSON.stringify({
        servers: {
          cloudbuild: {
            url: 'https://example.invalid/mcp',
          },
        },
      }),
    );

    const { inspectProjectMcp } = await import('../../../src/main/agent');
    expect(inspectProjectMcp(tmpRoot)).toEqual({
      servers: {
        cloudbuild: {
          url: 'https://example.invalid/mcp',
          tools: ['*'],
        },
      },
      searchedFiles: ['.vscode/mcp.json', '.github/copilot/mcp.json'],
      sourceFile: '.github/copilot/mcp.json',
      issues: [
        {
          severity: 'error',
          message: expect.stringContaining('Skipped .vscode/mcp.json because it contains invalid JSON.'),
        },
      ],
    });

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
    expect(mockIpcMain.handlers.has('agent:inspect-project-mcp')).toBe(true);

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

  it('agent:list-models dedupes results and reuses in-flight/cache lookups', async () => {
    const mockIpcMain = createMockIpcMain();
    vi.doMock('electron', () => ({ ipcMain: mockIpcMain.ipcMain }));

    let resolveModels!: (models: any[]) => void;
    const pendingModels = new Promise<any[]>((resolve) => {
      resolveModels = resolve;
    });
    const listModels = vi.fn().mockReturnValue(pendingModels);
    const start = vi.fn().mockResolvedValue(undefined);

    const { setupAgentHandlers, setClientForTests } = await import('../../../src/main/agent');
    setClientForTests({
      createSession: vi.fn(),
      resumeSession: vi.fn(),
      listModels,
      start,
      forceStop: vi.fn(),
    });
    setupAgentHandlers();

    const firstPromise = mockIpcMain.invoke('agent:list-models');
    const secondPromise = mockIpcMain.invoke('agent:list-models');
    resolveModels([
      { id: 'gpt-4.1', supportedReasoningEfforts: ['medium', 'medium'] },
      { id: 'gpt-4.1', name: 'GPT 4.1', supportedReasoningEfforts: ['high'] },
      { name: 'claude-sonnet-4', supportedReasoningEfforts: ['low', 'low'] },
      {},
    ]);

    const [firstResult, secondResult] = await Promise.all([firstPromise, secondPromise]);
    expect(start).toHaveBeenCalledTimes(1);
    expect(listModels).toHaveBeenCalledTimes(1);
    expect(firstResult).toEqual({
      success: true,
      models: [
        {
          id: 'gpt-4.1',
          label: 'GPT 4.1',
          provider: 'OpenAI',
          supportedReasoningEfforts: ['medium', 'high'],
        },
        {
          id: 'claude-sonnet-4',
          label: 'claude-sonnet-4',
          provider: 'Anthropic',
          supportedReasoningEfforts: ['low'],
        },
      ],
    });
    expect(secondResult).toEqual(firstResult);

    const cachedResult = await mockIpcMain.invoke('agent:list-models');
    expect(cachedResult).toEqual(firstResult);
    expect(listModels).toHaveBeenCalledTimes(1);
  });

  it('agent:list-models briefly caches failures to avoid repeated retries', async () => {
    vi.useFakeTimers();
    const mockIpcMain = createMockIpcMain();
    vi.doMock('electron', () => ({ ipcMain: mockIpcMain.ipcMain }));

    const listModels = vi.fn().mockRejectedValue(new Error('auth failed'));
    const start = vi.fn().mockResolvedValue(undefined);

    const { setupAgentHandlers, setClientForTests } = await import('../../../src/main/agent');
    setClientForTests({
      createSession: vi.fn(),
      resumeSession: vi.fn(),
      listModels,
      start,
      forceStop: vi.fn(),
    });
    setupAgentHandlers();

    const firstResult = await mockIpcMain.invoke('agent:list-models');
    const secondResult = await mockIpcMain.invoke('agent:list-models');

    expect(firstResult).toEqual({ success: false, error: 'auth failed' });
    expect(secondResult).toEqual(firstResult);
    expect(listModels).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(5001);
    const thirdResult = await mockIpcMain.invoke('agent:list-models');
    expect(thirdResult).toEqual(firstResult);
    expect(listModels).toHaveBeenCalledTimes(2);
  });

  it('agent:list-models retries once after connection failures', async () => {
    process.env.LOOM_TEST_MODE = '1';
    const mockIpcMain = createMockIpcMain();
    const firstClient = {
      createSession: vi.fn(),
      resumeSession: vi.fn(),
      listModels: vi.fn().mockRejectedValue(new Error('Connection is closed')),
      start: vi.fn().mockResolvedValue(undefined),
      forceStop: vi.fn(),
    };
    const secondClient = {
      createSession: vi.fn(),
      resumeSession: vi.fn(),
      listModels: vi.fn().mockResolvedValue([{ id: 'gpt-4.1', name: 'GPT 4.1' }]),
      start: vi.fn().mockResolvedValue(undefined),
      forceStop: vi.fn(),
    };

    vi.doMock('electron', () => ({ ipcMain: mockIpcMain.ipcMain }));

    let clientCallCount = 0;
    const { setupAgentHandlers, setClientForTests } = await import('../../../src/main/agent');
    setClientForTests(() => {
      clientCallCount += 1;
      return clientCallCount === 1 ? firstClient : secondClient;
    });
    setupAgentHandlers();

    const result = await mockIpcMain.invoke('agent:list-models');
    expect(clientCallCount).toBe(2);
    expect(firstClient.forceStop).toHaveBeenCalledTimes(1);
    expect(secondClient.listModels).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      success: true,
      models: [
        {
          id: 'gpt-4.1',
          label: 'GPT 4.1',
          provider: 'OpenAI',
          supportedReasoningEfforts: [],
        },
      ],
    });
  });

  it('discovery handlers return safe defaults for invalid project paths', async () => {
    const mockIpcMain = createMockIpcMain();
    vi.doMock('electron', () => ({ ipcMain: mockIpcMain.ipcMain }));

    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'loom-invalid-project-fixture-'));
    const filePath = path.join(tmpRoot, 'not-a-directory.txt');
    fs.writeFileSync(filePath, 'fixture');

    const { setupAgentHandlers } = await import('../../../src/main/agent');
    setupAgentHandlers();

    await expect(mockIpcMain.invoke('agent:list-skills', 'relative-project')).resolves.toEqual([]);
    await expect(mockIpcMain.invoke('agent:list-skills', filePath)).resolves.toEqual([]);
    await expect(mockIpcMain.invoke('agent:list-agents', '')).resolves.toEqual([]);
    await expect(mockIpcMain.invoke('agent:list-project-mcp', undefined)).resolves.toEqual({});
    await expect(mockIpcMain.invoke('agent:inspect-project-mcp', filePath)).resolves.toEqual({
      servers: {},
      searchedFiles: [],
      sourceFile: null,
      issues: [],
    });

    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('discovery handlers skip unreadable markdown files instead of failing the whole load', async () => {
    const mockIpcMain = createMockIpcMain();
    vi.doMock('electron', () => ({ ipcMain: mockIpcMain.ipcMain }));

    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'loom-discovery-fixture-'));
    const skillsDir = path.join(tmpRoot, '.github', 'copilot', 'skills');
    const agentsDir = path.join(tmpRoot, '.github', 'agents');
    fs.mkdirSync(skillsDir, { recursive: true });
    fs.mkdirSync(agentsDir, { recursive: true });
    const goodSkillPath = path.join(skillsDir, 'good.md');
    const badSkillPath = path.join(skillsDir, 'bad.md');
    const goodAgentPath = path.join(agentsDir, 'good.agent.md');
    const badAgentPath = path.join(agentsDir, 'bad.agent.md');
    fs.writeFileSync(goodSkillPath, '# Good skill\nHelpful instructions.');
    fs.mkdirSync(badSkillPath, { recursive: true });
    fs.writeFileSync(goodAgentPath, '# Good agent\nHelpful prompt.');
    fs.mkdirSync(badAgentPath, { recursive: true });

    const { setupAgentHandlers } = await import('../../../src/main/agent');
    setupAgentHandlers();

    const skills = await mockIpcMain.invoke('agent:list-skills', tmpRoot);
    const agents = await mockIpcMain.invoke('agent:list-agents', tmpRoot);

    expect(skills).toEqual([
      {
        name: 'good',
        path: goodSkillPath,
        description: 'Good skill',
      },
    ]);
    expect(agents).toEqual([
      {
        name: 'good',
        path: goodAgentPath,
        description: 'Good agent',
      },
    ]);

    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('agent:list-agents ignores YAML frontmatter when deriving descriptions', async () => {
    const mockIpcMain = createMockIpcMain();
    vi.doMock('electron', () => ({ ipcMain: mockIpcMain.ipcMain }));

    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'loom-agent-frontmatter-fixture-'));
    const agentsDir = path.join(tmpRoot, '.github', 'agents');
    fs.mkdirSync(agentsDir, { recursive: true });
    const agentPath = path.join(agentsDir, 'frontmatter.agent.md');
    fs.writeFileSync(agentPath, '---\ntitle: Frontmatter title\n---\n# Real agent title\nBody');

    const { setupAgentHandlers } = await import('../../../src/main/agent');
    setupAgentHandlers();

    const agents = await mockIpcMain.invoke('agent:list-agents', tmpRoot);
    expect(agents).toEqual([
      {
        name: 'frontmatter',
        path: agentPath,
        description: 'Real agent title',
      },
    ]);

    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('passes skillDirectories to create/resume and forwards @agent prompt text unchanged', async () => {
    const mockIpcMain = createMockIpcMain();
    vi.doMock('electron', () => ({ ipcMain: mockIpcMain.ipcMain }));

    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'loom-skill-fixture-'));
    const githubSkillDir = path.join(tmpRoot, '.github', 'copilot', 'skills');
    const dotCopilotSkillDir = path.join(tmpRoot, '.copilot', 'skills');
    fs.mkdirSync(githubSkillDir, { recursive: true });
    fs.mkdirSync(dotCopilotSkillDir, { recursive: true });
    fs.writeFileSync(path.join(githubSkillDir, 'build.md'), '# Build\nRun build steps.');
    fs.writeFileSync(path.join(dotCopilotSkillDir, 'review.md'), '# Review\nRun review steps.');

    const createSendAndWait = vi.fn().mockResolvedValue({ data: { content: 'created' } });
    const resumeSendAndWait = vi.fn().mockResolvedValue({ data: { content: 'resumed' } });
    const createSession = vi.fn().mockResolvedValue({
      sessionId: 'session-1',
      on: vi.fn().mockReturnValue(() => {}),
      sendAndWait: createSendAndWait,
    });
    const resumeSession = vi.fn().mockResolvedValue({
      sessionId: 'session-1',
      on: vi.fn().mockReturnValue(() => {}),
      sendAndWait: resumeSendAndWait,
    });
    const { setupAgentHandlers, getThreadLockCountForTests, setClientForTests } = await import('../../../src/main/agent');
    setClientForTests({
      createSession,
      resumeSession,
      forceStop: vi.fn(),
    });
    setupAgentHandlers();

    const listener = mockIpcMain.getListener('agent:send');
    expect(listener).toBeDefined();
    const send = vi.fn();

    await listener?.(
      { sender: { send } },
      {
        threadId: 'thread-1',
        requestId: 'req-1',
        message: 'first call',
        context: { cwd: tmpRoot },
      },
    );

    const prompt = '@agent review please run @skill build';
    await listener?.(
      { sender: { send } },
      {
        threadId: 'thread-1',
        requestId: 'req-2',
        message: prompt,
        context: { cwd: tmpRoot },
      },
    );

    expect(getThreadLockCountForTests()).toBe(0);
    expect(createSession).toHaveBeenCalledWith(expect.objectContaining({
      workingDirectory: tmpRoot,
      configDir: tmpRoot,
      skillDirectories: [githubSkillDir, dotCopilotSkillDir],
    }));
    expect(resumeSession).toHaveBeenCalledWith(
      'session-1',
      expect.objectContaining({
        workingDirectory: tmpRoot,
        configDir: tmpRoot,
        skillDirectories: [githubSkillDir, dotCopilotSkillDir],
      }),
    );
    expect(resumeSendAndWait).toHaveBeenCalledWith({ prompt }, 2147483647);

    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('rejects malformed agent:send payloads with a structured stream error', async () => {
    const mockIpcMain = createMockIpcMain();
    vi.doMock('electron', () => ({ ipcMain: mockIpcMain.ipcMain }));

    const { setupAgentHandlers } = await import('../../../src/main/agent');
    setupAgentHandlers();

    const listener = mockIpcMain.getListener('agent:send');
    expect(listener).toBeDefined();

    const send = vi.fn();
    await listener?.(
      { sender: { send } },
      { message: 'hello without thread id' },
    );

    expect(send).toHaveBeenCalledWith('agent:stream', 'unknown', {
      type: 'error',
      content: 'Missing threadId',
    });
  });
});
