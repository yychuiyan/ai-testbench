/**
 * 扫描 空间池/公共空间/测试模板库/ 下的 Office 模板（Excel / Word），按分类子目录归类。
 * Excel：构建期解析 sheet 名 + 首行表头，供列表区分；不做在线预览。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as XLSX from 'xlsx';
import type { CollectionEntry } from 'astro:content';
import { PUBLIC_SPACE_REL } from '../../builtin/session/space-layout.mjs';
import {
  TEMPLATE_CATEGORY_ORDER,
  isTemplateCategory,
  type TemplateCategory,
} from './templates-meta';

const BINARY_EXTS = ['.xlsx', '.xls', '.docx', '.doc'] as const;
export type TemplateBinaryExt = (typeof BINARY_EXTS)[number];

export type TemplateFormat = 'md' | 'xlsx' | 'xls' | 'docx' | 'doc';

export interface ExcelSheetSummary {
  name: string;
  /** 首行非空单元格，视为表头字段 */
  fields: string[];
}

export interface TemplateListItem {
  id: string;
  title: string;
  category: TemplateCategory;
  description?: string;
  version?: string;
  format: TemplateFormat;
  /** 站内打开（Markdown 详情）或下载（Office） */
  href: string;
  /** Office 下载路径；Markdown 也可用 raw 链接 */
  downloadHref: string;
  /** Excel 构建期摘要 */
  sheets?: ExcelSheetSummary[];
  /** 列表展示用短文案（字段/工作表） */
  fieldSummary?: string;
}

const MIME: Record<TemplateBinaryExt, string> = {
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.xls': 'application/vnd.ms-excel',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.doc': 'application/msword',
};

/** 仓库根（构建期资源，如公共空间骨架、种子） */
export function templatesRoot(): string {
  // src/lib → 仓库根
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
}

/** 公共空间目录 */
export function publicSpaceDir(): string {
  return path.join(templatesRoot(), ...PUBLIC_SPACE_REL.split('/'));
}

function formatLabel(format: TemplateFormat): string {
  if (format === 'md') return 'Markdown';
  if (format === 'xlsx' || format === 'xls') return 'Excel';
  return 'Word';
}

export { formatLabel };

const MAX_SHEETS = 4;
const MAX_FIELDS = 12;

/** 构建期读取 Excel：各 sheet 名 + 第一行表头 */
export function extractExcelSummary(absPath: string): {
  sheets: ExcelSheetSummary[];
  fieldSummary: string;
} | null {
  try {
    const buf = fs.readFileSync(absPath);
    const wb = XLSX.read(buf, { type: 'buffer', bookSheets: false, sheetRows: 1 });
    const sheets: ExcelSheetSummary[] = [];
    for (const name of wb.SheetNames.slice(0, MAX_SHEETS)) {
      const ws = wb.Sheets[name];
      if (!ws) {
        sheets.push({ name, fields: [] });
        continue;
      }
      const rows = XLSX.utils.sheet_to_json<(string | number | boolean | null)[]>(ws, {
        header: 1,
        defval: '',
        blankrows: false,
      }) as unknown[][];
      const first = (rows[0] ?? []) as unknown[];
      const fields = first
        .map((c) => String(c ?? '').trim())
        .filter(Boolean)
        .slice(0, MAX_FIELDS);
      sheets.push({ name, fields });
    }

    const primary = sheets[0];
    const fieldPart = primary?.fields.length ? `字段：${primary.fields.join('、')}` : '';
    const sheetPart =
      sheets.length > 1
        ? `工作表：${sheets.map((s) => s.name).join(' | ')}`
        : sheets.length === 1
          ? `工作表：${sheets[0]!.name}`
          : '';
    const fieldSummary = [sheetPart, fieldPart].filter(Boolean).join(' · ');
    return { sheets, fieldSummary: fieldSummary || '（未识别到表头）' };
  } catch (e) {
    console.warn(`[templates] Excel 摘要解析失败: ${absPath}`, e instanceof Error ? e.message : e);
    return null;
  }
}

export function listBinaryTemplates(): Array<{
  relPosix: string;
  absPath: string;
  title: string;
  category: TemplateCategory;
  ext: TemplateBinaryExt;
  format: Exclude<TemplateFormat, 'md'>;
  filename: string;
  mime: string;
  sheets?: ExcelSheetSummary[];
  fieldSummary?: string;
}> {
  const root = path.join(publicSpaceDir(), '测试模板库');
  const out: ReturnType<typeof listBinaryTemplates> = [];
  if (!fs.existsSync(root)) return out;

  for (const cat of TEMPLATE_CATEGORY_ORDER) {
    const dir = path.join(root, cat);
    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) continue;
    for (const name of fs.readdirSync(dir)) {
      if (name.startsWith('.')) continue;
      const abs = path.join(dir, name);
      if (!fs.statSync(abs).isFile()) continue;
      const ext = path.extname(name).toLowerCase() as TemplateBinaryExt;
      if (!BINARY_EXTS.includes(ext)) continue;
      const stem = path.basename(name, ext);
      const relPosix = `${cat}/${name}`.split(path.sep).join('/');
      const format = ext.slice(1) as Exclude<TemplateFormat, 'md'>;
      const item: (typeof out)[number] = {
        relPosix,
        absPath: abs,
        title: stem,
        category: cat,
        ext,
        format,
        filename: name,
        mime: MIME[ext],
      };
      if (format === 'xlsx' || format === 'xls') {
        const summary = extractExcelSummary(abs);
        if (summary) {
          item.sheets = summary.sheets;
          item.fieldSummary = summary.fieldSummary;
        } else {
          item.fieldSummary = '（表头解析失败，仍可下载）';
        }
      }
      out.push(item);
    }
  }
  return out;
}

/** 合并 Markdown 集合与 Office 文件，按分类分组 */
export function buildTemplateGroups(
  base: string,
  mdEntries: CollectionEntry<'templates'>[],
): Map<string, TemplateListItem[]> {
  const groups = new Map<string, TemplateListItem[]>();

  function push(item: TemplateListItem) {
    const list = groups.get(item.category) ?? [];
    list.push(item);
    groups.set(item.category, list);
  }

  for (const e of mdEntries) {
    if (!isTemplateCategory(e.data.category)) continue;
    push({
      id: e.id,
      title: e.data.title,
      category: e.data.category,
      description: e.data.description,
      version: e.data.version,
      format: 'md',
      href: `${base}templates/${e.id}`,
      downloadHref: `${base}raw/templates/${e.id}.md`,
    });
  }

  for (const b of listBinaryTemplates()) {
    push({
      id: b.relPosix,
      title: b.title,
      category: b.category,
      format: b.format,
      href: `${base}raw/templates-bin/${b.relPosix}`,
      downloadHref: `${base}raw/templates-bin/${b.relPosix}`,
      sheets: b.sheets,
      fieldSummary: b.fieldSummary,
      description: b.fieldSummary,
    });
  }

  for (const [cat, list] of groups) {
    list.sort((a, b) => a.title.localeCompare(b.title, 'zh'));
    groups.set(cat, list);
  }
  return groups;
}
