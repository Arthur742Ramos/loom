import * as fs from 'fs';
import * as path from 'path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockIpcMain } from '../../utils/mockIpcMain';

describe('src/main/git.ts', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('parseDiff parses statuses, counts, and line numbers', async () => {
    const mockIpcMain = createMockIpcMain();
    const gitMock = {
      status: vi.fn(),
      diff: vi.fn(),
      add: vi.fn(),
      commit: vi.fn(),
      raw: vi.fn(),
    };

    vi.doMock('electron', () => ({ ipcMain: mockIpcMain.ipcMain }));
    vi.doMock('simple-git', () => ({ __esModule: true, default: vi.fn(() => gitMock) }));

    const { parseDiff } = await import('../../../src/main/git');
    const fixture = fs.readFileSync(path.resolve(process.cwd(), 'tests/fixtures/git-diff.txt'), 'utf-8');
    const files = parseDiff(fixture);

    expect(files).toHaveLength(4);
    expect(files.map((f) => f.status)).toEqual(['modified', 'added', 'deleted', 'renamed']);

    const modified = files.find((f) => f.path === 'src/modified.ts');
    expect(modified?.additions).toBe(1);
    expect(modified?.deletions).toBe(0);
    expect(modified?.hunks[0].lines[1]).toMatchObject({
      type: 'add',
      oldLine: null,
      newLine: 2,
      content: 'export const added = true;',
    });

    const renamed = files.find((f) => f.path === 'src/new-name.ts');
    expect(renamed?.oldPath).toBe('src/old-name.ts');
  });

  it('setupGitHandlers wires ipc handlers and returns normalized results', async () => {
    const mockIpcMain = createMockIpcMain();
    const gitMock = {
      status: vi.fn().mockResolvedValue({
        modified: ['src.ts'],
        created: ['new.ts'],
        deleted: [],
        staged: ['src.ts'],
        not_added: ['tmp.ts'],
        conflicted: [],
        current: 'main',
        tracking: 'origin/main',
        ahead: 0,
        behind: 0,
      }),
      diff: vi.fn().mockResolvedValue(
        fs.readFileSync(path.resolve(process.cwd(), 'tests/fixtures/git-diff.txt'), 'utf-8'),
      ),
      add: vi.fn().mockResolvedValue(undefined),
      commit: vi.fn().mockResolvedValue({ commit: 'abc123', summary: { changes: 1 } }),
      raw: vi.fn().mockResolvedValue(undefined),
    };

    vi.doMock('electron', () => ({ ipcMain: mockIpcMain.ipcMain }));
    vi.doMock('simple-git', () => ({ __esModule: true, default: vi.fn(() => gitMock) }));

    const { setupGitHandlers } = await import('../../../src/main/git');
    setupGitHandlers();

    const status = await mockIpcMain.invoke('git:status', '/tmp/repo');
    expect(status).toMatchObject({
      modified: ['src.ts'],
      created: ['new.ts'],
      current: 'main',
      tracking: 'origin/main',
    });

    const diff = await mockIpcMain.invoke('git:diff', '/tmp/repo', true);
    expect(gitMock.diff).toHaveBeenCalledWith(['--staged']);
    expect(diff.files).toHaveLength(4);

    const stageResult = await mockIpcMain.invoke('git:stage', '/tmp/repo', ['src.ts']);
    expect(stageResult).toEqual({ success: true });
    expect(gitMock.add).toHaveBeenCalledWith(['src.ts']);
  });
});
