import type { APIRoute, GetStaticPaths } from 'astro';
import { getCollection } from 'astro:content';

// 模板 .md 源文件下载端点：/raw/templates/<分类>/<文件名>.md
export const getStaticPaths: GetStaticPaths = async () => {
  const entries = await getCollection('templates');
  return entries.map((entry) => ({
    params: { slug: entry.id },
    props: { raw: entry.body ?? '', filename: entry.id.split('/').pop() ?? 'template' },
  }));
};

export const GET: APIRoute = ({ props }) => {
  const { raw, filename } = props as { raw: string; filename: string };
  return new Response(raw, {
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(filename)}.md`,
    },
  });
};
