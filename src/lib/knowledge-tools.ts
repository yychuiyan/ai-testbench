/**
 * 知识库 / 模板检索工具：在浏览器内对 slashDocs 检索；
 * Markdown 拉取 /raw/*.md，Office 返回构建期 attachText。
 */
import type { ChatMessage } from './llm';
import { matchSlashQuery, type SlashDocItem } from './slash-docs-shared';

export type SlashDocMeta = SlashDocItem;

export const KB_SYSTEM_HINT =
  '用户可能通过「@」引用了知识库与模板下的 Markdown / Excel / Word 等文档（消息中会列出路径）。' +
  '请先调用 kb_read 读取引用内容：Markdown 为全文，Excel/Word 为字段或元数据摘要。' +
  '必要时用 kb_search 搜索；不要臆造未读到的正文。';

export const KB_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'kb_search',
      description:
        '在知识库与模板（含 Markdown、Excel、Word）中按关键词搜索，返回 path、标题、格式与摘要。',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: '搜索关键词，如 接口、excel、用例' },
          scope: {
            type: 'string',
            enum: ['all', 'knowledge', 'templates'],
            description: '限定范围，默认 all',
          },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'kb_read',
      description:
        '按 path 读取文档。Markdown 返回全文；Excel/Word 返回构建期摘要。path 如 templates/接口测试用例/接口测试用例模版.xlsx 或 knowledge/…/xxx.md',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: '相对路径（与引用列表中的 path 一致）',
          },
        },
        required: ['path'],
      },
    },
  },
];

function normalizePathKey(path: string): string {
  return path.trim().replace(/^\/+/, '').replace(/\\/g, '/');
}

function findDoc(docs: SlashDocMeta[], pathArg: string): SlashDocMeta | undefined {
  const key = normalizePathKey(pathArg);
  const keyNoMd = key.replace(/\.md$/i, '');
  return docs.find((d) => {
    const p = normalizePathKey(d.path);
    if (p === key || p === `${keyNoMd}.md`) return true;
    if (`${d.collection}/${d.id}` === key || `${d.collection}/${d.id}.md` === key) return true;
    if (d.id === key || d.id === keyNoMd) return true;
    return false;
  });
}

export async function runKnowledgeTool(
  name: string,
  argsJson: string,
  opts: { base: string; docs: SlashDocMeta[] },
): Promise<string> {
  let args: Record<string, unknown> = {};
  try {
    args = JSON.parse(argsJson || '{}') as Record<string, unknown>;
  } catch {
    return JSON.stringify({ error: 'invalid JSON arguments' });
  }

  const baseRaw = typeof opts.base === 'string' && opts.base ? opts.base : '/';
  const base = baseRaw.endsWith('/') ? baseRaw : `${baseRaw}/`;

  try {
    switch (name) {
      case 'kb_search': {
        const q = String(args.query ?? '')
          .trim()
          .toLowerCase();
        const scope = String(args.scope ?? 'all');
        if (!q) return JSON.stringify({ error: 'query required', results: [] });
        const results = opts.docs
          .filter((d) => scope === 'all' || d.collection === scope)
          .filter((d) => matchSlashQuery(d, q))
          .slice(0, 12)
          .map((d) => ({
            path: d.path,
            title: d.title,
            category: d.category,
            collection: d.collection,
            format: d.format,
            snippet: d.description || d.category,
          }));
        return JSON.stringify({ results, count: results.length });
      }
      case 'kb_read': {
        const meta = findDoc(opts.docs, String(args.path ?? ''));
        if (!meta) {
          return JSON.stringify({
            error: '未找到文档；请使用 kb_search 返回的 path',
            path: String(args.path ?? ''),
          });
        }

        if (meta.attachText) {
          return JSON.stringify({
            path: meta.path,
            title: meta.title,
            category: meta.category,
            format: meta.format,
            content: meta.attachText,
            note: 'Office 模板返回构建期摘要，非完整二进制内容',
          });
        }

        const url = `${base}raw/${meta.collection}/${meta.id}.md`;
        const res = await fetch(url);
        if (!res.ok) {
          return JSON.stringify({
            error: `读取失败 HTTP ${res.status}`,
            path: meta.path,
          });
        }
        const content = await res.text();
        return JSON.stringify({
          path: meta.path,
          title: meta.title,
          category: meta.category,
          format: meta.format,
          content,
        });
      }
      default:
        return JSON.stringify({ error: `unknown tool: ${name}` });
    }
  } catch (e) {
    return JSON.stringify({ error: e instanceof Error ? e.message : String(e) });
  }
}

export function appendKbSystemHint(systemPrompt: string): string {
  return `${systemPrompt}\n\n${KB_SYSTEM_HINT}`;
}

export function buildKbOnlyMessages(
  systemPrompt: string,
  allApiMessages: ChatMessage[],
): ChatMessage[] {
  return [{ role: 'system', content: appendKbSystemHint(systemPrompt) }, ...allApiMessages];
}
