import { CASE_FIELDS, type TestCaseRow } from './export';

/** 将单元格内 `<br>` 等还原为换行，便于表格展示 */
function cellText(raw: string): string {
  return raw
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/\|/g, '|')
    .trim();
}

function splitRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  return trimmed.split('|').map((c) => cellText(c));
}

function isSepRow(line: string): boolean {
  return /^\s*\|?[\s-:|]+\|?\s*$/.test(line) && /-+/.test(line);
}

/**
 * 从 Markdown 中提取首个「用例字段」表，解析为 TestCaseRow[]。
 * 找不到合法表时返回空数组。
 */
export function parseCaseTableFromMarkdown(md: string): TestCaseRow[] {
  const lines = md.split(/\r?\n/);
  let headerIdx = -1;
  let headers: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].includes('|')) continue;
    const cols = splitRow(lines[i]);
    if (cols.includes('用例编号') && cols.includes('用例标题')) {
      headerIdx = i;
      headers = cols;
      break;
    }
  }
  if (headerIdx < 0) return [];

  const start = isSepRow(lines[headerIdx + 1] ?? '') ? headerIdx + 2 : headerIdx + 1;
  const rows: TestCaseRow[] = [];

  for (let i = start; i < lines.length; i++) {
    const line = lines[i];
    if (!line.includes('|') || isSepRow(line)) {
      if (rows.length > 0 && !line.includes('|')) break;
      continue;
    }
    const cols = splitRow(line);
    if (cols.every((c) => !c)) continue;
    const row = {} as TestCaseRow;
    for (const f of CASE_FIELDS) {
      const idx = headers.indexOf(f);
      row[f] = idx >= 0 ? (cols[idx] ?? '') : '';
    }
    if (!row.用例标题 && !row.用例编号) continue;
    rows.push(row);
  }
  return rows;
}
