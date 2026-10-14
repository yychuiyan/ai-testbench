/** 浏览器与构建侧共用的「/」文档元数据（无 Node 依赖） */

export type SlashDocFormat = 'md' | 'xlsx' | 'xls' | 'docx' | 'doc' | 'dir' | 'file' | string;

export type SlashDocCollection = 'knowledge' | 'templates' | 'workspace';

export interface SlashDocItem {
  collection: SlashDocCollection;
  id: string;
  title: string;
  category: string;
  description: string;
  format: SlashDocFormat;
  /** 规范路径，供 kb_read / fs_read / 引用展示 */
  path: string;
  /** Office 等无法整文读取时，构建期摘要（kb_read 直接返回） */
  attachText?: string;
}

export function formatSlashBadge(format: string): string {
  if (format === 'md') return 'Markdown';
  if (format === 'xlsx' || format === 'xls') return 'Excel';
  if (format === 'docx' || format === 'doc') return 'Word';
  if (format === 'dir') return '文件夹';
  if (format === 'file') return '文件';
  return format.toUpperCase();
}

/** 斜杠过滤：标题/分类/路径/格式别名 */
export function matchSlashQuery(
  doc: Pick<SlashDocItem, 'title' | 'category' | 'id' | 'description' | 'format' | 'path'>,
  q: string,
): boolean {
  if (!q) return true;
  const hay = [
    doc.title,
    doc.category,
    doc.id,
    doc.description,
    doc.path,
    doc.format,
    formatSlashBadge(doc.format),
  ]
    .join('\n')
    .toLowerCase();
  if (hay.includes(q)) return true;
  if (
    (q === 'excel' || q === '表格' || q === 'xls') &&
    (doc.format === 'xlsx' || doc.format === 'xls')
  )
    return true;
  if (
    (q === 'word' || q === '文档' || q === 'doc') &&
    (doc.format === 'docx' || doc.format === 'doc')
  )
    return true;
  if ((q === 'md' || q === 'markdown' || q === '标记') && doc.format === 'md') return true;
  return false;
}
