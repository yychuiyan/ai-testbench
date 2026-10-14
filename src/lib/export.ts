import * as XLSX from 'xlsx';

/** 用例表格字段（与生成 Prompt 约束一致） */
export interface TestCaseRow {
  用例编号: string;
  所属模块: string;
  用例标题: string;
  前置条件: string;
  测试步骤: string;
  预期结果: string;
  优先级: string;
  用例类型: string;
}

export const CASE_FIELDS: (keyof TestCaseRow)[] = [
  '用例编号',
  '所属模块',
  '用例标题',
  '前置条件',
  '测试步骤',
  '预期结果',
  '优先级',
  '用例类型',
];

/** 将「1、…； 2、…」类步骤/期望串规范为换行分隔 */
export function normalizeMultilineCell(value: string): string {
  if (!value) return value;
  let s = String(value).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  s = s.replace(/\\n/g, '\n');
  s = s.replace(/([；;])[ \t]*(?=\d+[、.．)）])/g, '$1\n');
  s = s.replace(/([^\n])[ \t]+(?=\d+[、.．)）])/g, '$1\n');
  return s.replace(/\n{3,}/g, '\n\n').trim();
}

export function looksLikeStepField(header: string): boolean {
  return /步骤|期望|预期|结果|标准|操作/.test(header);
}

function normalizeCaseRowForXlsx(c: TestCaseRow): TestCaseRow {
  const row = { ...c };
  for (const f of CASE_FIELDS) {
    if (looksLikeStepField(f)) row[f] = normalizeMultilineCell(row[f] ?? '');
  }
  return row;
}

export function exportXlsx(cases: TestCaseRow[], filename = '测试用例.xlsx'): void {
  const normalized = cases.map(normalizeCaseRowForXlsx);
  const ws = XLSX.utils.json_to_sheet(normalized, { header: [...CASE_FIELDS] });
  ws['!cols'] = [
    { wch: 14 },
    { wch: 14 },
    { wch: 28 },
    { wch: 24 },
    { wch: 44 },
    { wch: 44 },
    { wch: 8 },
    { wch: 12 },
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '测试用例');
  XLSX.writeFile(wb, filename);
}

function download(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function csvCell(v: string): string {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

export function exportCsv(cases: TestCaseRow[], filename = '测试用例.csv'): void {
  const header = CASE_FIELDS.join(',');
  const rows = cases.map((c) => CASE_FIELDS.map((f) => csvCell(c[f])).join(','));
  // BOM 让 Excel 正确识别 UTF-8 中文
  const text = '﻿' + [header, ...rows].join('\n');
  download(new Blob([text], { type: 'text/csv;charset=utf-8' }), filename);
}

function mdCell(v: string): string {
  return v.replace(/\|/g, '\\|').replace(/\n+/g, '<br>');
}

export function casesToMarkdown(cases: TestCaseRow[], title = '测试用例'): string {
  const lines = [
    `# ${title}`,
    '',
    `| ${CASE_FIELDS.join(' | ')} |`,
    `|${CASE_FIELDS.map(() => '---').join('|')}|`,
  ];
  for (const c of cases) {
    lines.push(`| ${CASE_FIELDS.map((f) => mdCell(c[f])).join(' | ')} |`);
  }
  return lines.join('\n') + '\n';
}

export function casesToCsv(cases: TestCaseRow[]): string {
  const header = CASE_FIELDS.join(',');
  const rows = cases.map((c) => CASE_FIELDS.map((f) => csvCell(c[f])).join(','));
  return '\uFEFF' + [header, ...rows].join('\n');
}

/** 浏览器端生成 xlsx 的 base64（无 data: 前缀） */
export function casesToXlsxBase64(cases: TestCaseRow[]): string {
  const normalized = cases.map(normalizeCaseRowForXlsx);
  const ws = XLSX.utils.json_to_sheet(normalized, { header: [...CASE_FIELDS] });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '测试用例');
  return XLSX.write(wb, { bookType: 'xlsx', type: 'base64' }) as string;
}

export function exportMarkdown(cases: TestCaseRow[], filename = '测试用例.md'): void {
  download(new Blob([casesToMarkdown(cases)], { type: 'text/markdown;charset=utf-8' }), filename);
}
