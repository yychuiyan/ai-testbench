import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import {
  convertOfficeToPdf,
  convertOfficeToTextFallback,
  probeOfficeToPdf,
} from '../../builtin/session/office-to-pdf.mjs';

describe('office-to-pdf', () => {
  let tmp = '';

  before(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tb-office-'));
  });

  after(() => {
    try {
      fs.rmSync(tmp, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it('probe returns boolean available', async () => {
    const p = await probeOfficeToPdf();
    assert.equal(typeof p.available, 'boolean');
    assert.ok(p.binary);
  });

  it('convert rejects missing file', async () => {
    const r = await convertOfficeToPdf('/tmp/tb-office-missing-nope.docx');
    assert.equal(r.ok, false);
    assert.match(String(r.error), /not found/i);
  });

  it('text fallback writes extracted md for docx', async () => {
    // 最小 docx：zip + word/document.xml
    const { default: JSZip } = await import('jszip');
    const zip = new JSZip();
    zip.file(
      '[Content_Types].xml',
      `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,
    );
    zip
      .folder('_rels')
      ?.file(
        '.rels',
        `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
      );
    zip
      .folder('word')
      ?.file(
        'document.xml',
        `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>支付回调验收</w:t></w:r></w:p></w:body></w:document>`,
      );
    const buf = await zip.generateAsync({ type: 'nodebuffer' });
    const docx = path.join(tmp, 'sample.docx');
    fs.writeFileSync(docx, buf);
    const r = await convertOfficeToTextFallback(docx, tmp);
    assert.equal(r.ok, true);
    assert.equal(r.fallback, true);
    assert.ok(r.output && fs.existsSync(r.output));
    const md = fs.readFileSync(r.output!, 'utf8');
    assert.match(md, /支付回调验收/);
  });
});
