#!/usr/bin/env node
/**
 * tbench CLI：数据空间 init + 本地服务启停 / 版本与排障。
 *
 * 用法见 `tbench help`。
 */
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import { stdin as input, stdout as output } from 'node:process';
import { nativePickDirectory } from '../builtin/session/tb-fs.mjs';
import { runAcpServer } from './acp-server.mjs';
import { headlessAsk, loadHeadlessSettings } from './headless.mjs';
import { runJsonRpcServer } from './jsonrpc-server.mjs';
import { prepareDataRoot, startLocalServer } from './server.mjs';
import {
  clearDataRootFromConfig,
  clearRunState,
  ensureLogFile,
  getConfigPath,
  getLogPath,
  isPidAlive,
  loadRunState,
  loadUserConfig,
  printDataRootUnavailable,
  resolveConfiguredDataRoot,
  saveRunState,
  saveUserConfig,
} from './user-config.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = path.resolve(__dirname, '..');
const PKG_JSON = path.join(PKG_ROOT, 'package.json');
const CLI_PATH = path.join(__dirname, 'tbench.mjs');
const PKG_NAME = 'ai-testbench';

function readPkgVersion() {
  try {
    return JSON.parse(fs.readFileSync(PKG_JSON, 'utf8')).version || '0.0.0';
  } catch {
    return '0.0.0';
  }
}

/** 是否运行在 npx 临时缓存里（形如 ~/.npm/_npx/<hash>/…），此时本机还没有 tbench 命令 */
function isNpxRun() {
  return __dirname.split(path.sep).includes('_npx');
}

/**
 * pnpm 是否「可用于全局安装」：既要有 pnpm，也要它的全局 bin 目录已在 PATH 上。
 * 没执行过 pnpm setup 时 `pnpm add -g` 会直接报 ERR_PNPM_GLOBAL_BIN_DIR_NOT_IN_PATH，
 * 此时退避到 npm，否则用户会装不上（npm 随 Node 一起安装，必然可用）。
 */
function isPnpmGlobalReady() {
  const probe = spawnSync('pnpm', ['bin', '-g'], {
    stdio: 'ignore',
    shell: process.platform === 'win32',
  });
  return !probe.error && probe.status === 0;
}

/** 优先 pnpm（可直接用于全局安装时）；否则回退 npm */
function getPackageManager() {
  return isPnpmGlobalReady() ? 'pnpm' : 'npm';
}

/** 全局安装 / 卸载 / 查询版本列表的 argv（pnpm 与 npm 子命令不同） */
function pmGlobalArgs(pm, action, target) {
  if (pm === 'pnpm') {
    if (action === 'install') return ['add', '-g', target];
    if (action === 'uninstall') return ['remove', '-g', target];
    return ['view', target, 'versions', '--json'];
  }
  if (action === 'install') return ['i', '-g', target];
  if (action === 'uninstall') return ['uninstall', '-g', target];
  return ['view', target, 'versions', '--json'];
}

/**
 * 裸跑 `tbench`（无子命令）且来自 npx 时：先把全局命令装上，
 * 之后 `tbench init` / `tbench web` 才可用。
 */
function installGlobalCli() {
  const pm = getPackageManager();
  console.log('');
  console.log('正在安装全局命令 tbench');
  const r = spawnSync(pm, pmGlobalArgs(pm, 'install', PKG_NAME), {
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (r.status !== 0) {
    console.error('');
    console.error('✗ 全局安装失败（可能需要管理员权限）。');
    console.error(`请手动执行后重试：${pm} ${pmGlobalArgs(pm, 'install', PKG_NAME).join(' ')}`);
    process.exit(1);
  }
  console.log('✓ 安装完成。');
  console.log('');
  console.log('下一步：');
  console.log('  tbench init     选择并记住数据空间');
  console.log('  tbench web      启动本地 Web 服务');
  console.log('');
}

function printHelp() {
  console.log(`TestBench · tbench

用法:
  tbench init              选择并记住数据空间
  tbench web               后台启动本地 Web 服务
  tbench stop              停止服务
  tbench restart           重启服务
  tbench status            运行状态、端口、数据空间
  tbench open              在浏览器中打开工作台
  tbench path              显示当前数据空间路径
  tbench config            显示配置文件地址
  tbench logs              查看服务日志
  tbench doctor            检查运行环境与配置
  tbench help              显示本帮助
  tbench version           显示当前版本号
  tbench list              显示可安装的版本列表
  tbench install [版本]    安装/更新（默认 latest）
  tbench uninstall         卸载本机 tbench（保留数据空间）
  tbench wipe              删除当前数据空间（需确认）

进阶:
  tbench ask <提示词>      无界面单轮问答，直接输出结果
  tbench rpc               以 stdio JSON-RPC 暴露本地问答能力
  tbench acp               以 ACP 子集供外部编排驱动无 UI Agent

说明:
  首次请执行 tbench init；之后 tbench web 使用已记住的数据空间。
  若数据空间被移动/重命名/删除，请重新 tbench init 初始化或选择已有数据空间。
`);
}

async function promptDataRoot() {
  const cwd = process.cwd();
  const rl = readline.createInterface({ input, output });
  try {
    console.log('');
    console.log('选择数据空间（知识库 / 用例 / 提示词 / 记忆等将写入此目录）：');
    console.log('  1) 打开系统文件夹选择器');
    console.log(`  2) 当前目录（当前终端所在位置）  ${cwd}`);
    console.log('  3) 自定义路径（手输）');
    const ans = (await rl.question('请输入 1 / 2 / 3（默认 1）：')).trim() || '1';
    if (ans === '2') return cwd;
    if (ans === '3') {
      const raw = (await rl.question('请输入绝对或相对路径：')).trim();
      if (!raw) throw new Error('未输入路径');
      return path.resolve(cwd, raw);
    }
    if (!process.stdin.isTTY) {
      throw new Error('非交互环境无法打开文件夹选择器，请使用选项 2 / 3 或在终端中执行');
    }
    const picked = await nativePickDirectory();
    if (!picked) throw new Error('已取消选择文件夹');
    return path.resolve(picked);
  } finally {
    rl.close();
  }
}

/** @param {string | null | undefined} dirOverride */
function requireDataRoot(dirOverride) {
  if (dirOverride) {
    const dataRoot = path.resolve(dirOverride);
    if (!fs.existsSync(dataRoot)) fs.mkdirSync(dataRoot, { recursive: true });
    return dataRoot;
  }
  const result = resolveConfiguredDataRoot();
  if (!result.ok) {
    printDataRootUnavailable(result);
    process.exit(1);
  }
  return result.dataRoot;
}

function getServerOpts() {
  const cfg = loadUserConfig();
  return {
    host: cfg.host || '127.0.0.1',
    port: Number(cfg.port) || 4321,
  };
}

function getAliveRun() {
  const state = loadRunState();
  if (!state?.pid || !isPidAlive(state.pid)) {
    if (state) clearRunState();
    return null;
  }
  return state;
}

async function cmdInit() {
  const dataRoot = await promptDataRoot();
  if (!fs.existsSync(dataRoot)) {
    fs.mkdirSync(dataRoot, { recursive: true });
  }
  prepareDataRoot(dataRoot);
  saveUserConfig({ dataRoot, host: '127.0.0.1', port: 4321 });
  console.log('');
  console.log('数据空间已关联：');
  console.log(`  ${dataRoot}`);
  console.log(`  配置：${getConfigPath()}`);
  console.log('接下来可执行：tbench web');
  console.log('');
}

async function runForegroundServer(dataRoot) {
  const { host, port } = getServerOpts();
  const { url, server, dataRoot: root } = await startLocalServer({ dataRoot, host, port });
  saveRunState({
    pid: process.pid,
    url,
    host,
    port,
    dataRoot: root,
  });
  const shutdown = () => {
    clearRunState();
    server.close(() => process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  console.log('');
  console.log('TestBench 已启动');
  console.log(`  地址：${url}`);
  console.log(`  数据空间：${root}`);
  console.log('  按 Ctrl+C 停止');
  console.log('');
}

function cmdStart({ foreground = false, dir = null } = {}) {
  const dataRoot = requireDataRoot(dir);
  const alive = getAliveRun();
  if (alive) {
    console.log(`服务已在运行（pid ${alive.pid}）`);
    console.log(`  地址：${alive.url}`);
    console.log(`  数据空间：${alive.dataRoot}`);
    return;
  }

  if (foreground) {
    return runForegroundServer(dataRoot);
  }

  const logPath = ensureLogFile();
  const out = fs.openSync(logPath, 'a');
  const childArgs = [CLI_PATH, 'web', '--foreground'];
  if (dir) childArgs.push('--dir', dataRoot);
  const child = spawn(process.execPath, childArgs, {
    detached: true,
    stdio: ['ignore', out, out],
    env: { ...process.env },
    cwd: PKG_ROOT,
  });
  child.unref();
  fs.closeSync(out);

  const sleepSync = (ms) => {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  };
  // 等待子进程写入 run.json
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    sleepSync(150);
    const state = getAliveRun();
    if (state) {
      console.log('');
      console.log('TestBench 已在后台启动');
      console.log(`  地址：${state.url}`);
      console.log(`  数据空间：${state.dataRoot}`);
      console.log(`  日志：${logPath}`);
      console.log('  停止：tbench stop');
      console.log('');
      return;
    }
  }
  const state = getAliveRun();
  if (state) {
    console.log(`TestBench 已启动：${state.url}`);
    return;
  }
  console.error('启动超时或失败，请查看日志：');
  console.error(`  ${logPath}`);
  console.error('或前台排查：tbench web --foreground');
  process.exit(1);
}

function cmdStop() {
  const state = loadRunState();
  if (!state?.pid) {
    console.log('当前没有在运行的服务。');
    return;
  }
  if (!isPidAlive(state.pid)) {
    clearRunState();
    console.log('服务未在运行（已清理状态）。');
    return;
  }
  try {
    process.kill(state.pid, 'SIGTERM');
  } catch (e) {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  }
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline && isPidAlive(state.pid)) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
  }
  if (isPidAlive(state.pid)) {
    try {
      process.kill(state.pid, 'SIGKILL');
    } catch {
      /* ignore */
    }
  }
  clearRunState();
  console.log('服务已停止。');
}

async function cmdRestart() {
  cmdStop();
  await new Promise((r) => setTimeout(r, 300));
  cmdStart({ foreground: false });
}

function cmdStatus() {
  const cfg = loadUserConfig();
  const resolved = resolveConfiguredDataRoot();
  const run = getAliveRun();
  console.log(`版本：${readPkgVersion()}`);
  console.log(`配置：${getConfigPath()}`);
  if (!resolved.ok) {
    if (resolved.reason === 'missing_config') {
      console.log('数据空间：未配置');
      console.log('  → 请使用 tbench init 初始化或选择已有数据空间');
    } else {
      console.log(`数据空间：不可用（${resolved.dataRoot}）`);
      console.log('  → 请重新 tbench init：初始化或选择已有数据空间');
    }
  } else {
    console.log(`数据空间：${resolved.dataRoot}`);
  }
  console.log(`监听：${cfg.host || '127.0.0.1'}:${Number(cfg.port) || 4321}`);
  if (run) {
    console.log(`状态：运行中（pid ${run.pid}）`);
    console.log(`地址：${run.url}`);
  } else {
    console.log('状态：未运行');
  }
}

function cmdOpen() {
  const run = getAliveRun();
  const { host, port } = getServerOpts();
  const url = run?.url || `http://${host}:${port}/`;
  if (!run) {
    console.error('服务未运行。请先执行：tbench web');
    process.exit(1);
  }
  const platform = process.platform;
  let r;
  if (platform === 'darwin') r = spawnSync('open', [url], { stdio: 'inherit' });
  else if (platform === 'win32')
    r = spawnSync('cmd', ['/c', 'start', '', url], { stdio: 'inherit' });
  else r = spawnSync('xdg-open', [url], { stdio: 'inherit' });
  if (r.status !== 0) {
    console.error(`无法自动打开浏览器，请手动访问：${url}`);
    process.exit(1);
  }
  console.log(`已打开：${url}`);
}

function cmdPath() {
  console.log(requireDataRoot());
}

function cmdConfig() {
  console.log(getConfigPath());
}

function cmdLogs() {
  const logPath = getLogPath();
  if (!fs.existsSync(logPath)) {
    console.log(`尚无日志文件：${logPath}`);
    return;
  }
  const text = fs.readFileSync(logPath, 'utf8');
  const lines = text.split('\n');
  const tail = lines.slice(Math.max(0, lines.length - 80)).join('\n');
  console.log(`日志：${logPath}`);
  console.log('---');
  process.stdout.write(tail.endsWith('\n') ? tail : `${tail}\n`);
}

function cmdDoctor() {
  const issues = [];
  const nodeMajor = Number(process.versions.node.split('.')[0]);
  if (!Number.isFinite(nodeMajor) || nodeMajor < 20) {
    issues.push(`Node.js 版本过低（当前 ${process.version}，需要 >= 20）`);
  } else {
    console.log(`✓ Node.js ${process.version}`);
  }

  const distIndex = path.join(PKG_ROOT, 'dist', 'index.html');
  if (!fs.existsSync(distIndex)) {
    issues.push(`缺少构建产物：${distIndex}（请 pnpm build 或重装包）`);
  } else {
    console.log(`✓ dist 就绪`);
  }

  console.log(
    `✓ 配置文件 ${getConfigPath()}${fs.existsSync(getConfigPath()) ? '' : '（尚未创建）'}`,
  );

  const resolved = resolveConfiguredDataRoot();
  if (!resolved.ok) {
    if (resolved.reason === 'missing_config') {
      issues.push('未初始化数据空间（请使用 tbench init 初始化或选择已有数据空间）');
    } else {
      issues.push(
        `数据空间不可用：${resolved.dataRoot}（请重新 tbench init：初始化或选择已有数据空间）`,
      );
    }
  } else {
    console.log(`✓ 数据空间 ${resolved.dataRoot}`);
  }

  const run = getAliveRun();
  console.log(run ? `✓ 服务运行中 ${run.url}` : '· 服务未运行');

  if (issues.length) {
    console.log('');
    console.log('发现问题：');
    for (const m of issues) console.log(`  - ${m}`);
    process.exit(1);
  }
  console.log('');
  console.log('环境检查通过。');
}

function cmdVersion() {
  console.log(readPkgVersion());
}

function cmdList() {
  const pm = getPackageManager();
  const r = spawnSync(pm, pmGlobalArgs(pm, 'list', PKG_NAME), {
    encoding: 'utf8',
    shell: process.platform === 'win32',
  });
  if (r.status !== 0) {
    console.error(r.stderr || r.stdout || '无法查询版本列表');
    process.exit(1);
  }
  let versions;
  try {
    versions = JSON.parse(r.stdout);
  } catch {
    console.error('解析版本列表失败');
    process.exit(1);
  }
  const list = Array.isArray(versions) ? versions : [versions];
  const current = readPkgVersion();
  for (const v of list) {
    console.log(v === current ? `${v}  (current)` : v);
  }
}

function cmdInstall(version) {
  const pm = getPackageManager();
  const spec = version ? `${PKG_NAME}@${version}` : `${PKG_NAME}@latest`;
  console.log(`正在安装 ${spec} …`);
  const r = spawnSync(pm, pmGlobalArgs(pm, 'install', spec), {
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  process.exit(r.status === null ? 1 : r.status);
}

function cmdUninstall() {
  const pm = getPackageManager();
  console.log(`正在卸载全局包 ${PKG_NAME}（数据空间与配置保留）…`);
  const r = spawnSync(pm, pmGlobalArgs(pm, 'uninstall', PKG_NAME), {
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  process.exit(r.status === null ? 1 : r.status);
}

async function cmdWipe() {
  const dataRoot = requireDataRoot();
  const home = path.resolve(os.homedir());
  const resolved = path.resolve(dataRoot);
  if (resolved === path.parse(resolved).root || resolved === home) {
    console.error('拒绝删除系统主目录或磁盘根，请检查数据空间路径。');
    process.exit(1);
  }
  if (resolved === path.resolve(PKG_ROOT)) {
    console.error('拒绝删除软件安装目录。请将数据空间设到其他文件夹。');
    process.exit(1);
  }

  const rl = readline.createInterface({ input, output });
  try {
    console.log('即将删除数据空间（不可恢复）：');
    console.log(`  ${resolved}`);
    const ans = (await rl.question('确认删除请输入 yes：')).trim();
    if (ans !== 'yes') {
      console.log('已取消。');
      return;
    }
  } finally {
    rl.close();
  }

  const run = getAliveRun();
  if (run) cmdStop();

  fs.rmSync(resolved, { recursive: true, force: true });
  clearDataRootFromConfig();
  console.log('数据空间已删除，配置中的关联已清除。');
  console.log('如需继续使用，请使用 tbench init 初始化或选择已有数据空间。');
}

/**
 * 解析 argv → { cmd, args, flags }
 */
function parseArgv(argv) {
  const flags = { foreground: false, help: false, dir: null };
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-h' || a === '--help') flags.help = true;
    else if (a === '--foreground') flags.foreground = true;
    else if (a === '-d' || a === '--dir') {
      flags.dir = argv[++i];
      if (!flags.dir) throw new Error('--dir 需要路径参数');
    } else if (a.startsWith('--dir=')) flags.dir = a.slice('--dir='.length);
    else if (a.startsWith('-')) throw new Error(`未知参数：${a}`);
    else positional.push(a);
  }
  const cmd = positional[0] || 'help';
  const args = positional.slice(1);
  return { cmd, args, flags, bare: positional.length === 0 };
}

async function main() {
  let parsed;
  try {
    parsed = parseArgv(process.argv.slice(2));
  } catch (e) {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  }

  const { cmd, args, flags, bare } = parsed;
  if (flags.help || cmd === 'help') {
    // 裸跑（无子命令）且来自 npx：先装上全局命令，再让用户执行 init / start
    if (bare && !flags.help && isNpxRun()) {
      installGlobalCli();
      return;
    }
    printHelp();
    return;
  }

  try {
    switch (cmd) {
      case 'init':
        await cmdInit();
        break;
      case 'web':
        await cmdStart({ foreground: flags.foreground, dir: flags.dir });
        break;
      case 'stop':
        cmdStop();
        break;
      case 'restart':
        await cmdRestart();
        break;
      case 'status':
        cmdStatus();
        break;
      case 'open':
        cmdOpen();
        break;
      case 'path':
        cmdPath();
        break;
      case 'config':
        cmdConfig();
        break;
      case 'logs':
        cmdLogs();
        break;
      case 'doctor':
        cmdDoctor();
        break;
      case 'version':
        cmdVersion();
        break;
      case 'list':
        cmdList();
        break;
      case 'install':
        cmdInstall(args[0]);
        break;
      case 'uninstall':
        cmdUninstall();
        break;
      case 'wipe':
        await cmdWipe();
        break;
      case 'ask': {
        const dataRoot = requireDataRoot(flags.dir);
        const prompt = args.join(' ').trim();
        if (!prompt) {
          console.error('用法：tbench ask <提示词>');
          process.exit(1);
        }
        const settings = loadHeadlessSettings(dataRoot);
        const text = await headlessAsk(settings, prompt, {});
        process.stdout.write(text.endsWith('\n') ? text : `${text}\n`);
        break;
      }
      case 'rpc': {
        const dataRoot = requireDataRoot(flags.dir);
        await runJsonRpcServer({ dataRoot });
        break;
      }
      case 'acp': {
        const dataRoot = requireDataRoot(flags.dir);
        await runAcpServer({ dataRoot, tools: false, workspace: dataRoot });
        break;
      }
      default:
        console.error(`未知命令：${cmd}`);
        console.error('执行 tbench help 查看可用命令。');
        process.exit(1);
    }
  } catch (e) {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  }
}

main();
