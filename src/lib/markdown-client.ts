import { Marked } from 'marked';
import DOMPurify from 'dompurify';

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** 代码块带标题栏与复制按钮（dsh CodeBlock 形态）；复制由对话页事件委托处理 data-copy-code */
const md = new Marked({
  renderer: {
    code({ text, lang, escaped }) {
      const label = escapeHtml((lang ?? '').trim().split(/\s+/)[0] || '代码块');
      const body = escaped ? text : escapeHtml(text);
      return (
        `<div class="code-block"><div class="code-block-head"><span>${label}</span>` +
        `<button type="button" data-copy-code>复制</button></div>` +
        `<pre><code>${body}</code></pre></div>`
      );
    },
    link(token) {
      const href = escapeHtml(token.href || '');
      const titleAttr = token.title ? ` title="${escapeHtml(token.title)}"` : '';
      // marked 会把 this 绑到 Renderer，以正确渲染链接内加粗等
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const label = (this as any).parser.parseInline(token.tokens ?? []);
      return (
        `<a href="${href}"${titleAttr} target="_blank" rel="noopener noreferrer">` + `${label}</a>`
      );
    },
  },
});

/**
 * 对话消息的客户端 Markdown 渲染。
 * 必须经 DOMPurify 消毒 —— BYOK 场景下 XSS 即 Key 泄露。
 */
export function renderMarkdown(source: string): string {
  const html = md.parse(source, { async: false }) as string;
  // 保留新窗口打开所需属性（默认消毒可能剥掉 target）
  return DOMPurify.sanitize(html, { ADD_ATTR: ['target'] });
}
