/**
 * office-to-pdf：经本地 LibreOffice 将 Office 转为 PDF。
 */

const API = '/__tb_fs';

export const OFFICE_TO_PDF_HINT =
  '你可以使用 office_to_pdf：优先用本机 LibreOffice 转为 PDF；若未安装，则对 docx/xlsx/pptx 降级抽取正文为同目录 .extracted.md（需写权限）。';

export const OFFICE_TO_PDF_TOOL = {
  type: 'function' as const,
  function: {
    name: 'office_to_pdf',
    description:
      'Convert Office docs to PDF via LibreOffice when available; otherwise extract text to .extracted.md for docx/xlsx/pptx.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Input file path relative to workspace (or absolute when allowed)',
        },
        outDir: {
          type: 'string',
          description: 'Optional output directory (default: same as input)',
        },
      },
      required: ['path'],
    },
  },
};

export async function runOfficeToPdfTool(
  name: string,
  argsJson: string,
  access: string,
): Promise<string> {
  if (name !== 'office_to_pdf') {
    return JSON.stringify({ error: `unknown tool: ${name}` });
  }
  let args: { path?: unknown; outDir?: unknown } = {};
  try {
    args = JSON.parse(argsJson || '{}') as typeof args;
  } catch {
    return JSON.stringify({ ok: false, error: 'invalid JSON arguments' });
  }
  const filePath = String(args.path ?? '').trim();
  if (!filePath) {
    return JSON.stringify({ ok: false, error: 'path is required' });
  }
  try {
    const res = await fetch(`${API}/office-to-pdf`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        path: filePath,
        outDir: typeof args.outDir === 'string' ? args.outDir : undefined,
        access,
      }),
      signal: AbortSignal.timeout(130_000),
    });
    const data = await res.json().catch(() => ({}));
    return JSON.stringify(data, null, 2);
  } catch (e) {
    return JSON.stringify({
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    });
  }
}
