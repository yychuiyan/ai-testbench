/**
 * 安装后若无 dist，尝试构建（git 源安装）；npm 正式包已含 dist 则跳过。
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const indexHtml = path.join(root, 'dist', 'index.html');

if (fs.existsSync(indexHtml)) process.exit(0);

/** 优先 pnpm（本项目包管理器），不可用时回退 npm。 */
function pickRunner() {
  const probe = spawnSync('pnpm', ['--version'], {
    stdio: 'ignore',
    shell: process.platform === 'win32',
  });
  if (!probe.error && probe.status === 0) {
    return { cmd: 'pnpm', args: ['build'] };
  }
  return { cmd: 'npm', args: ['run', 'build'] };
}

const hasAstro =
  fs.existsSync(path.join(root, 'node_modules', 'astro')) ||
  fs.existsSync(path.join(root, 'package.json'));

if (!hasAstro) {
  console.warn(
    '[lantern-harness] 缺少 dist/，且无法自动构建。请使用 npm 正式包，或在源码目录执行 pnpm build。',
  );
  process.exit(0);
}

const runner = pickRunner();
console.log(`[lantern-harness] 未找到 dist/，正在执行 ${runner.cmd} ${runner.args.join(' ')} …`);
const r = spawnSync(runner.cmd, runner.args, {
  cwd: root,
  stdio: 'inherit',
  shell: process.platform === 'win32',
  env: { ...process.env, BASE_PATH: '/' },
});
process.exit(r.status === null ? 1 : r.status);
