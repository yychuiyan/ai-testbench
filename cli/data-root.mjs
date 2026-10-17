/**
 * 数据空间目录初始化与旧布局迁移。
 *
 * 单独成模块的原因：服务端（`cli/server.mjs`）与数据空间管理（`cli/spaces.mjs`
 * / `builtin/session/lh-spaces.mjs`）都要用，但这几个模块之间不能互相 import（会成环）。
 *
 * 两个层级要分清（命名与相对路径统一来自 `builtin/session/space-layout.mjs`）：
 * - 池根（spaces root）：用户选中的文件夹；打包模式 = lantern 记住的目录，dev = 仓库根
 * - 空间目录：用户数据目录下直接是「公共空间」；源码仓库根则在 `空间池/` 里
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {
  CONFIG_REL,
  LOCAL_REL,
  META_CONFIG_NAME,
  META_LOCAL_NAME,
  META_DIR,
  META_DIR_LEGACY,
  PUBLIC_SPACE_DIR,
  SPACE_MANIFEST_FILE,
  SPACE_POOL_DIR,
  poolPath,
  publicSpacePath,
  resolveContentRoot,
  usesNestedSpacePool,
  spaceConfigDir,
  spaceConfigFile,
  spaceLocalDir,
  spaceManifestFile,
  spaceManifestLegacyFile,
  spaceMetaDir,
} from '../builtin/session/space-layout.mjs';
import { DOC_ROOT_DIRS, migrateLegacyRoot } from '../lh-plugins/lh-project-docs.mjs';
import { markNavRootsDetected } from '../builtin/session/lh-nav-groups.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = path.resolve(__dirname, '..');
const PKG_DEFAULTS = path.join(PKG_ROOT, 'config', 'app.defaults.json');
/** 随包发布的种子文档根：`config/seeds/<内容目录名>/<文件>` */
const PKG_SEEDS = path.join(PKG_ROOT, 'config', 'seeds');

/**
 * 两个文件内容是否一致（先比大小，再比 sha256）。
 * 用于判断「合并后源目录里已经没有任何独有内容」。
 */
function sameFileContent(a, b) {
  try {
    const sa = fs.statSync(a);
    const sb = fs.statSync(b);
    if (!sa.isFile() || !sb.isFile() || sa.size !== sb.size) return false;
    const hash = (fp) => crypto.createHash('sha256').update(fs.readFileSync(fp)).digest('hex');
    return hash(a) === hash(b);
  } catch {
    return false;
  }
}

/**
 * `from` 里的每一项在 `to` 里是否都有内容相同的对应项。
 *
 * 逐条目 merge 不会覆盖同名文件，因此合并后源目录往往还留着撞名的旧副本；
 * 这些副本没有任何信息量，却会让仓库根/数据目录长期挂着一个重复的「公共空间」。
 * 只有全部一致（或源侧为空）才返回 true，调用方才敢删源。
 */
function fullyPresentIn(from, to, rel = '') {
  const src = rel ? path.join(from, rel) : from;
  const dst = rel ? path.join(to, rel) : to;
  let st;
  try {
    st = fs.statSync(src);
  } catch {
    return true;
  }
  if (!st.isDirectory()) return sameFileContent(src, dst);
  let names;
  try {
    names = fs.readdirSync(src);
  } catch {
    return false;
  }
  return names.every((n) => fullyPresentIn(from, to, rel ? path.join(rel, n) : n));
}

/**
 * 把 `from` 目录里的内容并进 `to`（幂等，绝不覆盖已存在条目，也绝不删源）。
 *
 * 为什么不用整目录 rename：目标目录常常已经被骨架铺出来了（例如先建了 `.lantern/config`
 * 再迁移旧 `config`），此时 rename 会直接失败并丢掉迁移机会。逐条目搬更稳妥。
 * @param {string} from
 * @param {string} to
 * @returns {string[]} 实际搬迁的条目名
 */
function mergeDirInto(from, to) {
  const moved = [];
  if (!fs.existsSync(from) || path.resolve(from) === path.resolve(to)) return moved;
  try {
    if (!fs.statSync(from).isDirectory()) return moved;
  } catch {
    return moved;
  }
  fs.mkdirSync(to, { recursive: true });
  for (const name of fs.readdirSync(from)) {
    const src = path.join(from, name);
    const dest = path.join(to, name);
    if (fs.existsSync(dest)) continue; // 不覆盖：两边都有时保留新位置那份
    try {
      fs.renameSync(src, dest);
      moved.push(name);
    } catch {
      // 跨卷 / 权限等问题：保持原状，不影响启动
    }
  }
  // 搬空且只剩占位文件时清掉旧目录，避免同名目录并存造成困惑
  try {
    const rest = fs.readdirSync(from).filter((n) => n !== '.gitkeep' && n !== '.DS_Store');
    if (rest.length === 0) fs.rmSync(from, { recursive: true, force: true });
  } catch {
    // ignore
  }
  return moved;
}

/**
 * 把上一世代隐藏目录 `.lantern/` 并进 `.lantern/`（幂等，不覆盖已有文件）。
 * @param {string} spaceDir
 * @returns {string[]}
 */
export function migrateLegacyHiddenMetaDir(spaceDir) {
  const root = path.resolve(spaceDir);
  return mergeDirInto(path.join(root, META_DIR_LEGACY), spaceMetaDir(root));
}

/**
 * 把空间内的 `config/` 与 `.local/` 收进隐藏元数据目录 `.lantern/`（幂等）。
 *
 * 历史布局里两者散在空间根目录，和内容目录混在一起；统一收进 `.lantern/` 后内容一眼看全。
 * 两个世代的名字都要认：早期的 `.local`（点开头）与后来的 `local`。
 * @param {string} spaceDir
 * @returns {{ config: string[], local: string[] }} 各自搬迁的条目
 */
export function migrateMetaIntoHiddenDir(spaceDir) {
  const root = path.resolve(spaceDir);
  const moved = { config: [], local: [] };
  migrateLegacyHiddenMetaDir(root);
  for (const name of [META_CONFIG_NAME, `.${META_CONFIG_NAME}`]) {
    moved.config.push(...mergeDirInto(path.join(root, name), spaceConfigDir(root)));
  }
  for (const name of [META_LOCAL_NAME, `.${META_LOCAL_NAME}`]) {
    moved.local.push(...mergeDirInto(path.join(root, name), spaceLocalDir(root)));
  }
  return moved;
}

/** 根目录旧清单收进 `.lantern/`（目标已存在则只删旧文件） */
function migrateLegacySpaceManifest(root) {
  const canon = spaceManifestFile(root);
  const legacy = spaceManifestLegacyFile(root);
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

/**
 * 确保「一个空间目录」具备隐藏元数据目录、默认配置与内容根（不覆盖已有文件；旧英文目录先迁移）。
 * 幂等：可用于「新建空间」与「切换到已存在空间」两条路径。
 * @param {string} spaceDir
 * @returns {string} 解析后的绝对路径
 */
export function prepareSpaceDir(spaceDir) {
  const root = path.resolve(spaceDir);
  fs.mkdirSync(root, { recursive: true });

  // 先迁移再建：一旦先建出 .lantern/config，旧 config/ 里的用户配置就得靠逐条目合并来救
  migrateMetaIntoHiddenDir(root);
  fs.mkdirSync(spaceLocalDir(root), { recursive: true });
  fs.mkdirSync(spaceConfigDir(root), { recursive: true });
  // 根目录旧 space.json 收进 .lantern/（清单属于元数据，不应和内容目录并列）
  migrateLegacySpaceManifest(root);

  const destDefaults = spaceConfigFile(root, 'app.defaults.json');
  const freshSpace = !fs.existsSync(destDefaults);
  if (freshSpace) {
    if (!fs.existsSync(PKG_DEFAULTS)) {
      throw new Error(`缺少包内默认配置：${PKG_DEFAULTS}`);
    }
    fs.copyFileSync(PKG_DEFAULTS, destDefaults);
  }

  for (const { dirName, legacyDirNames } of Object.values(DOC_ROOT_DIRS)) {
    // 必须先迁移：一旦先建出中文目录，旧目录里的文件就再也不会被搬过来
    migrateLegacyRoot(root, legacyDirNames, dirName);
    // 内容目录可能被归进了分组文件夹：跟着分组走，别在根上再铺一个空壳
    const dir = resolveContentRoot(root, dirName).abs;
    fs.mkdirSync(dir, { recursive: true });
    const keep = path.join(dir, '.gitkeep');
    if (!fs.existsSync(keep)) fs.writeFileSync(keep, '', 'utf8');
  }

  // 种子晚于建目录：这样「目标目录已存在」不会阻止种子落位
  seedSpaceDir(root);

  // 新建空间：种子不算「用户搬进来的内容」，别让它触发插件自动开启
  if (freshSpace) markNavRootsDetected(root);

  return root;
}

/** 与提示词管理页、工作台读取的文件名一致 */
export const SPACE_SYSTEM_PROMPT_FILE = '默认提示词.md';
const LEGACY_SPACE_PROMPT_FILES = [
  '空间提示词.md',
  '空间默认提示词.md',
  '系统提示词.md',
  'AI工作台系统提示词.md',
];

/**
 * 把包内种子文档补进空间（只在目标缺失时写入），支持分类子目录（模板库按分类分层）。
 *
 * 公共空间是忽略入库的本地文件夹，种子若只存在于其中，新克隆的仓库 / 新装包就没有默认内容；
 * 因此种子源放在随包发布的 `config/seeds/`，铺骨架时播种 —— dev、build、打包运行都覆盖到。
 * 非公共空间：提示词只播「默认提示词」，知识库不播公共空间那套规范文档。
 * @param {string} spaceDir
 * @returns {string[]} 本次播种的相对路径
 */
export function seedSpaceDir(spaceDir) {
  const root = path.resolve(spaceDir);
  const isPublic = path.basename(root) === PUBLIC_SPACE_DIR;
  const planted = [];

  /** 写成新文件，避免 copyFile 带上种子的创建时间 */
  function copyFileNew(from, to) {
    const buf = fs.readFileSync(from);
    if (fs.existsSync(to)) fs.unlinkSync(to);
    fs.writeFileSync(to, buf);
  }

  /** @param {string} srcDir @param {string} destDir @param {string} relPrefix */
  function walk(srcDir, destDir, relPrefix) {
    for (const name of fs.readdirSync(srcDir, { withFileTypes: true })) {
      // .gitkeep / .DS_Store 等占位与系统文件不入种子
      if (name.name.startsWith('.')) continue;
      const from = path.join(srcDir, name.name);
      const to = path.join(destDir, name.name);
      const rel = relPrefix ? `${relPrefix}/${name.name}` : name.name;
      if (name.isDirectory()) {
        walk(from, to, rel);
        continue;
      }
      if (fs.existsSync(to)) continue;
      try {
        fs.mkdirSync(path.dirname(to), { recursive: true });
        copyFileNew(from, to);
        planted.push(rel);
      } catch {
        // 种子只是初始内容：失败不阻断启动
      }
    }
  }

  for (const { dirName } of Object.values(DOC_ROOT_DIRS)) {
    const seedDir = path.join(PKG_SEEDS, dirName);
    if (!fs.existsSync(seedDir)) continue;
    // 内容目录可能已在分组文件夹里：种子要播到实际位置
    const destDir = resolveContentRoot(root, dirName).abs;
    fs.mkdirSync(destDir, { recursive: true });
    if (!isPublic && dirName === DOC_ROOT_DIRS.knowledge.dirName) continue;
    if (!isPublic && dirName === DOC_ROOT_DIRS.prompts.dirName) {
      const from = path.join(seedDir, SPACE_SYSTEM_PROMPT_FILE);
      const to = path.join(destDir, SPACE_SYSTEM_PROMPT_FILE);
      if (fs.existsSync(from) && !fs.existsSync(to)) {
        try {
          copyFileNew(from, to);
          planted.push(SPACE_SYSTEM_PROMPT_FILE);
        } catch {
          // 种子只是初始内容：失败不阻断启动
        }
      }
      continue;
    }
    walk(seedDir, destDir, '');
  }
  return planted;
}

/**
 * 把生成/手写的提示词写成该空间的默认提示词（覆盖种子，不覆盖空串）。
 * @param {string} spaceDir
 * @param {string} content
 * @returns {boolean} 是否写入
 */
export function writeSpaceSystemPrompt(spaceDir, content) {
  const text = String(content ?? '')
    .replace(/\r\n/g, '\n')
    .trim();
  if (!text) return false;
  const dir = resolveContentRoot(path.resolve(spaceDir), DOC_ROOT_DIRS.prompts.dirName).abs;
  fs.mkdirSync(dir, { recursive: true });
  const dest = path.join(dir, SPACE_SYSTEM_PROMPT_FILE);
  const body = text.endsWith('\n') ? text : `${text}\n`;
  // 先删再建，创建时间是这条提示词写入本空间的时间，而不是种子文件的时间
  if (fs.existsSync(dest)) fs.unlinkSync(dest);
  fs.writeFileSync(dest, body, 'utf8');
  for (const name of LEGACY_SPACE_PROMPT_FILES) {
    const leftover = path.join(dir, name);
    if (leftover !== dest && fs.existsSync(leftover)) {
      try {
        fs.unlinkSync(leftover);
      } catch {
        // ignore
      }
    }
  }
  return true;
}

/**
 * 池根下「旧布局」曾直接散落的条目，需要搬进公共空间文件夹。
 *
 * 老版本里内容目录、`.local`、`config` 直接躺在池根；正式位置是各空间自己的目录。
 * `config/` 要区别对待：dev 模式下仓库根的 `config/` 是**包内资源**（app.defaults.json 与
 * seeds 的来源），不是用户数据，搬走会破坏包自身；打包模式下它才是空间自己的配置。
 * 判据就是「池根是否为包根」。
 */
function legacyTopLevelNames(root) {
  const names = [
    META_LOCAL_NAME,
    META_CONFIG_NAME,
    // 更早的布局用点开头的隐藏名
    `.${META_LOCAL_NAME}`,
    ...Object.values(DOC_ROOT_DIRS).flatMap((d) => [d.dirName, ...(d.legacyDirNames || [])]),
  ];
  if (path.resolve(root) === PKG_ROOT) {
    // 仓库根的 config/ 是包内资源，不能搬
    return names.filter((n) => n !== META_CONFIG_NAME);
  }
  return names;
}

/**
 * 把池根下的既有内容搬进公共空间文件夹（幂等，逐条目合并不覆盖）。
 * @param {string} root 池根
 * @param {string} publicRoot 公共空间目录
 * @returns {string[]} 实际搬迁的条目名
 */
export function migrateIntoPublicSpace(root, publicRoot) {
  const moved = [];
  for (const name of legacyTopLevelNames(root)) {
    const from = path.join(root, name);
    if (!fs.existsSync(from)) continue;
    const into = mergeDirInto(from, path.join(publicRoot, name));
    if (into.length || !fs.existsSync(from)) moved.push(name);
  }
  return moved;
}

/** 摊平收回后只剩 `.lantern` / `.lantern` / 占位的空壳，可以删，避免仓库根再挂一份「公共空间」 */
function isLeftoverSpaceShell(dir) {
  try {
    const rest = fs.readdirSync(dir).filter((n) => n !== '.gitkeep' && n !== '.DS_Store');
    return (
      rest.length === 0 ||
      (rest.length === 1 && (rest[0] === META_DIR || rest[0] === META_DIR_LEGACY))
    );
  } catch {
    return false;
  }
}

/**
 * 误摊平到池根的空间文件夹：有清单 / 元数据，或就是「公共空间」。
 * 不把 src、config、node_modules 这类包目录当成空间。
 * @param {string} dir
 * @param {string} name
 */
function looksLikeLiftedSpace(dir, name) {
  if (name === PUBLIC_SPACE_DIR) return true;
  if (fs.existsSync(spaceManifestFile(dir)) || fs.existsSync(spaceManifestLegacyFile(dir))) {
    return true;
  }
  if (fs.existsSync(path.join(dir, META_DIR_LEGACY, SPACE_MANIFEST_FILE))) {
    return true;
  }
  try {
    const local = spaceLocalDir(dir);
    const legacyLocal = path.join(dir, META_DIR_LEGACY, META_LOCAL_NAME);
    return (
      (fs.existsSync(local) && fs.statSync(local).isDirectory()) ||
      (fs.existsSync(legacyLocal) && fs.statSync(legacyLocal).isDirectory())
    );
  } catch {
    return false;
  }
}

/**
 * 源码仓库：把误摊到仓库根的空间收回 `空间池/`（幂等）。
 * @param {string} root 池根
 * @returns {string[]} 实际搬迁的条目名
 */
function migrateFlattenedSpacesIntoPool(root) {
  const abs = path.resolve(root);
  const pool = path.join(abs, SPACE_POOL_DIR);
  fs.mkdirSync(pool, { recursive: true });
  const moved = [];
  let entries;
  try {
    entries = fs.readdirSync(abs, { withFileTypes: true });
  } catch {
    return moved;
  }
  for (const ent of entries) {
    if (!ent.isDirectory() || ent.isSymbolicLink() || ent.name === SPACE_POOL_DIR) continue;
    const from = path.join(abs, ent.name);
    if (!looksLikeLiftedSpace(from, ent.name)) continue;
    const to = path.join(pool, ent.name);
    if (path.resolve(from) === path.resolve(to)) continue;
    if (fs.existsSync(to)) {
      try {
        if (fs.statSync(from).isDirectory() && fs.statSync(to).isDirectory()) {
          mergeDirInto(from, to);
          moved.push(ent.name);
          // 源侧剩下的都是撞名副本（或只剩 `.lantern` 空壳）时删掉源目录，
          // 否则仓库根会长期挂着一份看起来「没搬走」的重复空间。
          if (isLeftoverSpaceShell(from) || fullyPresentIn(from, to)) {
            fs.rmSync(from, { recursive: true, force: true });
          }
        }
      } catch {
        // 两边类型不一致时保持原状
      }
      continue;
    }
    try {
      fs.renameSync(from, to);
      moved.push(ent.name);
    } catch {
      mergeDirInto(from, to);
      moved.push(ent.name);
      if (fullyPresentIn(from, to)) fs.rmSync(from, { recursive: true, force: true });
    }
  }
  return moved;
}

/**
 * 用户数据目录：把旧的 `<根>/空间池/` 抬到选中的文件夹下（幂等）。
 * npm 安装后文件夹里只留各空间，不再出现「空间池」。
 * @param {string} root 池根
 * @returns {string[]} 实际搬迁的条目名
 */
function migrateNestedPoolDir(root) {
  const abs = path.resolve(root);
  const nested = path.join(abs, SPACE_POOL_DIR);
  if (!fs.existsSync(nested) || path.resolve(nested) === abs) return [];
  try {
    if (!fs.statSync(nested).isDirectory()) return [];
  } catch {
    return [];
  }
  const moved = [];
  for (const name of fs.readdirSync(nested)) {
    if (name === '.DS_Store' || name === '.gitkeep') continue;
    const from = path.join(nested, name);
    const to = path.join(abs, name);
    if (path.resolve(from) === path.resolve(to)) continue;
    if (fs.existsSync(to)) {
      try {
        if (fs.statSync(from).isDirectory() && fs.statSync(to).isDirectory()) {
          mergeDirInto(from, to);
          moved.push(name);
          // 撞名副本没有信息量：合并后确认源侧无独有内容就删掉这一份
          if (fullyPresentIn(from, to)) fs.rmSync(from, { recursive: true, force: true });
        }
      } catch {
        // 两边类型不一致时保持原状
      }
      continue;
    }
    try {
      fs.renameSync(from, to);
      moved.push(name);
    } catch {
      mergeDirInto(from, to);
      moved.push(name);
    }
  }
  try {
    const rest = fs.readdirSync(nested).filter((n) => n !== '.gitkeep' && n !== '.DS_Store');
    if (rest.length === 0) fs.rmSync(nested, { recursive: true, force: true });
  } catch {
    // ignore
  }
  return moved;
}

/**
 * 确保「池根」就绪：公共空间骨架就位，并把旧布局的内容搬进去。
 *
 * dest = 仓库根，空间进「空间池」；npm / lantern 选中的文件夹里空间直接铺开。
 * @param {string} root 池根
 * @returns {string} 解析后的绝对路径
 */
export function prepareSpacesRoot(root) {
  const abs = path.resolve(root);
  fs.mkdirSync(abs, { recursive: true });

  if (usesNestedSpacePool(abs)) migrateFlattenedSpacesIntoPool(abs);
  else migrateNestedPoolDir(abs);

  const publicRoot = publicSpacePath(abs);
  fs.mkdirSync(publicRoot, { recursive: true });
  migrateIntoPublicSpace(abs, publicRoot);
  prepareSpaceDir(publicRoot);

  // 其它空间：只迁根目录旧清单，不铺骨架（避免给无关文件夹播种）
  try {
    const pool = poolPath(abs);
    for (const ent of fs.readdirSync(pool, { withFileTypes: true })) {
      if (!ent.isDirectory() || ent.isSymbolicLink() || ent.name === PUBLIC_SPACE_DIR) continue;
      if (ent.name === SPACE_POOL_DIR) continue;
      migrateLegacySpaceManifest(path.join(pool, ent.name));
    }
  } catch {
    // 池还不存在或不可读时跳过
  }

  return abs;
}

// 供其它模块与测试复用的相对路径常量（避免各处再硬编码 `.lantern/...`）
export { CONFIG_REL, LOCAL_REL };
