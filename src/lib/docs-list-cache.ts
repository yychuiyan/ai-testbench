/**
 * 文档库列表首帧缓存（sessionStorage）。
 *
 * 用例 / 提示词 / 知识库都是 client:only 岛屿：刷新时先空挂载，
 * 再等 health + list 才渲染整张卡，视觉上就是右侧卡片「闪一下」。
 * 有缓存时首帧直接画出上次列表；后台再拉权威数据覆盖。
 */
import type { DocsEntry, DocsRoot } from './project-docs';
import { spaceScopedKey } from './space-scope';

const PREFIX = 'tw.docs.files.v1.';

export function readDocsListCache(root: DocsRoot): DocsEntry[] | null {
  try {
    const raw = sessionStorage.getItem(spaceScopedKey(PREFIX + root));
    if (!raw) return null;
    const data = JSON.parse(raw) as DocsEntry[];
    return Array.isArray(data) ? data : null;
  } catch {
    return null;
  }
}

export function writeDocsListCache(root: DocsRoot, files: DocsEntry[]): void {
  try {
    sessionStorage.setItem(spaceScopedKey(PREFIX + root), JSON.stringify(files));
  } catch {
    // 隐私模式写不进去：忽略，下次刷新仍可能闪一下
  }
}
