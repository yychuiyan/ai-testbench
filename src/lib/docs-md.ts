import { marked } from 'marked';

/** 外链在新窗口打开 */
export function withBlankExternalLinks(html: string): string {
  return html.replace(
    /<a\s+([^>]*?)href="(https?:\/\/[^"]+)"([^>]*)>/gi,
    (_m, pre: string, href: string, post: string) => {
      const attrs = `${pre} ${post}`;
      const hasTarget = /\btarget=/i.test(attrs);
      const hasRel = /\brel=/i.test(attrs);
      return `<a ${pre}href="${href}"${post}${hasTarget ? '' : ' target="_blank"'}${
        hasRel ? '' : ' rel="noopener noreferrer"'
      }>`;
    },
  );
}

export function mdToHtml(md: string): string {
  const html = marked.parse(md, { async: false }) as string;
  return withBlankExternalLinks(html);
}

/** 去掉首个 H1 */
export function stripFirstH1(md: string): string {
  return md.replace(/^#\s+[^\n]+\n+/, '');
}
