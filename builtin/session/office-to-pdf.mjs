/**
 * office-to-pdf：优先 LibreOffice；不可用时抽取文本写入 .extracted.md 降级。
 */
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import JSZip from 'jszip';
import { extractRawText } from 'mammoth';
import xlsx from 'xlsx';

const execFileAsync = promisify(execFile);

const OFFICE_EXTS = new Set([
  '.doc',
  '.docx',
  '.xls',
  '.xlsx',
  '.ppt',
  '.pptx',
  '.odt',
  '.ods',
  '.odp',
  '.rtf',
]);

export function resolveLibreOfficeBinary() {
  const candidates =
    process.platform === 'darwin'
      ? ['/Applications/LibreOffice.app/Contents/MacOS/soffice', 'soffice', 'libreoffice']
      : process.platform === 'win32'
        ? ['soffice.exe', 'libreoffice.exe']
        : ['soffice', 'libreoffice'];
  for (const c of candidates) {
    if (c.includes(path.sep) || c.includes('/')) {
      if (fs.existsSync(c)) return c;
      continue;
    }
  }
  return process.platform === 'win32' ? 'soffice.exe' : 'soffice';
}

export async function probeOfficeToPdf() {
  const bin = resolveLibreOfficeBinary();
  try {
    await execFileAsync(bin, ['--version'], { timeout: 8_000, maxBuffer: 256 * 1024 });
    return { available: true, binary: bin };
  } catch {
    return { available: false, binary: bin };
  }
}

async function extractDocxText(abs) {
  const buf = fs.readFileSync(abs);
  const r = await extractRawText({ buffer: buf });
  return String(r.value || '').trim();
}

function extractXlsxText(abs) {
  const wb = xlsx.readFile(abs, { cellDates: true });
  const parts = [];
  for (const name of wb.SheetNames) {
    const sheet = wb.Sheets[name];
    const csv = xlsx.utils.sheet_to_csv(sheet);
    parts.push(`## ${name}\n\n${csv}`);
  }
  return parts.join('\n\n').trim();
}

async function extractPptxText(abs) {
  const buf = fs.readFileSync(abs);
  const zip = await JSZip.loadAsync(buf);
  const texts = [];
  const slideFiles = Object.keys(zip.files)
    .filter((n) => /^ppt\/slides\/slide\d+\.xml$/i.test(n))
    .sort();
  for (const name of slideFiles) {
    const xml = await zip.files[name].async('string');
    const bits = [...xml.matchAll(/<a:t[^>]*>([^<]*)<\/a:t>/g)].map((m) => m[1]);
    if (bits.length) texts.push(bits.join(''));
  }
  return texts.join('\n\n').trim();
}

/**
 * LibreOffice 不可用时：抽取正文写入同目录 .extracted.md
 * @returns {Promise<{ ok: boolean, fallback?: boolean, input?: string, output?: string, bytes?: number, error?: string, note?: string }>}
 */
export async function convertOfficeToTextFallback(inputAbs, outDirAbs) {
  const abs = path.resolve(inputAbs);
  const ext = path.extname(abs).toLowerCase();
  const outDir = path.resolve(outDirAbs || path.dirname(abs));
  fs.mkdirSync(outDir, { recursive: true });
  let body = '';
  try {
    if (ext === '.docx') body = await extractDocxText(abs);
    else if (ext === '.xlsx' || ext === '.xls') body = extractXlsxText(abs);
    else if (ext === '.pptx') body = await extractPptxText(abs);
    else {
      return {
        ok: false,
        fallback: true,
        error: `no LibreOffice; text fallback unsupported for ${ext}`,
      };
    }
  } catch (e) {
    return {
      ok: false,
      fallback: true,
      error: e instanceof Error ? e.message : String(e),
    };
  }
  if (!body) {
    return { ok: false, fallback: true, error: 'extracted text is empty' };
  }
  const base = path.basename(abs, ext);
  const outAbs = path.join(outDir, `${base}.extracted.md`);
  const md =
    `# ${base}\n\n` + `> LibreOffice 不可用，已降级为文本抽取（非 PDF）。\n\n` + `${body}\n`;
  fs.writeFileSync(outAbs, md, 'utf8');
  return {
    ok: true,
    fallback: true,
    input: abs,
    output: outAbs,
    bytes: Buffer.byteLength(md, 'utf8'),
    note: 'LibreOffice unavailable; wrote text extract .extracted.md instead of PDF',
  };
}

/**
 * @param {string} inputAbs
 * @param {string} [outDirAbs]
 * @param {{ allowFallback?: boolean }} [opts]
 */
export async function convertOfficeToPdf(inputAbs, outDirAbs, opts = {}) {
  const allowFallback = opts.allowFallback !== false;
  const abs = path.resolve(inputAbs);
  if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
    return { ok: false, error: `file not found: ${abs}` };
  }
  const ext = path.extname(abs).toLowerCase();
  if (!OFFICE_EXTS.has(ext)) {
    return { ok: false, error: `unsupported extension: ${ext || '(none)'}` };
  }
  const probe = await probeOfficeToPdf();
  if (!probe.available) {
    if (!allowFallback) {
      return {
        ok: false,
        error: 'LibreOffice/soffice not available on PATH',
        binary: probe.binary,
      };
    }
    return convertOfficeToTextFallback(abs, outDirAbs);
  }
  const outDir = path.resolve(outDirAbs || path.dirname(abs));
  fs.mkdirSync(outDir, { recursive: true });
  const tmpProfile = fs.mkdtempSync(path.join(os.tmpdir(), 'tb-lo-'));
  try {
    await execFileAsync(
      probe.binary,
      [
        '--headless',
        `--outdir`,
        outDir,
        '-env:UserInstallation=file://' + tmpProfile.replace(/\\/g, '/'),
        '--convert-to',
        'pdf',
        abs,
      ],
      { timeout: 120_000, maxBuffer: 2 * 1024 * 1024 },
    );
  } catch (e) {
    if (allowFallback) {
      const fb = await convertOfficeToTextFallback(abs, outDir);
      if (fb.ok) {
        return {
          ...fb,
          note: `LibreOffice failed (${e instanceof Error ? e.message : String(e)}); used text fallback`,
        };
      }
    }
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
      binary: probe.binary,
    };
  } finally {
    try {
      fs.rmSync(tmpProfile, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
  const base = path.basename(abs, ext);
  const pdfAbs = path.join(outDir, `${base}.pdf`);
  if (!fs.existsSync(pdfAbs)) {
    if (allowFallback) return convertOfficeToTextFallback(abs, outDir);
    return { ok: false, error: 'conversion finished but PDF not found', expected: pdfAbs };
  }
  return {
    ok: true,
    input: abs,
    output: pdfAbs,
    bytes: fs.statSync(pdfAbs).size,
    binary: probe.binary,
  };
}
