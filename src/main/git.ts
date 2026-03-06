import { ipcMain } from 'electron';
import simpleGit, { SimpleGit } from 'simple-git';
import * as path from 'path';
import * as fs from 'fs';
import { DiffFile, DiffHunk, GitBranchListResult, GitCheckoutResult } from '../shared/types';

const gitInstances = new Map<string, SimpleGit>();
const GIT_INSTANCE_MAX = 20;

function evictGitInstances() {
  if (gitInstances.size <= GIT_INSTANCE_MAX) return;
  // Remove oldest entries (first inserted) to stay under limit.
  const excess = gitInstances.size - GIT_INSTANCE_MAX;
  const keys = [...gitInstances.keys()];
  for (let i = 0; i < excess; i++) {
    gitInstances.delete(keys[i]);
  }
}

const toErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

export function parseDiff(raw: string): DiffFile[] {
  const files: DiffFile[] = [];
  // Split on "diff --git" boundaries
  const fileSections = raw.split(/^diff --git /m).filter(Boolean);

  for (const section of fileSections) {
    const lines = section.split('\n');
    // Parse file paths: "a/path b/path"
    const headerMatch = lines[0]?.match(/a\/(.+?) b\/(.+)/);
    if (!headerMatch) continue;

    const oldPath = headerMatch[1];
    const newPath = headerMatch[2];
    const isNew = section.includes('new file mode');
    const isDeleted = section.includes('deleted file mode');
    const isRenamed = oldPath !== newPath;

    const file: DiffFile = {
      path: newPath,
      oldPath: isRenamed ? oldPath : undefined,
      status: isNew ? 'added' : isDeleted ? 'deleted' : isRenamed ? 'renamed' : 'modified',
      hunks: [],
      additions: 0,
      deletions: 0,
    };

    let currentHunk: DiffHunk | null = null;
    let oldLine = 0;
    let newLine = 0;

    for (const line of lines) {
      const hunkMatch = line.match(/^@@\s+-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s+@@(.*)/);
      if (hunkMatch) {
        currentHunk = {
          oldStart: parseInt(hunkMatch[1]),
          oldCount: parseInt(hunkMatch[2] || '1'),
          newStart: parseInt(hunkMatch[3]),
          newCount: parseInt(hunkMatch[4] || '1'),
          header: hunkMatch[5]?.trim() || '',
          lines: [],
        };
        file.hunks.push(currentHunk);
        oldLine = currentHunk.oldStart;
        newLine = currentHunk.newStart;
        continue;
      }

      if (!currentHunk) continue;

      if (line.startsWith('+')) {
        currentHunk.lines.push({ type: 'add', oldLine: null, newLine: newLine++, content: line.substring(1) });
        file.additions++;
      } else if (line.startsWith('-')) {
        currentHunk.lines.push({ type: 'del', oldLine: oldLine++, newLine: null, content: line.substring(1) });
        file.deletions++;
      } else if (line.startsWith(' ')) {
        currentHunk.lines.push({ type: 'ctx', oldLine: oldLine++, newLine: newLine++, content: line.substring(1) });
      }
    }

    files.push(file);
  }

  return files;
}

function getGit(projectPath: string): SimpleGit {
  const existing = gitInstances.get(projectPath);
  if (existing) {
    // Move to end (most recently used) for LRU ordering.
    gitInstances.delete(projectPath);
    gitInstances.set(projectPath, existing);
    return existing;
  }
  evictGitInstances();
  const git = simpleGit(projectPath);
  gitInstances.set(projectPath, git);
  return git;
}

function isValidThreadId(threadId: string): boolean {
  return /^[\w-]+$/.test(threadId);
}

export function setupGitHandlers() {
  ipcMain.handle('git:status', async (_event, projectPath: string) => {
    try {
      const git = getGit(projectPath);
      const status = await git.status();
      return {
        modified: status.modified,
        created: status.created,
        deleted: status.deleted,
        staged: status.staged,
        not_added: status.not_added,
        conflicted: status.conflicted,
        current: status.current,
        tracking: status.tracking,
        ahead: status.ahead,
        behind: status.behind,
      };
    } catch (error: unknown) {
      return { error: toErrorMessage(error) };
    }
  });

  ipcMain.handle('git:list-branches', async (_event, projectPath: string): Promise<GitBranchListResult> => {
    try {
      const git = getGit(projectPath);
      const branches = await git.branchLocal();
      return {
        branches: branches.all,
        current: branches.current || null,
        detached: Boolean(branches.detached),
      };
    } catch (error: unknown) {
      return {
        branches: [],
        current: null,
        detached: false,
        error: toErrorMessage(error),
      };
    }
  });

  ipcMain.handle(
    'git:checkout',
    async (_event, projectPath: string, branchName: string): Promise<GitCheckoutResult> => {
      const normalizedBranchName = typeof branchName === 'string' ? branchName.trim() : '';
      if (!normalizedBranchName) {
        return { error: 'Branch name is required' };
      }
      try {
        const git = getGit(projectPath);
        await git.checkout(normalizedBranchName);
        const status = await git.status();
        return {
          success: true,
          current: status.current || normalizedBranchName,
        };
      } catch (error: unknown) {
        return { error: toErrorMessage(error) };
      }
    },
  );

  ipcMain.handle('git:diff', async (_event, projectPath: string, staged = false) => {
    try {
      const git = getGit(projectPath);
      const raw = staged ? await git.diff(['--staged']) : await git.diff();
      return { diff: raw, files: parseDiff(raw) };
    } catch (error: unknown) {
      return { error: toErrorMessage(error) };
    }
  });

  ipcMain.handle('git:stage', async (_event, projectPath: string, files: string[]) => {
    try {
      const git = getGit(projectPath);
      await git.add(files);
      return { success: true };
    } catch (error: unknown) {
      return { error: toErrorMessage(error) };
    }
  });

  ipcMain.handle('git:commit', async (_event, projectPath: string, message: string) => {
    try {
      const git = getGit(projectPath);
      const result = await git.commit(message);
      return { hash: result.commit, summary: result.summary };
    } catch (error: unknown) {
      return { error: toErrorMessage(error) };
    }
  });

  ipcMain.handle('git:create-worktree', async (_event, projectPath: string, threadId: string) => {
    if (!isValidThreadId(threadId)) {
      return { error: 'Invalid thread ID' };
    }
    try {
      const git = getGit(projectPath);
      const worktreePath = path.join(projectPath, '.copilot-worktrees', threadId);
      const branchName = `copilot/${threadId}`;

      if (!fs.existsSync(path.dirname(worktreePath))) {
        fs.mkdirSync(path.dirname(worktreePath), { recursive: true });
      }

      await git.raw(['worktree', 'add', '-b', branchName, worktreePath]);
      return { worktreePath, branchName };
    } catch (error: unknown) {
      return { error: toErrorMessage(error) };
    }
  });

  ipcMain.handle('git:remove-worktree', async (_event, projectPath: string, worktreePath: string) => {
    try {
      const git = getGit(projectPath);
      await git.raw(['worktree', 'remove', worktreePath, '--force']);
      return { success: true };
    } catch (error: unknown) {
      return { error: toErrorMessage(error) };
    }
  });
}
