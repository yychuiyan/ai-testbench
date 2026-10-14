import type { APIRoute, GetStaticPaths } from 'astro';
import { getCollection } from 'astro:content';

// 知识库 .md 源文件下载端点：/raw/knowledge/<分类>/<文件名>.md
export const getStaticPaths: GetStaticPaths = async () => {
  const entries = await getCollection('knowledge');
  return entries.map((entry) => ({
    params: { slug: entry.id },
    props: { raw: entry.body ?? '', filename: entry.id.split('/').pop() ?? 'doc' },
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
