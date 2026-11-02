import { spawnSync } from 'node:child_process';
import { existsSync, lstatSync, realpathSync, rmSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = realpathSync(dirname(dirname(fileURLToPath(import.meta.url))));
const output = resolve(root, 'dist');
// Only this project's generated dist is disposable. Refuse a redirected output.
if (relative(root, output) !== 'dist') throw new Error('Unexpected build output path.');
if (existsSync(output)) {
  if (lstatSync(output).isSymbolicLink() || relative(root, realpathSync(output)) !== 'dist') {
    throw new Error('Refusing to clean a redirected dist directory.');
  }
  rmSync(output, { recursive: true, force: true });
}
const result = spawnSync(process.execPath, [join(root, 'node_modules', 'typescript', 'bin', 'tsc'), '-p', 'tsconfig.json', '--outDir', 'dist'], {
  cwd: root, stdio: 'inherit', windowsHide: true, timeout: 120000,
});
if (result.error) console.error(result.error.message);
process.exitCode = result.status === 0 && !result.error ? 0 : 1;
