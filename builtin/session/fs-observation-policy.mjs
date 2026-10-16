/**
 * fs-observation-policy：文件系统观察/上报策略（跳过目录、读上限、搜索上限）。
 */
import { META_DIR } from './space-layout.mjs';

export const FS_SKIP_DIRS = [
  'node_modules',
  '.git',
  'dist',
  META_DIR,
  // 旧布局的元数据目录：老空间可能还没迁移
  '.local',
  '.astro',
  '.DS_Store',
  'coverage',
  '.next',
  '.turbo',
];

export const FS_MAX_READ_BYTES = 2 * 1024 * 1024;
export const FS_MAX_WRITE_BYTES = 10 * 1024 * 1024;
export const FS_GLOB_MAX = 100;
export const FS_GREP_MAX = 250;

export function getFsObservationPolicy() {
  return {
    skipDirs: [...FS_SKIP_DIRS],
    maxReadBytes: FS_MAX_READ_BYTES,
    maxWriteBytes: FS_MAX_WRITE_BYTES,
    globMax: FS_GLOB_MAX,
    grepMax: FS_GREP_MAX,
  };
}

export function shouldSkipDirName(name) {
  return FS_SKIP_DIRS.includes(String(name ?? ''));
}
