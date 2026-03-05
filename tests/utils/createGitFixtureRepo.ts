import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export interface GitFixtureRepo {
  repoPath: string;
  cleanup: () => void;
}

const NULL_DEVICE_PATH = process.platform === 'win32' ? 'NUL' : '/dev/null';

const toText = (value: unknown): string => {
  if (typeof value === 'string') return value;
  if (Buffer.isBuffer(value)) return value.toString('utf-8');
  return '';
};

const runGit = (repoPath: string, args: string[]): void => {
  try {
    execFileSync(
      'git',
      ['-c', `core.attributesfile=${NULL_DEVICE_PATH}`, '-c', 'filter.lfs.required=false', ...args],
      {
        cwd: repoPath,
        stdio: 'pipe',
        env: {
          ...process.env,
          GIT_TERMINAL_PROMPT: '0',
          GIT_LFS_SKIP_SMUDGE: '1',
          HUSKY: '0',
        },
      },
    );
  } catch (error: unknown) {
    const details = error as { stdout?: unknown; stderr?: unknown; message?: string };
    const stderr = toText(details.stderr).trim();
    const stdout = toText(details.stdout).trim();
    const output = [stderr, stdout].filter(Boolean).join('\n');
    const command = `git ${args.join(' ')}`;
    throw new Error(output ? `${command} failed:\n${output}` : details.message || `${command} failed`);
  }
};

export function createGitFixtureRepo(): GitFixtureRepo {
  const repoPath = fs.mkdtempSync(path.join(os.tmpdir(), 'loom-git-fixture-'));

  runGit(repoPath, ['init']);
  runGit(repoPath, ['config', 'core.autocrlf', 'false']);
  runGit(repoPath, ['config', 'core.safecrlf', 'false']);
  runGit(repoPath, ['config', 'user.email', 'loom-tests@example.com']);
  runGit(repoPath, ['config', 'user.name', 'Loom Tests']);

  fs.writeFileSync(path.join(repoPath, 'src.ts'), 'export const value = 1;\n');
  runGit(repoPath, ['add', '--', 'src.ts']);
  runGit(repoPath, ['commit', '--no-gpg-sign', '-m', 'initial fixture']);

  fs.writeFileSync(path.join(repoPath, 'src.ts'), 'export const value = 2;\nexport const updated = true;\n');
  fs.writeFileSync(path.join(repoPath, 'new-file.ts'), 'export const created = true;\n');

  return {
    repoPath,
    cleanup: () => {
      fs.rmSync(repoPath, { recursive: true, force: true });
    },
  };
}
