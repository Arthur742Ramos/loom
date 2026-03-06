import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DiffView } from '../../../src/renderer/components/DiffView';
import { DiffFile } from '../../../src/shared/types';
import { createMockIpcRenderer, installElectronMock, MockIpcRenderer } from '../../utils/mockElectronRenderer';

const initialFiles: DiffFile[] = [
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
];

const refreshedFiles: DiffFile[] = [
  {
    path: 'src.ts',
    status: 'modified',
    additions: 1,
    deletions: 0,
    hunks: [
      {
        oldStart: 1,
        oldCount: 1,
        newStart: 1,
        newCount: 2,
        header: 'export const value',
        lines: [
          { type: 'ctx', oldLine: 1, newLine: 1, content: 'export const value = 1;' },
          { type: 'add', oldLine: null, newLine: 2, content: 'export const stagedOnly = true;' },
        ],
      },
    ],
  },
  {
    path: 'extra.ts',
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
          { type: 'add', oldLine: null, newLine: 1, content: 'export const staged = true;' },
        ],
      },
    ],
  },
];

describe('DiffView', () => {
  let ipcRenderer: MockIpcRenderer;
  let restoreElectronMock: () => void;

  const deferred = <T,>() => {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((res) => {
      resolve = res;
    });
    return { promise, resolve };
  };

  const getFileToggle = (filePath: string) => screen.getByRole('button', { name: new RegExp(filePath.replace('.', '\\.'), 'i') });

  beforeEach(() => {
    ipcRenderer = createMockIpcRenderer();
    restoreElectronMock = installElectronMock(ipcRenderer);
  });

  afterEach(() => {
    cleanup();
    restoreElectronMock();
  });

  it('shows a loading skeleton before the first diff payload renders', async () => {
    const diffRequest = deferred<{ files?: DiffFile[] }>();
    ipcRenderer.invoke.mockImplementation(async (channel: string) => {
      if (channel === 'git:diff') return diffRequest.promise;
      return null;
    });

    render(<DiffView projectPath="Q:\\repo" />);

    await waitFor(() => expect(screen.getByTestId('diff-loading')).toBeInTheDocument());
    expect(screen.getByText('Loading unstaged changes…')).toBeInTheDocument();

    diffRequest.resolve({ files: initialFiles });

    await waitFor(() => expect(screen.getByText('src.ts')).toBeInTheDocument());
    expect(screen.queryByTestId('diff-loading')).not.toBeInTheDocument();
    expect(screen.getByText(/2 files/i)).toBeInTheDocument();
  });

  it('preserves collapsed files and ignores stale refresh responses', async () => {
    const delayedRefresh = deferred<{ files?: DiffFile[] }>();
    const stagedRefresh = deferred<{ files?: DiffFile[] }>();
    let diffCallCount = 0;

    ipcRenderer.invoke.mockImplementation(async (channel: string) => {
      if (channel !== 'git:diff') return null;
      diffCallCount += 1;
      if (diffCallCount === 1) return { files: initialFiles };
      if (diffCallCount === 2) return delayedRefresh.promise;
      return stagedRefresh.promise;
    });

    render(<DiffView projectPath="Q:\\repo" />);

    await waitFor(() => expect(screen.getByText('src.ts')).toBeInTheDocument());

    fireEvent.click(getFileToggle('src.ts'));
    expect(getFileToggle('src.ts')).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(screen.getByTestId('diff-refresh-button'));
    fireEvent.click(screen.getByRole('button', { name: /^Staged$/i }));

    await waitFor(() => expect(screen.getByRole('button', { name: /^Staged$/i })).toHaveAttribute('aria-pressed', 'true'));
    await waitFor(() => {
      const lastCall = ipcRenderer.invoke.mock.calls.at(-1);
      expect(lastCall?.[0]).toBe('git:diff');
      expect(lastCall?.[2]).toBe(true);
    });

    stagedRefresh.resolve({ files: refreshedFiles });

    await waitFor(() => expect(screen.getByText('extra.ts')).toBeInTheDocument());
    expect(getFileToggle('src.ts')).toHaveAttribute('aria-expanded', 'false');
    expect(getFileToggle('extra.ts')).toHaveAttribute('aria-expanded', 'true');

    delayedRefresh.resolve({
      files: [
        {
          path: 'stale.ts',
          status: 'added',
          additions: 1,
          deletions: 0,
          hunks: [],
        },
      ],
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.queryByText('stale.ts')).not.toBeInTheDocument();
  });
});
