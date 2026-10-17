/**
 * 本机用户配置与运行状态（数据空间、pid、日志）。
 * 配置目录：~/.config/lantern-harness/（Windows: %APPDATA%/lantern-harness）
 * 旧安装的 ~/.config/ai-testbench/ 会在首次访问时整目录复制过来，原目录保留作备份。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** 配置目录名，与 GitHub 仓库 lantern-harness 保持一致 */
export const USER_CONFIG_DIR_NAME = 'lantern-harness';

/** 历史目录名：只读兼容，首次访问时复制到新目录，不删除 */
const LEGACY_APP_DIR_NAMES = ['ai-testbench'];

let legacyMigrated = false;

function baseConfigDir() {
  if (process.platform === 'win32') {
    const base = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
    return base;
  }
  return process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
}

function migrateLegacyConfigDir(dir) {
  if (legacyMigrated) return;
  legacyMigrated = true;
  try {
    if (fs.existsSync(dir)) return;
    const base = path.dirname(dir);
    for (const legacy of LEGACY_APP_DIR_NAMES) {
      const old = path.join(base, legacy);
      if (!fs.existsSync(old)) continue;
      fs.mkdirSync(base, { recursive: true });
      // 复制而非移动：迁移失败也不会丢原有 spaces.json / models.json
      fs.cpSync(old, dir, { recursive: true, errorOnExist: false, force: false });
      break;
    }
  } catch {
    // 迁移失败不阻塞启动：后续按新目录正常读写即可
  }
}

export function getUserConfigDir() {
  const dir = path.join(baseConfigDir(), USER_CONFIG_DIR_NAME);
  migrateLegacyConfigDir(dir);
  return dir;
}

export function getConfigPath() {
  return path.join(getUserConfigDir(), 'config.json');
}

/** 全局模型提供商（不跟数据空间走） */
export function getGlobalModelsPath() {
  return path.join(getUserConfigDir(), 'models.json');
}

export function getRunStatePath() {
  return path.join(getUserConfigDir(), 'run.json');
}

export function getLogPath() {
  return path.join(getUserConfigDir(), 'logs', 'server.log');
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

/**
 * @returns {{ dataRoot?: string, host?: string, port?: number }}
 */
export function loadUserConfig() {
  const p = getConfigPath();
  if (!fs.existsSync(p)) return {};
  try {
    const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
    return raw && typeof raw === 'object' ? raw : {};
  } catch {
    return {};
  }
}

/**
 * @param {{ dataRoot?: string, host?: string, port?: number }} patch
 */
export function saveUserConfig(patch) {
  const dir = getUserConfigDir();
  ensureDir(dir);
  const cur = loadUserConfig();
  const next = { ...cur, ...patch };
  if (next.dataRoot) next.dataRoot = path.resolve(next.dataRoot);
  if (next.port != null) next.port = Number(next.port) || 4321;
  if (next.host != null) next.host = String(next.host || '127.0.0.1');
  fs.writeFileSync(getConfigPath(), `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  return next;
}

export function clearDataRootFromConfig() {
  const cur = loadUserConfig();
  delete cur.dataRoot;
  ensureDir(getUserConfigDir());
  fs.writeFileSync(getConfigPath(), `${JSON.stringify(cur, null, 2)}\n`, 'utf8');
}

/**
 * @returns {{ pid?: number, url?: string, host?: string, port?: number, dataRoot?: string, startedAt?: string } | null}
 */
export function loadRunState() {
  const p = getRunStatePath();
  if (!fs.existsSync(p)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
    return raw && typeof raw === 'object' ? raw : null;
  } catch {
    return null;
  }
}

/**
 * @param {{ pid: number, url: string, host: string, port: number, dataRoot: string }} state
 */
export function saveRunState(state) {
  ensureDir(getUserConfigDir());
  const next = {
    ...state,
    startedAt: new Date().toISOString(),
  };
  fs.writeFileSync(getRunStatePath(), `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  return next;
}

export function clearRunState() {
  const p = getRunStatePath();
  if (fs.existsSync(p)) fs.unlinkSync(p);
}

export function ensureLogFile() {
  const logPath = getLogPath();
  ensureDir(path.dirname(logPath));
  if (!fs.existsSync(logPath)) fs.writeFileSync(logPath, '', 'utf8');
  return logPath;
}

/** 进程是否仍在运行 */
export function isPidAlive(pid) {
  if (!Number.isFinite(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * 校验已配置的数据空间是否可用。
 * @returns {{ ok: true, dataRoot: string } | { ok: false, reason: 'missing_config' | 'missing_path', dataRoot?: string }}
 */
export function resolveConfiguredDataRoot() {
  const cfg = loadUserConfig();
  const dataRoot = cfg.dataRoot ? path.resolve(cfg.dataRoot) : '';
  if (!dataRoot) {
    return { ok: false, reason: 'missing_config' };
  }
  if (!fs.existsSync(dataRoot) || !fs.statSync(dataRoot).isDirectory()) {
    return { ok: false, reason: 'missing_path', dataRoot };
  }
  return { ok: true, dataRoot };
}

export function printDataRootUnavailable(result) {
  if (result.reason === 'missing_config') {
    console.error('尚未初始化数据空间。');
    console.error('请使用 lantern init 初始化或选择已有数据空间。');
    return;
  }
  console.error('数据空间不存在或已被移动/重命名/删除：');
  console.error(`  ${result.dataRoot}`);
  console.error('请重新 lantern init：使用 lantern init 初始化或选择已有数据空间。');
}
