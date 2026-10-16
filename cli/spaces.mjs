/**
 * 数据空间注册表：多空间数据隔离的元数据层。
 *
 * 文件位置：`~/.config/ai-testbench/spaces.json`（与 CLI 的 config.json 同目录）
 *
 * 「公共空间」是内建虚拟项，不入库：用户数据目录下直接是 `公共空间/`，源码仓库则在 `空间池/公共空间/`。
 * 新建空间会自动归进同一层（与公共空间同级）。界面路径隐去「空间池」。
 * 与自定义空间同构，因此可以整体拷贝 / 备份。
 *
 * 本模块只做「注册表 + 文件系统 + 压缩包」三件事，不依赖服务端，避免循环依赖。
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  LOCAL_REL,
  META_CONFIG_NAME,
  META_DIR,
  META_LOCAL_NAME,
  PUBLIC_SPACE_DIR,
  SPACE_MANIFEST_FILE,
  SPACE_MANIFEST_REL,
  SPACE_POOL_DIR,
  poolPath,
  publicSpacePath,
  spaceConfigFile,
  spaceLocalDir,
  spaceManifestFile,
  spaceManifestLegacyFile,
  spaceMetaDir,
} from '../builtin/session/space-layout.mjs';
import { getUserConfigDir } from './user-config.mjs';

export const PUBLIC_SPACE_ID = 'public';
export const PUBLIC_SPACE_NAME = '公共空间';
/** 界面 / CLI 展示名，与文件夹名相同；旧版「公共空间(默认)」仍作保留名 */
export const PUBLIC_SPACE_LABEL = PUBLIC_SPACE_NAME;
const LEGACY_PUBLIC_SPACE_LABEL = '公共空间(默认)';

/** 空间名长度上限（同时决定目录名长度，留足余量避开各平台路径限制） */
const MAX_NAME_LENGTH = 40;
/** 保留名：避免与内建项、池子与元数据目录撞名 */
const RESERVED_NAMES = new Set([
  'public',
  META_CONFIG_NAME,
  META_LOCAL_NAME,
  `.${META_LOCAL_NAME}`,
  META_DIR,
  SPACE_POOL_DIR,
]);

/**
 * 空间文件夹内的自包含清单：让空间目录本身可整体拷贝到任意位置。
 * 落在 `.tb/space.json`（与配置、本机状态同级）；根目录的旧 `space.json` 仍可读，写入时迁走。
 * 注册表（~/.config/ai-testbench/spaces.json）只记「有哪些空间」，清单记「这个文件夹是谁」，
 * 两者互为兜底：丢了注册表还能靠清单 + discoverSpaces 重新纳入。
 */
export { SPACE_MANIFEST_FILE, SPACE_MANIFEST_REL };
const MANIFEST_KIND = 'ai-testbench-space';
const MANIFEST_SCHEMA = 1;

/** 导出范围：「完整备份」含密钥与会话；「内容库」排除敏感项 */
export const EXPORT_SCOPE_FULL = 'full';
export const EXPORT_SCOPE_CONTENT = 'content';

export function normalizeExportScope(raw) {
  return raw === EXPORT_SCOPE_CONTENT ? EXPORT_SCOPE_CONTENT : EXPORT_SCOPE_FULL;
}

export function getSpacesPath() {
  return path.join(getUserConfigDir(), 'spaces.json');
}

/**
 * 新建空间的默认父目录：与公共空间同级（用户数据目录 = 选中的文件夹；源码仓库 = 空间池）。
 * @param {string} [baseRoot] 池根；缺省用 cwd
 */
export function defaultManagedParent(baseRoot) {
  return poolPath(baseRoot || process.cwd());
}

/**
 * 按当前池布局改写注册表路径：用户目录把 `空间池/X` 抬到 `X`；源码仓库把误摊的 `X` 收回 `空间池/X`。
 * @param {string} [baseRoot]
 */
export function relocateSpaceRegistryPaths(baseRoot) {
  const root = path.resolve(baseRoot || process.cwd());
  const pool = poolPath(root);
  const nestedPrefix = path.join(root, SPACE_POOL_DIR);
  const reg = loadSpacesRegistry();
  let dirty = false;
  for (const s of reg.spaces) {
    const abs = path.resolve(s.path);
    let next = null;
    if (pool === root) {
      const rel = path.relative(nestedPrefix, abs);
      if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) continue;
      next = path.join(root, rel);
    } else {
      const relToPool = path.relative(pool, abs);
      if (relToPool && !relToPool.startsWith('..') && !path.isAbsolute(relToPool)) continue;
      const relToRoot = path.relative(root, abs);
      if (!relToRoot || relToRoot.startsWith('..') || path.isAbsolute(relToRoot)) continue;
      if (relToRoot.split(path.sep)[0] === SPACE_POOL_DIR) continue;
      next = path.join(pool, relToRoot);
    }
    if (!next || path.resolve(next) === abs || !isDir(next)) continue;
    s.path = next;
    dirty = true;
  }
  if (dirty) saveSpacesRegistry(reg);
  return dirty;
}

function newSpaceId() {
  return `sp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

function emptyRegistry() {
  // managedParent 不再落进注册表：它由池根推导，存下来只会在换机器后变成死路径
  return { activeId: PUBLIC_SPACE_ID, spaces: [] };
}

/**
 * 读取注册表；任何损坏都退回空注册表（宁可重置元数据，也不能让服务起不来）。
 *
 * 不再读取/推断 `managedParent`：空间位置一律由池根推导（见 `defaultManagedParent`）。
 * @returns {{ activeId: string, spaces: Array<{id:string,name:string,path:string,createdAt:number}> }}
 */
export function loadSpacesRegistry() {
  const fp = getSpacesPath();
  if (!fs.existsSync(fp)) return emptyRegistry();
  try {
    const raw = JSON.parse(fs.readFileSync(fp, 'utf8'));
    if (!raw || typeof raw !== 'object') return emptyRegistry();
    const spaces = Array.isArray(raw.spaces)
      ? raw.spaces
          .map((it) => ({
            id: String(it?.id || '').trim(),
            name: String(it?.name || '').trim(),
            path: path.resolve(String(it?.path || '')),
            createdAt: Number(it?.createdAt) || 0,
          }))
          .filter((it) => it.id && it.name && it.path && it.path !== path.sep)
      : [];
    return { activeId: String(raw.activeId || PUBLIC_SPACE_ID), spaces };
  } catch {
    return emptyRegistry();
  }
}

export function saveSpacesRegistry(reg) {
  const dir = getUserConfigDir();
  fs.mkdirSync(dir, { recursive: true });
  const next = {
    activeId: String(reg.activeId || PUBLIC_SPACE_ID),
    spaces: Array.isArray(reg.spaces) ? reg.spaces : [],
  };
  fs.writeFileSync(getSpacesPath(), `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  return next;
}

/**
 * 校验空间名。这里是不可信输入入口（网页表单 / CLI 参数），在落盘前必须挡住。
 * @param {unknown} raw
 * @returns {{ ok: true, name: string } | { ok: false, error: string }}
 */
export function sanitizeSpaceName(raw) {
  const name = String(raw ?? '')
    // 控制字符（含换行、NUL）一律剔除，避免污染配置与日志
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim();
  if (!name) return { ok: false, error: '空间名不能为空' };
  if (name.length > MAX_NAME_LENGTH) {
    return { ok: false, error: `空间名不能超过 ${MAX_NAME_LENGTH} 个字符` };
  }
  if (/[\\/]/.test(name)) return { ok: false, error: '空间名不能包含路径分隔符' };
  if (name.startsWith('.')) return { ok: false, error: '空间名不能以点开头' };
  if (name === PUBLIC_SPACE_NAME || name === LEGACY_PUBLIC_SPACE_LABEL)
    return { ok: false, error: `「${PUBLIC_SPACE_NAME}」是内建空间名` };
  if (RESERVED_NAMES.has(name.toLowerCase())) {
    return { ok: false, error: `「${name}」是保留名称` };
  }
  return { ok: true, name };
}

function isDir(p) {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

/** 同名判定不区分大小写：macOS / Windows 文件系统本身就不区分 */
function nameTaken(reg, name) {
  const lower = name.toLowerCase();
  if (
    lower === PUBLIC_SPACE_NAME.toLowerCase() ||
    lower === LEGACY_PUBLIC_SPACE_LABEL.toLowerCase()
  )
    return true;
  return reg.spaces.some((s) => s.name.toLowerCase() === lower);
}

// ── 空间清单（自包含） ────────────────────────────────────────

/** 现有清单路径：优先 `.tb/space.json`，兼容根目录旧文件 */
function resolveManifestPath(dir) {
  const canon = spaceManifestFile(dir);
  if (fs.existsSync(canon)) return canon;
  const legacy = spaceManifestLegacyFile(dir);
  if (fs.existsSync(legacy)) return legacy;
  return null;
}

/** 根目录旧清单迁进 `.tb/`（目标已存在则只删旧文件） */
export function migrateLegacyManifest(dir) {
  const canon = spaceManifestFile(dir);
  const legacy = spaceManifestLegacyFile(dir);
  if (!fs.existsSync(legacy) || path.resolve(legacy) === path.resolve(canon)) return;
  try {
    if (!fs.existsSync(canon)) {
      fs.mkdirSync(path.dirname(canon), { recursive: true });
      fs.renameSync(legacy, canon);
    } else {
      fs.unlinkSync(legacy);
    }
  } catch {
    // 迁移失败时仍可读旧路径
  }
}

/** 读取空间清单；非空间目录 / 损坏清单都返回失败而不抛错 */
export function readSpaceManifest(dir) {
  const fp = resolveManifestPath(dir);
  try {
    if (!fp) return { ok: false, error: '没有 space.json 清单' };
    const raw = JSON.parse(fs.readFileSync(fp, 'utf8'));
    if (!raw || typeof raw !== 'object' || raw.kind !== MANIFEST_KIND) {
      return { ok: false, error: 'space.json 不是本应用的数据空间清单' };
    }
    const id = String(raw.id || '').trim();
    const name = String(raw.name || '').trim();
    if (!id || !name) return { ok: false, error: 'space.json 缺少 id / name' };
    return { ok: true, manifest: { id, name, createdAt: Number(raw.createdAt) || 0 } };
  } catch (e) {
    return {
      ok: false,
      error: `space.json 解析失败：${e instanceof Error ? e.message : String(e)}`,
    };
  }
}

/** 写入（或覆盖）空间清单。名称 / id 变化后必须重写，否则搬移后身份就是错的 */
export function writeSpaceManifest(dir, entry) {
  const abs = path.resolve(dir);
  fs.mkdirSync(abs, { recursive: true });
  const payload = {
    kind: MANIFEST_KIND,
    schema: MANIFEST_SCHEMA,
    id: entry.id,
    name: entry.name,
    createdAt: Number(entry.createdAt) || Date.now(),
  };
  const dest = spaceManifestFile(abs);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  migrateLegacyManifest(abs);
  return payload;
}

/**
 * 「这是不是一个数据空间目录」的老空间判据。
 *
 * 升级前创建的空间没有清单，但 `prepareSpaceDir` 一定会写配置默认值，
 * 拿 `空间/.tb/local` 与 `空间/.tb/config/app.defaults.json` 一起认，
 * 既能捞回老空间，又不会把无关目录误纳入。
 *
 * 也兼容更早的散装布局（`config/`、`.local/` 直接放在空间根）。
 */
function looksLikeSpaceDir(abs) {
  const hasLocal =
    isDir(spaceLocalDir(abs)) ||
    isDir(path.join(abs, META_LOCAL_NAME)) ||
    isDir(path.join(abs, '.local'));
  const hasDefaults =
    fs.existsSync(spaceConfigFile(abs, 'app.defaults.json')) ||
    fs.existsSync(path.join(abs, META_CONFIG_NAME, 'app.defaults.json')) ||
    fs.existsSync(path.join(abs, 'config', 'app.defaults.json'));
  return hasLocal && hasDefaults;
}

/**
 * 扫描空间池，把「空间文件夹」纳入注册表。
 *
 * 这是「空间 = 一个自包含文件夹」的落地动作：把空间文件夹整体拷进池里，扫描一次即可识别。
 * - 带 `.tb/space.json`（或根目录旧清单）的目录：按清单识别，并把清单同步为目录名 / 新 id
 * - 不带清单但形如数据空间的老目录：一并纳入并补写清单
 * - 已登记但缺清单的空间：只补写清单
 * @param {{ managedParent?: string, baseRoot?: string }} [opts]
 */
export function discoverSpaces(opts = {}) {
  const reg = loadSpacesRegistry();
  const parent = path.resolve(opts.managedParent || defaultManagedParent(opts.baseRoot));
  const added = [];
  const backfilled = [];
  const skipped = [];
  if (!isDir(parent)) return { ok: true, managedParent: parent, added, backfilled, skipped };

  const usedIds = new Set(reg.spaces.map((s) => s.id));
  const usedNames = new Set(reg.spaces.map((s) => s.name.toLowerCase()));
  const publicDir = path.resolve(path.join(parent, PUBLIC_SPACE_DIR));

  for (const ent of fs.readdirSync(parent, { withFileTypes: true })) {
    // 符号链接不跟随：避免把链接指向的任意目录纳入并后续物理删除
    if (!ent.isDirectory() || ent.isSymbolicLink()) continue;
    const abs = path.resolve(path.join(parent, ent.name));
    // 公共空间是内建项；旧的「空间池」容器目录也不当空间
    if (abs === publicDir || ent.name === PUBLIC_SPACE_DIR || ent.name === SPACE_POOL_DIR) continue;

    const registered = reg.spaces.find((s) => path.resolve(s.path) === abs);
    if (registered) {
      // 已登记但缺清单：补写，使老空间同样可整体搬移
      if (!resolveManifestPath(abs)) {
        try {
          writeSpaceManifest(abs, registered);
          backfilled.push(registered.name);
        } catch {
          // 清单只是附加信息，补写失败不影响主流程
        }
      }
      continue;
    }

    const read = readSpaceManifest(abs);
    // 既没有清单、又不像数据空间的目录：静默忽略（避免误纳入用户的普通文件夹）
    if (!read.ok && !looksLikeSpaceDir(abs)) continue;

    // 以目录名为准：登记名与目录名必须一致，否则重命名 / 删除都要额外兜底
    const clean = sanitizeSpaceName(ent.name);
    if (!clean.ok) {
      skipped.push({ path: abs, reason: clean.error });
      continue;
    }
    if (usedNames.has(clean.name.toLowerCase())) {
      skipped.push({ path: abs, reason: `已存在同名空间「${clean.name}」` });
      continue;
    }

    // 拷贝来的文件夹会带着原 id：id 撞车时必须换新，否则两个空间指向同一身份
    const wantId = read.ok ? read.manifest.id : '';
    const id = wantId && !usedIds.has(wantId) ? wantId : newSpaceId();
    const entry = {
      id,
      name: clean.name,
      path: abs,
      createdAt: (read.ok ? read.manifest.createdAt : 0) || Date.now(),
    };
    reg.spaces.push(entry);
    usedIds.add(id);
    usedNames.add(clean.name.toLowerCase());
    added.push(entry);

    if (!read.ok || read.manifest.id !== id || read.manifest.name !== clean.name) {
      try {
        writeSpaceManifest(abs, entry);
      } catch {
        // 同上：清单同步失败不影响纳入结果
      }
    }
  }

  if (added.length) saveSpacesRegistry(reg);
  return { ok: true, managedParent: parent, added, backfilled, skipped };
}

/**
 * 列举全部空间（含内建「公共空间」）。
 * @param {string} baseRoot 池根
 */
export function listSpaces(baseRoot) {
  relocateSpaceRegistryPaths(baseRoot);
  const reg = loadSpacesRegistry();
  // 公共空间也是选中文件夹里的一个目录，与自定义空间同构
  const publicRoot = path.resolve(publicSpacePath(baseRoot));
  const all = [
    {
      id: PUBLIC_SPACE_ID,
      name: PUBLIC_SPACE_NAME,
      path: publicRoot,
      createdAt: 0,
      isPublic: true,
    },
    ...reg.spaces.map((s) => ({ ...s, isPublic: false })),
  ];
  return {
    baseRoot: path.resolve(baseRoot),
    managedParent: defaultManagedParent(baseRoot),
    activeId: reg.activeId,
    spaces: all.map((s) => ({
      ...s,
      exists: isDir(s.path),
      isActive: s.id === reg.activeId,
    })),
  };
}

/**
 * 按 id 解析空间（含公共空间）。
 * @returns {{ ok: true, space: object } | { ok: false, error: string }}
 */
export function resolveSpace(id, baseRoot) {
  const wanted = String(id || '').trim();
  if (!wanted) return { ok: false, error: '缺少空间 id' };
  const listed = listSpaces(baseRoot);
  const found = listed.spaces.find((s) => s.id === wanted || s.name === wanted);
  if (!found) return { ok: false, error: `空间不存在：${wanted}` };
  if (!found.exists) return { ok: false, error: `空间目录不存在：${found.path}` };
  return { ok: true, space: found };
}

/**
 * 新建空间（只建目录并登记；空间骨架由调用方用 prepareSpaceDir 铺好）。
 * 默认与公共空间同级，落在池父目录下。
 * @param {{ name: unknown, managedParent?: string, baseRoot: string }} opts
 */
export function createSpace({ name, managedParent, baseRoot }) {
  const clean = sanitizeSpaceName(name);
  if (!clean.ok) return { ok: false, error: clean.error };

  const reg = loadSpacesRegistry();
  if (nameTaken(reg, clean.name)) return { ok: false, error: `已存在同名空间「${clean.name}」` };

  const parent = path.resolve(managedParent || defaultManagedParent(baseRoot));
  const dir = path.join(parent, clean.name);

  // 目录可能已存在（例如用户手工建过）：不能贸然复用，否则会把无关内容当成数据空间
  if (fs.existsSync(dir)) return { ok: false, error: `目录已存在：${dir}` };

  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch (e) {
    return { ok: false, error: `创建目录失败：${e instanceof Error ? e.message : String(e)}` };
  }

  const entry = { id: newSpaceId(), name: clean.name, path: dir, createdAt: Date.now() };
  try {
    writeSpaceManifest(dir, entry);
  } catch (e) {
    return { ok: false, error: `写入空间清单失败：${e instanceof Error ? e.message : String(e)}` };
  }
  reg.spaces.push(entry);
  saveSpacesRegistry(reg);
  return { ok: true, space: entry };
}

/** 重命名空间：同时改目录名与登记名 */
export function renameSpace(id, nextName, baseRoot) {
  const resolved = resolveSpace(id, baseRoot);
  if (!resolved.ok) return resolved;
  const space = resolved.space;
  if (space.isPublic) return { ok: false, error: `${PUBLIC_SPACE_NAME}不支持重命名` };

  const clean = sanitizeSpaceName(nextName);
  if (!clean.ok) return { ok: false, error: clean.error };
  if (clean.name === space.name) return { ok: true, space };

  const reg = loadSpacesRegistry();
  if (nameTaken(reg, clean.name)) return { ok: false, error: `已存在同名空间「${clean.name}」` };

  const parent = path.dirname(space.path);
  const nextPath = path.join(parent, clean.name);
  if (fs.existsSync(nextPath)) return { ok: false, error: `目录已存在：${nextPath}` };

  try {
    fs.renameSync(space.path, nextPath);
  } catch (e) {
    return { ok: false, error: `重命名目录失败：${e instanceof Error ? e.message : String(e)}` };
  }

  const target = reg.spaces.find((s) => s.id === space.id);
  if (target) {
    target.name = clean.name;
    target.path = nextPath;
  }
  saveSpacesRegistry(reg);
  // 清单内的名称必须跟着改，否则搬移后身份与登记名不一致
  try {
    writeSpaceManifest(nextPath, {
      id: space.id,
      name: clean.name,
      createdAt: target?.createdAt || Date.now(),
    });
  } catch {
    // 清单写失败不回滚重命名：注册表已一致，discoverSpaces 也能补写
  }
  return { ok: true, space: { ...space, name: clean.name, path: nextPath } };
}

/** 复制空间：连同全部内容复制出新空间 */
export function copySpace(id, nextName, baseRoot) {
  const resolved = resolveSpace(id, baseRoot);
  if (!resolved.ok) return resolved;

  const clean = sanitizeSpaceName(nextName);
  if (!clean.ok) return { ok: false, error: clean.error };

  const reg = loadSpacesRegistry();
  if (nameTaken(reg, clean.name)) return { ok: false, error: `已存在同名空间「${clean.name}」` };

  // 与公共空间同级，保持目录布局稳定
  const parent = defaultManagedParent(baseRoot);
  const dir = path.join(parent, clean.name);
  if (fs.existsSync(dir)) return { ok: false, error: `目录已存在：${dir}` };

  try {
    fs.mkdirSync(parent, { recursive: true });
    copyDirSync(resolved.space.path, dir);
  } catch (e) {
    return { ok: false, error: `复制失败：${e instanceof Error ? e.message : String(e)}` };
  }

  const entry = { id: newSpaceId(), name: clean.name, path: dir, createdAt: Date.now() };
  try {
    // 拷贝继承的是源空间的清单（含源 id），必须改写成新身份
    writeSpaceManifest(dir, entry);
  } catch (e) {
    return { ok: false, error: `写入空间清单失败：${e instanceof Error ? e.message : String(e)}` };
  }
  reg.spaces.push(entry);
  saveSpacesRegistry(reg);
  return { ok: true, space: entry };
}

/**
 * 从列表移除空间。
 * @param {{ id: string, purge?: boolean, baseRoot: string }} opts purge=true 时连磁盘数据一起删
 */
export function removeSpace({ id, purge = false, baseRoot }) {
  const resolved = resolveSpace(id, baseRoot);
  if (!resolved.ok) return resolved;
  const space = resolved.space;
  if (space.isPublic) return { ok: false, error: `${PUBLIC_SPACE_NAME}不支持删除` };

  const reg = loadSpacesRegistry();
  reg.spaces = reg.spaces.filter((s) => s.id !== space.id);
  if (reg.activeId === space.id) reg.activeId = PUBLIC_SPACE_ID;
  saveSpacesRegistry(reg);

  if (!purge) return { ok: true, purged: false, space };

  // 物理删除前的最后一道闸：确认目标确实是数据空间，避免手滑删掉普通目录
  const guard = assertLooksLikeSpace(space.path, defaultManagedParent(baseRoot));
  if (!guard.ok) return { ok: true, purged: false, space, warning: guard.error };

  try {
    fs.rmSync(space.path, { recursive: true, force: true });
  } catch (e) {
    return {
      ok: true,
      purged: false,
      space,
      warning: `已移出列表，但删除目录失败：${e instanceof Error ? e.message : String(e)}`,
    };
  }
  return { ok: true, purged: true, space };
}

/**
 * 只有「落在选中文件夹内」或「带数据空间特征文件」的目录才允许物理删除。
 * @returns {{ ok: true } | { ok: false, error: string }}
 */
export function assertLooksLikeSpace(dir, managedParent) {
  const abs = path.resolve(dir);
  const parent = path.resolve(managedParent || defaultManagedParent());
  const insideParent = abs === parent || abs.startsWith(parent + path.sep);
  const hasMarker =
    Boolean(resolveManifestPath(abs)) ||
    fs.existsSync(spaceMetaDir(abs)) ||
    fs.existsSync(path.join(abs, '.local')) ||
    fs.existsSync(path.join(abs, META_LOCAL_NAME)) ||
    fs.existsSync(path.join(abs, META_CONFIG_NAME));
  if (!insideParent && !hasMarker) {
    return { ok: false, error: '该目录不像数据空间，已跳过磁盘删除' };
  }
  return { ok: true };
}

/** 设置当前空间（持久化，重启后沿用） */
export function setActiveSpace(id) {
  const reg = loadSpacesRegistry();
  reg.activeId = String(id || PUBLIC_SPACE_ID);
  saveSpacesRegistry(reg);
  return reg.activeId;
}

export function getActiveSpaceId() {
  return loadSpacesRegistry().activeId;
}

// ── 文件系统工具 ──────────────────────────────────────────────

/**
 * 复制 / 打包时跳过的目录。
 * 传入的可能是空间父目录（如 dev 下的仓库根），若不跳过，一次导出会把 node_modules
 * 与 .git 打进 zip（数 GB）；这些目录也都不是数据空间内容，可随时重建。
 */
const COPY_SKIP_DIRS = new Set(['node_modules', '.git', '.astro', 'dist']);

/** 递归复制目录（跳过 .DS_Store 与构建/版本控制目录，保留符号链接本身而非解引用） */
export function copyDirSync(from, to) {
  const src = path.resolve(from);
  const dest = path.resolve(to);

  // 复制到自身内部会无限递归
  if (dest === src || dest.startsWith(src + path.sep)) {
    throw new Error('目标目录不能位于源目录内部');
  }

  fs.mkdirSync(dest, { recursive: true });
  for (const ent of fs.readdirSync(src, { withFileTypes: true })) {
    if (ent.name === '.DS_Store') continue;
    if (ent.isDirectory() && COPY_SKIP_DIRS.has(ent.name)) continue;
    const s = path.join(src, ent.name);
    const d = path.join(dest, ent.name);
    if (ent.isSymbolicLink()) {
      const link = fs.readlinkSync(s);
      fs.symlinkSync(link, d);
    } else if (ent.isDirectory()) {
      copyDirSync(s, d);
    } else {
      fs.copyFileSync(s, d);
    }
  }
}

/** 递归列举目录下全部文件（相对 posix 路径） */
function walkFiles(root, opts = {}) {
  const scope = normalizeExportScope(opts.scope);
  const out = [];
  const walk = (dir, rel) => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      if (ent.name === '.DS_Store') continue;
      if (ent.isDirectory() && COPY_SKIP_DIRS.has(ent.name)) continue;
      const abs = path.join(dir, ent.name);
      const nextRel = rel ? `${rel}/${ent.name}` : ent.name;
      if (ent.isSymbolicLink()) continue; // 打包时不解引用，避免把外部内容卷进 zip
      if (ent.isDirectory()) {
        if (scope === EXPORT_SCOPE_CONTENT && CONTENT_EXPORT_SKIP_DIRS.has(nextRel)) continue;
        walk(abs, nextRel);
      } else if (ent.isFile()) {
        if (scope === EXPORT_SCOPE_CONTENT && CONTENT_EXPORT_SKIP_FILES.has(nextRel)) continue;
        out.push({ abs, rel: nextRel });
      }
    }
  };
  walk(path.resolve(root), '');
  return out;
}

// ── 「导出内容库」的敏感数据处理 ──────────────────────────────

/**
 * 「导出内容库」整份跳过的文件（相对空间根，posix 路径）。
 * 密钥 / 会话 / 工作区注册表都不该跟着内容一起外发。
 */
const CONTENT_EXPORT_SKIP_FILES = new Set([
  '.env',
  `${LOCAL_REL}/sessions.json`,
  `${LOCAL_REL}/sessions.jsonl`,
  `${LOCAL_REL}/session-query.sqlite`,
  `${LOCAL_REL}/workspaces.json`,
]);

/** 「导出内容库」整份跳过的目录：会话日志、检查点、记忆、工具结果溢出缓存 */
const CONTENT_EXPORT_SKIP_DIRS = new Set([
  `${LOCAL_REL}/session-log`,
  `${LOCAL_REL}/checkpoints`,
  `${LOCAL_REL}/memories`,
  `${LOCAL_REL}/spill`,
]);

/** 「导出内容库」保留但脱敏的文件：模型配置本身有用，密钥字段必须去掉 */
const CONTENT_EXPORT_SANITIZE_FILES = new Set([`${LOCAL_REL}/app.config.json`]);

/** 密钥类字段名：脱敏时递归剔除，宁可多删不可漏删 */
const SECRET_FIELD_RE =
  /^(api[-_]?key|apikey|secret|client[-_]?secret|token|access[-_]?token|refresh[-_]?token|auth[-_]?token|password|passwd|credential|credentials|authorization)$/i;

function stripSecretFields(value) {
  if (Array.isArray(value)) return value.map(stripSecretFields);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (SECRET_FIELD_RE.test(k)) continue;
      out[k] = stripSecretFields(v);
    }
    return out;
  }
  return value;
}

/** 取出待写入 zip 的内容；返回 null 表示该条目应被跳过 */
function readForExport(abs, rel, scope) {
  if (scope !== EXPORT_SCOPE_CONTENT || !CONTENT_EXPORT_SANITIZE_FILES.has(rel)) {
    return fs.readFileSync(abs);
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(abs, 'utf8'));
    return Buffer.from(`${JSON.stringify(stripSecretFields(parsed), null, 2)}\n`, 'utf8');
  } catch {
    // 解析不了就无法保证脱敏干净，只能整份丢掉
    return null;
  }
}

// ── zip 打包 / 解压 ───────────────────────────────────────────

async function loadJSZip() {
  const mod = await import('jszip');
  return mod.default ?? mod;
}

/**
 * 导出空间为 zip。
 * @param {{ id: string, outFile: string, baseRoot: string, scope?: 'full' | 'content' }} opts
 *   scope='content' 时排除密钥 / 会话 / 记忆 / 溢出缓存（模型配置脱敏后保留）
 */
export async function exportSpaceToZip({ id, outFile, baseRoot, scope }) {
  const resolved = resolveSpace(id, baseRoot);
  if (!resolved.ok) return resolved;

  const useScope = normalizeExportScope(scope);
  const JSZip = await loadJSZip();
  const zip = new JSZip();
  for (const { abs, rel } of walkFiles(resolved.space.path, { scope: useScope })) {
    const content = readForExport(abs, rel, useScope);
    if (!content) continue;
    zip.file(rel, content);
  }
  const buf = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  const dest = path.resolve(outFile);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, buf);
  return { ok: true, file: dest, bytes: buf.length, space: resolved.space, scope: useScope };
}

/**
 * 从 zip 导入为新空间。
 * @param {{ zipFile: string, name?: unknown, managedParent?: string, baseRoot: string }} opts
 */
export async function importSpaceFromZip({ zipFile, name, managedParent, baseRoot }) {
  const src = path.resolve(zipFile);
  if (!fs.existsSync(src)) return { ok: false, error: `文件不存在：${src}` };

  const JSZip = await loadJSZip();
  let zip;
  try {
    zip = await JSZip.loadAsync(fs.readFileSync(src));
  } catch (e) {
    return { ok: false, error: `不是有效的 zip：${e instanceof Error ? e.message : String(e)}` };
  }

  // 优先用调用方指定的名称；其次用包内清单自带的名称；最后退回 zip 文件名
  const manifest = await readManifestFromZip(zip);
  const fallbackName = path.basename(src).replace(/\.zip$/i, '') || '导入空间';
  const clean = sanitizeSpaceName(name ?? manifest?.name ?? fallbackName);
  if (!clean.ok) return { ok: false, error: clean.error };

  const reg = loadSpacesRegistry();
  if (nameTaken(reg, clean.name)) return { ok: false, error: `已存在同名空间「${clean.name}」` };

  const parent = path.resolve(managedParent || defaultManagedParent(baseRoot));
  const dir = path.join(parent, clean.name);
  if (fs.existsSync(dir)) return { ok: false, error: `目录已存在：${dir}` };

  fs.mkdirSync(dir, { recursive: true });
  const rootAbs = path.resolve(dir);

  for (const [entryPath, entry] of Object.entries(zip.files)) {
    if (entry.dir) continue;
    // zip-slip 防护：条目路径必须落在目标目录内（恶意包可能含 ../ 或绝对路径）
    const target = path.resolve(rootAbs, entryPath);
    if (target !== rootAbs && !target.startsWith(rootAbs + path.sep)) {
      continue;
    }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, await entry.async('nodebuffer'));
  }

  // id 一律新生成：包里的清单 id 属于源空间，直接沿用会和源空间撞身份
  const entry = {
    id: newSpaceId(),
    name: clean.name,
    path: dir,
    createdAt: Date.now(),
  };
  writeSpaceManifest(dir, entry);

  reg.spaces.push(entry);
  saveSpacesRegistry(reg);
  return { ok: true, space: entry };
}

/** 从 zip 里读空间清单（优先 `.tb/space.json`，兼容根目录旧文件）；读不到不报错，只是没有名称可参考 */
async function readManifestFromZip(zip) {
  const file = zip.file(SPACE_MANIFEST_REL) || zip.file(SPACE_MANIFEST_FILE);
  if (!file) return null;
  try {
    const raw = JSON.parse(await file.async('string'));
    if (!raw || typeof raw !== 'object' || raw.kind !== MANIFEST_KIND) return null;
    const name = String(raw.name || '').trim();
    return name ? { id: String(raw.id || ''), name } : null;
  } catch {
    return null;
  }
}

/** 空间数据的可读体积（管理面板展示用；失败退化为 0） */
export function spaceSize(dir) {
  try {
    let total = 0;
    for (const { abs } of walkFiles(dir)) {
      try {
        total += fs.statSync(abs).size;
      } catch {
        // ignore
      }
    }
    return total;
  } catch {
    return 0;
  }
}
