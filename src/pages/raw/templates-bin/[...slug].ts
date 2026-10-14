import type { APIRoute, GetStaticPaths } from 'astro';
import fs from 'node:fs';
import { listBinaryTemplates } from '../../../lib/template-files';

/** Office 模板下载：/raw/templates-bin/<分类>/<文件名>.xlsx|docx|… */
export const getStaticPaths: GetStaticPaths = async () => {
  return listBinaryTemplates().map((f) => ({
    params: { slug: f.relPosix },
    props: {
      absPath: f.absPath,
      filename: f.filename,
      mime: f.mime,
    },
  }));
};

export const GET: APIRoute = ({ props }) => {
  const { absPath, filename, mime } = props as {
    absPath: string;
    filename: string;
    mime: string;
  };
  const buf = fs.readFileSync(absPath);
  return new Response(buf, {
    headers: {
      'Content-Type': mime,
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
    },
  });
};
