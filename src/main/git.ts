import { ipcMain } from 'electron';
import simpleGit, { SimpleGit } from 'simple-git';
import * as path from 'path';
import * as fs from 'fs';

const gitInstances = new Map<string, SimpleGit>();

function getGit(projectPath: string): SimpleGit {
  if (!gitInstances.has(projectPath)) {
    gitInstances.set(projectPath, simpleGit(projectPath));
  }
  return gitInstances.get(projectPath)!;
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
    } catch (err: any) {
      return { error: err.message };
    }
  });

  ipcMain.handle('git:diff', async (_event, projectPath: string, staged = false) => {
    try {
      const git = getGit(projectPath);
      const diff = staged ? await git.diff(['--staged']) : await git.diff();
      return { diff };
    } catch (err: any) {
      return { error: err.message };
    }
  });

  ipcMain.handle('git:stage', async (_event, projectPath: string, files: string[]) => {
    try {
      const git = getGit(projectPath);
      await git.add(files);
      return { success: true };
    } catch (err: any) {
      return { error: err.message };
    }
  });

  ipcMain.handle('git:commit', async (_event, projectPath: string, message: string) => {
    try {
      const git = getGit(projectPath);
      const result = await git.commit(message);
      return { hash: result.commit, summary: result.summary };
    } catch (err: any) {
      return { error: err.message };
    }
  });

  ipcMain.handle('git:create-worktree', async (_event, projectPath: string, threadId: string) => {
    try {
      const git = getGit(projectPath);
      const worktreePath = path.join(projectPath, '.copilot-worktrees', threadId);
      const branchName = `copilot/${threadId}`;

      if (!fs.existsSync(path.dirname(worktreePath))) {
        fs.mkdirSync(path.dirname(worktreePath), { recursive: true });
      }

      await git.raw(['worktree', 'add', '-b', branchName, worktreePath]);
      return { worktreePath, branchName };
    } catch (err: any) {
      return { error: err.message };
    }
  });

  ipcMain.handle('git:remove-worktree', async (_event, projectPath: string, worktreePath: string) => {
    try {
      const git = getGit(projectPath);
      await git.raw(['worktree', 'remove', worktreePath, '--force']);
      return { success: true };
    } catch (err: any) {
      return { error: err.message };
    }
  });
}
