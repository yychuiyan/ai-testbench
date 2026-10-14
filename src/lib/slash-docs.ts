/**
 * 构建期：组装 AI 工作台「@」引用目录（knowledge + templates Markdown/Excel/Word）。
 * 勿从 React 岛直接 import 本文件（会带入 Node/fs）。
 */
import type { CollectionEntry } from 'astro:content';
import { formatLabel, listBinaryTemplates } from './template-files';
import type { SlashDocItem } from './slash-docs-shared';

export type { SlashDocItem } from './slash-docs-shared';
export { matchSlashQuery, formatSlashBadge } from './slash-docs-shared';

function excelAttachText(opts: {
  title: string;
  category: string;
  relPosix: string;
  fieldSummary?: string;
  sheets?: Array<{ name: string; fields: string[] }>;
}): string {
  const lines = [
    `# ${opts.title}`,
    ``,
    `格式：Excel`,
    `分类：${opts.category}`,
    `文件：templates/${opts.relPosix}`,
    `说明：二进制工作簿无法在对话中展开全部单元格；以下为构建期解析的表头摘要。`,
    ``,
  ];
  if (opts.sheets?.length) {
    for (const s of opts.sheets) {
      lines.push(`## 工作表：${s.name}`);
      lines.push(s.fields.length ? `字段：${s.fields.join('、')}` : '（未识别到表头）');
      lines.push('');
    }
  } else if (opts.fieldSummary) {
    lines.push(opts.fieldSummary);
  } else {
    lines.push('（无字段摘要）');
  }
  return lines.join('\n').trim();
}

function wordAttachText(opts: {
  title: string;
  category: string;
  relPosix: string;
  format: string;
}): string {
  return [
    `# ${opts.title}`,
    ``,
    `格式：Word（${opts.format}）`,
    `分类：${opts.category}`,
    `文件：templates/${opts.relPosix}`,
    `说明：Word 二进制暂不解析正文，请下载原文件查看；对话中仅作模板引用。`,
  ].join('\n');
}

export function buildSlashDocs(
  knowledge: CollectionEntry<'knowledge'>[],
  templates: CollectionEntry<'templates'>[],
): SlashDocItem[] {
  const docs: SlashDocItem[] = [];

  for (const e of knowledge) {
    docs.push({
      collection: 'knowledge',
      id: e.id,
      title: e.data.title,
      category: e.data.category,
      description: e.data.description ?? '',
      format: 'md',
      path: `knowledge/${e.id}.md`,
    });
  }

  for (const e of templates) {
    docs.push({
      collection: 'templates',
      id: e.id,
      title: e.data.title,
      category: e.data.category,
      description: e.data.description ?? '',
      format: 'md',
      path: `templates/${e.id}.md`,
    });
  }

  for (const b of listBinaryTemplates()) {
    const isExcel = b.format === 'xlsx' || b.format === 'xls';
    const attachText = isExcel
      ? excelAttachText({
          title: b.title,
          category: b.category,
          relPosix: b.relPosix,
          fieldSummary: b.fieldSummary,
          sheets: b.sheets,
        })
      : wordAttachText({
          title: b.title,
          category: b.category,
          relPosix: b.relPosix,
          format: b.format,
        });
    const label = formatLabel(b.format);
    docs.push({
      collection: 'templates',
      id: b.relPosix,
      title: b.title,
      category: b.category,
      description: b.fieldSummary || `${label} 模板`,
      format: b.format,
      path: `templates/${b.relPosix}`,
      attachText,
    });
  }

  docs.sort((a, b) => {
    const c = a.collection.localeCompare(b.collection);
    if (c !== 0) return c;
    return a.title.localeCompare(b.title, 'zh');
  });
  return docs;
}
