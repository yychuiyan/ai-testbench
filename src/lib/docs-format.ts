/** 文档库列表共用的格式化函数（知识库 / 用例管理 / 提示词管理 / 模板库 / 需求库） */

/** 文件大小：B / KB / MB；无值给占位符 */
export function fmtSize(n?: number): string {
  if (n == null) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/** 时间：`2026/10/13 16:58`；无值给占位符 */
export function fmtTime(ts?: number): string {
  if (!ts) return '—';
  try {
    return new Date(ts).toLocaleString('zh-CN', {
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '—';
  }
}
