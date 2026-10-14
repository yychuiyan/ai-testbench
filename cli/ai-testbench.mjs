#!/usr/bin/env node
/**
 * ai-testbench CLI：安装 npm 包后本地起一体服务。
 *
 * 用法：
 *   npx ai-testbench
 *   npx ai-testbench --dir ~/my-desk
 *   npx ai-testbench --pick
 *   npx ai-testbench -y          # 不询问，使用当前目录
 *   npx ai-testbench --port 4321
 */
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { nativePickDirectory } from '../builtin/session/tb-fs.mjs';
import { startLocalServer } from './server.mjs';

function printHelp() {
  console.log(`TestBench · 本地服务

用法:
  ai-testbench [选项]

选项:
  -d, --dir <路径>   数据目录（知识库/用例/记忆等落盘位置）
  -p, --pick         用系统文件夹选择器选择数据目录
  -y, --yes          不交互，直接使用当前工作目录
  --port <端口>      默认 4321
  --host <主机>      默认 127.0.0.1
  -h, --help         显示帮助

示例:
  npx ai-testbench
  npx ai-testbench --dir ~/qa-workbench
  npx ai-testbench --pick
`);
}

function parseArgs(argv) {
  const out = {
    dir: null,
    pick: false,
    yes: false,
    port: 4321,
    host: '127.0.0.1',
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-h' || a === '--help') out.help = true;
    else if (a === '-y' || a === '--yes') out.yes = true;
    else if (a === '-p' || a === '--pick') out.pick = true;
    else if (a === '-d' || a === '--dir') {
      out.dir = argv[++i];
      if (!out.dir) throw new Error('--dir 需要路径参数');
    } else if (a.startsWith('--dir=')) out.dir = a.slice('--dir='.length);
    else if (a === '--port') {
      out.port = Number(argv[++i]);
      if (!Number.isFinite(out.port)) throw new Error('--port 无效');
    } else if (a.startsWith('--port=')) out.port = Number(a.slice('--port='.length));
    else if (a === '--host') out.host = String(argv[++i] || '');
    else if (a.startsWith('--host=')) out.host = a.slice('--host='.length);
    else if (a.startsWith('-')) throw new Error(`未知参数：${a}`);
  }
  return out;
}

async function promptDataRoot() {
  const cwd = process.cwd();
  const rl = readline.createInterface({ input, output });
  try {
    console.log('');
    console.log('选择数据目录（知识库 / 用例 / 提示词 / 记忆等将写入此目录）：');
    console.log(`  1) 当前目录  ${cwd}`);
    console.log('  2) 自定义路径');
    console.log('  3) 打开系统文件夹选择器');
    const ans = (await rl.question('请输入 1 / 2 / 3（默认 1）：')).trim() || '1';
    if (ans === '2') {
      const raw = (await rl.question('请输入绝对或相对路径：')).trim();
      if (!raw) throw new Error('未输入路径');
      return path.resolve(cwd, raw);
    }
    if (ans === '3') {
      const picked = await nativePickDirectory();
      if (!picked) throw new Error('已取消选择文件夹');
      return path.resolve(picked);
    }
    return cwd;
  } finally {
    rl.close();
  }
}

async function resolveDataRoot(opts) {
  if (opts.dir) return path.resolve(opts.dir);
  if (opts.pick) {
    const picked = await nativePickDirectory();
    if (!picked) throw new Error('已取消选择文件夹');
    return path.resolve(picked);
  }
  if (opts.yes || !process.stdin.isTTY) return process.cwd();
  return promptDataRoot();
}

async function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (e) {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  }
  if (opts.help) {
    printHelp();
    process.exit(0);
  }

  let dataRoot;
  try {
    dataRoot = await resolveDataRoot(opts);
  } catch (e) {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  }

  if (!fs.existsSync(dataRoot)) {
    fs.mkdirSync(dataRoot, { recursive: true });
  }

  try {
    const { url, dataRoot: root } = await startLocalServer({
      dataRoot,
      host: opts.host,
      port: opts.port,
    });
    console.log('');
    console.log('TestBench 已启动');
    console.log(`  地址：${url}`);
    console.log(`  数据：${root}`);
    console.log('  按 Ctrl+C 停止');
    console.log('');
  } catch (e) {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  }
}

main();
