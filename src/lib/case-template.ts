/**
 * 解析用例模板文件（xlsx / csv / md 表头），供生成会话对齐字段结构。
 */
import JSZip from 'jszip';
import * as XLSX from 'xlsx';
import { CASE_FIELDS, looksLikeStepField, normalizeMultilineCell } from './export';

export interface ParsedCaseTemplate {
  headers: string[];
  /** 供 Prompt 引用的说明文本（含样例） */
  body: string;
}

function nonEmptyRow(row: unknown[]): boolean {
  return row.some((c) => String(c ?? '').trim().length > 0);
}

export function parseXlsxTemplateBase64(contentBase64: string): ParsedCaseTemplate {
  const wb = XLSX.read(contentBase64, { type: 'base64' });
  const sheetName = wb.SheetNames[0] ?? 'Sheet1';
  const sheet = wb.Sheets[sheetName];
  if (!sheet) {
    return { headers: [...CASE_FIELDS], body: '' };
  }
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    defval: '',
    raw: false,
  }) as unknown[][];
  const headerRow = (rows.find(nonEmptyRow) ?? []) as unknown[];
  const headers = headerRow.map((h) => String(h ?? '').trim()).filter(Boolean);
  if (!headers.length) {
    return { headers: [...CASE_FIELDS], body: `（模板工作表「${sheetName}」无表头）` };
  }

  const dataRows = rows.filter(nonEmptyRow).slice(1, 4);
  const lines = [
    `工作表：${sheetName}`,
    `字段（必须原样作为 JSON 对象键，顺序一致）：${headers.join('、')}`,
    '',
    '样例行（风格与粒度请对齐，勿照抄业务内容）：',
  ];
  for (const row of dataRows) {
    const obj: Record<string, string> = {};
    headers.forEach((h, i) => {
      obj[h] = String((row as unknown[])[i] ?? '').trim();
    });
    lines.push(JSON.stringify(obj, null, 2));
  }
  return { headers, body: lines.join('\n') };
}

export function parseCsvTemplate(content: string): ParsedCaseTemplate {
  const first = content.split(/\r?\n/).find((l) => l.trim()) ?? '';
  const headers = first
    .split(',')
    .map((h) => h.replace(/^"|"$/g, '').trim())
    .filter(Boolean);
  if (!headers.length) return { headers: [...CASE_FIELDS], body: content.slice(0, 4000) };
  return {
    headers,
    body: `字段（必须原样作为 JSON 对象键）：${headers.join('、')}\n\n${content.slice(0, 4000)}`,
  };
}

export function parseMdTemplate(content: string): ParsedCaseTemplate {
  const table = content.match(/^\|(.+)\|\s*$/m);
  if (table?.[1]) {
    const headers = table[1]
      .split('|')
      .map((h) => h.trim())
      .filter((h) => h && !/^[-:]+$/.test(h));
    if (headers.length) {
      return {
        headers,
        body: `字段（必须原样作为 JSON 对象键）：${headers.join('、')}\n\n${content.slice(0, 4000)}`,
      };
    }
  }
  return { headers: [...CASE_FIELDS], body: content.slice(0, 4000) };
}

export type CaseRow = Record<string, string>;

export function normalizeCaseRows(arr: unknown[], headers: string[]): CaseRow[] {
  const fields = headers.length ? headers : [...CASE_FIELDS];
  return arr.map((item) => {
    const obj = (item ?? {}) as Record<string, unknown>;
    const row: CaseRow = {};
    for (const f of fields) {
      const v = obj[f];
      const raw = typeof v === 'string' ? v : v == null ? '' : String(v);
      row[f] = looksLikeStepField(f) ? normalizeMultilineCell(raw) : raw;
    }
    return row;
  });
}

/** 为 SheetJS 生成的 xlsx 注入 wrapText，使单元格内换行可见 */
async function applyWrapTextToXlsxBase64(b64: string): Promise<string> {
  const zip = await JSZip.loadAsync(b64, { base64: true });
  const stylesPath = 'xl/styles.xml';
  const stylesFile = zip.file(stylesPath);
  if (stylesFile) {
    let styles = await stylesFile.async('string');
    if (!styles.includes('wrapText')) {
      if (/<cellXfs[^>]*count="1"[^>]*>\s*<xf[^/]*\/>\s*<\/cellXfs>/.test(styles)) {
        styles = styles.replace(
          /<cellXfs([^>]*)count="1"([^>]*)>\s*<xf([^/]*)\/>\s*<\/cellXfs>/,
          `<cellXfs$1count="2"$2><xf$3/><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf></cellXfs>`,
        );
      } else if (styles.includes('</cellXfs>')) {
        styles = styles
          .replace(/<cellXfs([^>]*)count="(\d+)"/, (_, a, n) => {
            return `<cellXfs${a}count="${Number(n) + 1}"`;
          })
          .replace(
            '</cellXfs>',
            '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf></cellXfs>',
          );
      }
      zip.file(stylesPath, styles);
    }
  }

  const sheetNames = Object.keys(zip.files).filter((n) =>
    /^xl\/worksheets\/sheet\d+\.xml$/.test(n),
  );
  for (const sheetPath of sheetNames) {
    const sheetFile = zip.file(sheetPath);
    if (!sheetFile) continue;
    let sheet = await sheetFile.async('string');
    // 字符串单元格套用 wrap 样式（index 1）；兼容 xml:space 等附加属性
    sheet = sheet.replace(/<c\b([^>]*)>/g, (full, attrs: string) => {
      if (!/\bt="str"/.test(attrs)) return full;
      if (/\bs="\d+"/.test(attrs)) return full;
      return `<c s="1"${attrs.startsWith(' ') ? attrs : ` ${attrs}`}>`;
    });
    // 数据行略增高，便于多行步骤阅读
    sheet = sheet.replace(/<row r="(\d+)"([^>]*)>/g, (_full, r: string, rest: string) => {
      if (Number(r) === 1 || /\bht=/.test(rest)) return `<row r="${r}"${rest}>`;
      return `<row r="${r}" ht="60" customHeight="1"${rest}>`;
    });
    zip.file(sheetPath, sheet);
  }

  return zip.generateAsync({ type: 'base64', compression: 'DEFLATE' });
}

function csvCell(v: string): string {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

function mdCell(v: string): string {
  return v.replace(/\|/g, '\\|').replace(/\n+/g, '<br>');
}

export function rowsToMarkdown(cases: CaseRow[], title: string, headers: string[]): string {
  const fields = headers.length ? headers : [...CASE_FIELDS];
  const lines = [
    `# ${title}`,
    '',
    `| ${fields.join(' | ')} |`,
    `|${fields.map(() => '---').join('|')}|`,
  ];
  for (const c of cases) {
    lines.push(`| ${fields.map((f) => mdCell(c[f] ?? '')).join(' | ')} |`);
  }
  return lines.join('\n') + '\n';
}

export function rowsToCsv(cases: CaseRow[], headers: string[]): string {
  const fields = headers.length ? headers : [...CASE_FIELDS];
  const header = fields.join(',');
  const rows = cases.map((c) => fields.map((f) => csvCell(c[f] ?? '')).join(','));
  return '\uFEFF' + [header, ...rows].join('\n');
}

export async function rowsToXlsxBase64(
  cases: CaseRow[],
  headers: string[],
  sheetName = '测试用例',
): Promise<string> {
  const fields = headers.length ? headers : [...CASE_FIELDS];
  const normalized = cases.map((c) => {
    const row: CaseRow = {};
    for (const f of fields) {
      const raw = c[f] ?? '';
      row[f] = looksLikeStepField(f) ? normalizeMultilineCell(raw) : raw;
    }
    return row;
  });
  const ws = XLSX.utils.json_to_sheet(normalized, { header: [...fields] });
  // 步骤/期望列加宽；写入前把单元格值再走一遍（含已有 \n）
  const range = ws['!ref'] ? XLSX.utils.decode_range(ws['!ref']) : null;
  if (range) {
    for (let R = range.s.r; R <= range.e.r; R++) {
      for (let C = range.s.c; C <= range.e.c; C++) {
        const addr = XLSX.utils.encode_cell({ r: R, c: C });
        const cell = ws[addr];
        if (!cell || typeof cell.v !== 'string') continue;
        if (R === 0) continue;
        const header = String(ws[XLSX.utils.encode_cell({ r: 0, c: C })]?.v ?? '');
        if (looksLikeStepField(header)) {
          cell.v = normalizeMultilineCell(cell.v);
          if (cell.w != null) cell.w = cell.v;
        }
      }
    }
  }
  ws['!cols'] = fields.map((f) => ({
    wch: looksLikeStepField(f) ? 48 : Math.min(28, Math.max(12, f.length + 4)),
  }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName.slice(0, 31));
  const raw = XLSX.write(wb, { bookType: 'xlsx', type: 'base64' }) as string;
  try {
    return await applyWrapTextToXlsxBase64(raw);
  } catch {
    return raw;
  }
}
