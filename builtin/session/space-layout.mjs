/**
 * 空间磁盘布局：所有「空间在磁盘上叫什么」的唯一来源。
 *
 * 两种落盘方式（「空间池」写死在本模块，并随 npm 包源码发布）：
 *
 * 1. `tbench init` 选中的文件夹：只有各空间，没有「空间池」。
 *    ```
 *    <选中的文件夹>/
 *    ├── 公共空间/
 *    └── 项目A/
 *    ```
 *
 * 2. 源码 / npm 安装后的包目录：自带「空间池」，避免和 cli、src 混在一起。
 *    ```
 *    <包根>/
 *    └── 空间池/
 *        └── 公共空间/     ← 仅当以包根当数据目录时（dest）
 *    ```
 */
import fs from 'node:fs';
import path from 'node:path';

/** 空间池目录名：源码仓库里的容器目录；用户数据目录不建这一层 */
export const SPACE_POOL_DIR = '空间池';
/** 内建「公共空间」的文件夹名 */
export const PUBLIC_SPACE_DIR = '公共空间';
/** 空间内元数据目录名（隐藏） */
export const META_DIR = '.tb';
/** 元数据下的配置目录名（原 `config/`） */
export const META_CONFIG_NAME = 'config';
/** 元数据下的本机状态目录名（原 `.local/`） */
export const META_LOCAL_NAME = 'local';

/**
 * 源码仓库或 npm 安装后的包根：空间进「空间池」。
 * 用户 `tbench init` 选中的普通文件夹没有本包的 package.json，不会建这一层。
 * @param {string} root
 */
export function usesNestedSpacePool(root) {
  const abs = path.resolve(root);
  try {
    const pkgFile = path.join(abs, 'package.json');
    if (!fs.existsSync(pkgFile) || !fs.existsSync(path.join(abs, 'cli', 'tbench.mjs'))) {
      return false;
    }
    const pkg = JSON.parse(fs.readFileSync(pkgFile, 'utf8'));
    return pkg?.name === 'ai-testbench';
  } catch {
    return false;
  }
}

/** 公共空间相对源码仓库根的路径（POSIX），供 dest 内容集合使用 */
export const PUBLIC_SPACE_REL = `${SPACE_POOL_DIR}/${PUBLIC_SPACE_DIR}`;
/** 空间内元数据的相对路径前缀（POSIX，供导出过滤与展示用） */
export const META_REL = META_DIR;
/** 空间内本机状态的相对路径（POSIX），如 `.tb/local` */
export const LOCAL_REL = `${META_DIR}/${META_LOCAL_NAME}`;
/** 空间内配置的相对路径（POSIX），如 `.tb/config` */
export const CONFIG_REL = `${META_DIR}/${META_CONFIG_NAME}`;
/** 元数据下的文件相对路径，如 `.tb/local/sessions.json` */
export function metaLocalRel(...segs) {
  return [LOCAL_REL, ...segs].join('/');
}

/**
 * 空间的父目录：源码仓库 = `<根>/空间池`；用户数据目录 = `<根>` 本身。
 * @param {string} root
 */
export function poolPath(root) {
  const abs = path.resolve(root);
  return usesNestedSpacePool(abs) ? path.join(abs, SPACE_POOL_DIR) : abs;
}

/** 公共空间目录 */
export function publicSpacePath(root) {
  return path.join(poolPath(root), PUBLIC_SPACE_DIR);
}

/**
 * 对外展示路径：隐去中间的「空间池」目录。
 * `<根>/空间池/公共空间` → `<根>/公共空间`
 */
export function displaySpacePath(absPath, baseRoot) {
  const root = path.resolve(baseRoot);
  const nestedPool = path.join(root, SPACE_POOL_DIR);
  const full = path.resolve(absPath);
  if (full === nestedPool) return root;
  const prefix = nestedPool + path.sep;
  if (full.startsWith(prefix)) return path.join(root, full.slice(prefix.length));
  return full;
}

/** 空间的元数据目录：`<空间>/.tb` */
export function spaceMetaDir(spaceDir) {
  return path.join(path.resolve(spaceDir), META_DIR);
}

/** 空间的配置目录：`<空间>/.tb/config` */
export function spaceConfigDir(spaceDir) {
  return path.join(spaceMetaDir(spaceDir), META_CONFIG_NAME);
}

/** 空间的本机状态目录：`<空间>/.tb/local` */
export function spaceLocalDir(spaceDir) {
  return path.join(spaceMetaDir(spaceDir), META_LOCAL_NAME);
}

/** 空间清单文件名 */
export const SPACE_MANIFEST_FILE = 'space.json';
/** 空间清单相对空间根的路径：`.tb/space.json` */
export const SPACE_MANIFEST_REL = `${META_DIR}/${SPACE_MANIFEST_FILE}`;

/** 空间清单绝对路径：`<空间>/.tb/space.json` */
export function spaceManifestFile(spaceDir) {
  return path.join(spaceMetaDir(spaceDir), SPACE_MANIFEST_FILE);
}

/** 升级前根目录清单：`<空间>/space.json` */
export function spaceManifestLegacyFile(spaceDir) {
  return path.join(path.resolve(spaceDir), SPACE_MANIFEST_FILE);
}

/** 空间内的文件绝对路径：配置目录下 */
export function spaceConfigFile(spaceDir, ...segs) {
  return path.join(spaceConfigDir(spaceDir), ...segs);
}

/** 空间内的文件绝对路径：本机状态目录下 */
export function spaceLocalFile(spaceDir, ...segs) {
  return path.join(spaceLocalDir(spaceDir), ...segs);
}
