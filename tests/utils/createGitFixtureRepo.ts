import { execSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export interface GitFixtureRepo {
  repoPath: string;
  cleanup: () => void;
}

export function createGitFixtureRepo(): GitFixtureRepo {
  const repoPath = fs.mkdtempSync(path.join(os.tmpdir(), 'loom-git-fixture-'));

  execSync('git init', { cwd: repoPath, stdio: 'ignore' });
  execSync('git config user.email "loom-tests@example.com"', { cwd: repoPath, stdio: 'ignore' });
  execSync('git config user.name "Loom Tests"', { cwd: repoPath, stdio: 'ignore' });

  fs.writeFileSync(path.join(repoPath, 'src.ts'), 'export const value = 1;\n');
  execSync('git add src.ts', { cwd: repoPath, stdio: 'ignore' });
  execSync('git commit -m "initial fixture"', { cwd: repoPath, stdio: 'ignore' });

  fs.writeFileSync(path.join(repoPath, 'src.ts'), 'export const value = 2;\nexport const updated = true;\n');
  fs.writeFileSync(path.join(repoPath, 'new-file.ts'), 'export const created = true;\n');

  return {
    repoPath,
    cleanup: () => {
      fs.rmSync(repoPath, { recursive: true, force: true });
    },
  };
}
