import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockIpcMain } from '../../utils/mockIpcMain';

const mockSpawn = vi.fn();

function createFakeTerm() {
  const onDataCb: Array<(data: string) => void> = [];
  const onExitCb: Array<() => void> = [];
  return {
    pid: 42,
    onData: vi.fn((cb: (data: string) => void) => { onDataCb.push(cb); }),
    onExit: vi.fn((cb: () => void) => { onExitCb.push(cb); }),
    write: vi.fn(),
    kill: vi.fn(),
    resize: vi.fn(),
    _emitData: (data: string) => onDataCb.forEach((cb) => cb(data)),
    _emitExit: () => onExitCb.forEach((cb) => cb()),
  };
}

describe('src/main/terminal.ts', () => {
  let mockIpcMain: ReturnType<typeof createMockIpcMain>;
  let appListeners: Map<string, Array<(...args: any[]) => void>>;

  beforeEach(() => {
    vi.resetModules();
    mockSpawn.mockReset();

    mockIpcMain = createMockIpcMain();
    appListeners = new Map();
    const app = {
      on: vi.fn((event: string, cb: () => void) => {
        if (!appListeners.has(event)) appListeners.set(event, []);
        appListeners.get(event)!.push(cb);
      }),
    };
    vi.doMock('electron', () => ({ ipcMain: mockIpcMain.ipcMain, app }));
  });

  async function setupWithTerm() {
    const term = createFakeTerm();
    mockSpawn.mockReturnValue(term);
    const mockPty = { spawn: mockSpawn };
    const { setupTerminalHandlers } = await import('../../../src/main/terminal');
    setupTerminalHandlers(mockPty);
    return { term, setupTerminalHandlers };
  }

  // The mockIpcMain.invoke passes a plain {} as the event, but terminal:create
  // reads _event.sender.send for onData forwarding. Provide a sender.
  function invokeCreate(threadId: string, cwd: string) {
    const handler = mockIpcMain.handlers.get('terminal:create');
    if (!handler) throw new Error('No handler registered for terminal:create');
    const send = vi.fn();
    return { promise: handler({ sender: { send } }, threadId, cwd), send };
  }

  it('terminal:create spawns a PTY and returns pid', async () => {
    const { term } = await setupWithTerm();

    const { promise } = invokeCreate('thread-1', '/tmp/project');
    const result = await promise;

    expect(result).toEqual({ pid: 42 });
    expect(mockSpawn).toHaveBeenCalledWith(
      expect.any(String),
      [],
      expect.objectContaining({
        name: 'xterm-256color',
        cols: 120,
        rows: 30,
        cwd: '/tmp/project',
        env: expect.any(Object),
      }),
    );
  });

  it('environment is sanitized — GITHUB_TOKEN excluded', async () => {
    process.env.GITHUB_TOKEN = 'secret-token';
    process.env.GH_TOKEN = 'another-secret';
    process.env.SAFE_VAR = 'safe-value';

    try {
      await setupWithTerm();
      const { promise } = invokeCreate('thread-env', '/tmp');
      await promise;

      const passedEnv = mockSpawn.mock.calls[0][2].env;
      expect(passedEnv).not.toHaveProperty('GITHUB_TOKEN');
      expect(passedEnv).not.toHaveProperty('GH_TOKEN');
      expect(passedEnv.SAFE_VAR).toBe('safe-value');
    } finally {
      delete process.env.GITHUB_TOKEN;
      delete process.env.GH_TOKEN;
      delete process.env.SAFE_VAR;
    }
  });

  it('terminal:data writes to the terminal', async () => {
    const { term } = await setupWithTerm();
    const { promise } = invokeCreate('thread-write', '/tmp');
    await promise;

    mockIpcMain.emit('terminal:data', 'thread-write', 'ls -la\n');
    expect(term.write).toHaveBeenCalledWith('ls -la\n');
  });

  it('terminal:dispose kills the terminal', async () => {
    const { term } = await setupWithTerm();
    const { promise } = invokeCreate('thread-dispose', '/tmp');
    await promise;

    mockIpcMain.emit('terminal:dispose', 'thread-dispose');
    expect(term.kill).toHaveBeenCalled();
  });

  it('terminal:create returns error when node-pty unavailable', async () => {
    const { setupTerminalHandlers } = await import('../../../src/main/terminal');
    setupTerminalHandlers(null);

    const handler = mockIpcMain.handlers.get('terminal:create')!;
    const result = await handler({ sender: { send: vi.fn() } }, 'thread-fail', '/tmp');
    expect(result).toEqual({ error: 'node-pty not available' });
  });

  it('terminal:create returns error when pty.spawn throws', async () => {
    mockSpawn.mockImplementation(() => {
      throw new Error('invalid cwd');
    });
    const mockPty = { spawn: mockSpawn };
    const { setupTerminalHandlers } = await import('../../../src/main/terminal');
    setupTerminalHandlers(mockPty);

    const { promise } = invokeCreate('thread-throw', '/does/not/exist');
    const result = await Promise.resolve(promise);
    expect(result).toEqual({ error: 'invalid cwd' });
  });
});
