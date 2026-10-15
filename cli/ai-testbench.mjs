#!/usr/bin/env node
/**
 * ai-testbench CLI：本地一体服务 / headless ask / JSON-RPC。
 *
 * 用法：
 *   npx ai-testbench
 *   npx ai-testbench --dir ~/my-desk
 *   npx ai-testbench ask "你好"
 *   npx ai-testbench rpc
 *   npx ai-testbench acp
 */
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { nativePickDirectory } from '../builtin/session/tb-fs.mjs';
import { runAcpServer } from './acp-server.mjs';
import { headlessAsk, loadHeadlessSettings } from './headless.mjs';
import { runJsonRpcServer } from './jsonrpc-server.mjs';
import { startLocalServer } from './server.mjs';

function printHelp() {
  console.log(`TestBench · 本地服务 / headless

用法:
  ai-testbench [选项]              启动本地 Web 服务
  ai-testbench ask <提示词>        无浏览器补全（headless；可加 --tools）
  ai-testbench rpc                 stdio JSON-RPC（ping / ask）
  ai-testbench acp                 ACP 风格 JSON-RPC（session/new · prompt）

选项:
  -d, --dir <路径>   数据目录（知识库/用例/记忆等落盘位置）
  -p, --pick         用系统文件夹选择器选择数据目录（仅服务模式）
  -y, --yes          不交互，直接使用当前工作目录
  --port <端口>      默认 4321（仅服务模式）
  --host <主机>      默认 127.0.0.1
  --system <文本>    ask 时可选 system 提示
  --tools            ask/acp：启用本机 fs 只读工具循环
  --workspace <路径> 工具循环工作区（默认数据目录）
  -h, --help         显示帮助

示例:
  npx ai-testbench
  npx ai-testbench --dir ~/qa-workbench
  npx ai-testbench ask "用一句话介绍测试左移"
  npx ai-testbench ask --tools "列出工作区有哪些 .md"
  echo '{"jsonrpc":"2.0","id":1,"method":"ping"}' | npx ai-testbench rpc
  echo '{"jsonrpc":"2.0","id":1,"method":"initialize"}' | npx ai-testbench acp
`);
}

function parseArgs(argv) {
  const out = {
    command: 'serve',
    prompt: '',
    dir: null,
    pick: false,
    yes: false,
    port: 4321,
    host: '127.0.0.1',
    system: '',
    tools: false,
    workspace: '',
    help: false,
  };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-h' || a === '--help') out.help = true;
    else if (a === '-y' || a === '--yes') out.yes = true;
    else if (a === '-p' || a === '--pick') out.pick = true;
    else if (a === '--tools') out.tools = true;
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
    else if (a === '--system') out.system = String(argv[++i] || '');
    else if (a.startsWith('--system=')) out.system = a.slice('--system='.length);
    else if (a === '--workspace') {
      out.workspace = String(argv[++i] || '');
      if (!out.workspace) throw new Error('--workspace 需要路径参数');
    } else if (a.startsWith('--workspace=')) out.workspace = a.slice('--workspace='.length);
    else if (a.startsWith('-')) throw new Error(`未知参数：${a}`);
    else rest.push(a);
  }
  if (rest[0] === 'ask') {
    out.command = 'ask';
    out.prompt = rest.slice(1).join(' ').trim();
  } else if (rest[0] === 'rpc') {
    out.command = 'rpc';
  } else if (rest[0] === 'acp') {
    out.command = 'acp';
  } else if (rest[0] === 'serve') {
    out.command = 'serve';
  } else if (rest.length) {
    throw new Error(`未知命令：${rest[0]}（可用 ask / rpc / acp，或省略以启动服务）`);
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
  if (opts.yes || !process.stdin.isTTY || opts.command !== 'serve') return process.cwd();
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
    if (opts.command === 'ask') {
      if (!opts.prompt) {
        console.error('用法：ai-testbench ask <提示词>');
        process.exit(1);
      }
      const settings = loadHeadlessSettings(dataRoot);
      const text = await headlessAsk(settings, opts.prompt, {
        system: opts.system || undefined,
        tools: opts.tools,
        workspace: opts.workspace || dataRoot,
        onTool: opts.tools
          ? (ev) => {
              if (ev.status === 'running') {
                process.stderr.write(`[tool] ${ev.name} …\n`);
              } else if (ev.status === 'done') {
                process.stderr.write(`[tool] ${ev.name} done\n`);
              }
            }
          : undefined,
      });
      process.stdout.write(text.endsWith('\n') ? text : `${text}\n`);
      return;
    }
    if (opts.command === 'rpc') {
      await runJsonRpcServer({ dataRoot });
      return;
    }
    if (opts.command === 'acp') {
      await runAcpServer({
        dataRoot,
        tools: opts.tools,
        workspace: opts.workspace || dataRoot,
      });
      return;
    }

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
