import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const sessionFile = path.join(repoRoot, 'node_modules', '@github', 'copilot-sdk', 'dist', 'session.js');
const brokenImport = 'from "vscode-jsonrpc/node";';
const fixedImport = 'from "vscode-jsonrpc/node.js";';

try {
  const original = await readFile(sessionFile, 'utf-8');
  if (original.includes(fixedImport)) {
    process.exit(0);
  }
  if (!original.includes(brokenImport)) {
    throw new Error(`Expected import marker not found in ${sessionFile}`);
  }
  await writeFile(sessionFile, original.replace(brokenImport, fixedImport), 'utf-8');
  console.log('[postinstall] patched @github/copilot-sdk session import');
} catch (error) {
  console.error(
    `[postinstall] failed to patch @github/copilot-sdk: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exit(1);
}
