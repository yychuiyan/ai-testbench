/**
 * session-query：侧栏检索。
 * - 浏览器内：JSON 线性扫描（即时、可离线）
 * - 有本地服务时：优先 `/__tb_sessions/query`（sqlite 索引）
 */
import type { ChatSession, SessionStore } from './sessions';

const QUERY_API = '/__tb_sessions/query';

export interface SessionQueryHit {
  sessionId: string;
  title: string;
  archived: boolean;
  score: number;
  /** 命中预览（标题或消息片段） */
  snippet: string;
  updatedAt: number;
}

function messageText(raw: unknown): string {
  if (!raw || typeof raw !== 'object') return '';
  const m = raw as Record<string, unknown>;
  if (typeof m.content === 'string') return m.content;
  if (Array.isArray(m.content)) {
    return m.content
      .map((p) => {
        if (typeof p === 'string') return p;
        if (p && typeof p === 'object' && 'text' in p)
          return String((p as { text?: unknown }).text ?? '');
        return '';
      })
      .join('\n');
  }
  return '';
}

function scoreSession(session: ChatSession, q: string): { score: number; snippet: string } | null {
  const needle = q.trim().toLowerCase();
  if (!needle) return null;
  const title = (session.title || '').trim();
  let score = 0;
  let snippet = '';
  if (title.toLowerCase().includes(needle)) {
    score += 10;
    snippet = title;
  }
  const messages = Array.isArray(session.messages) ? session.messages : [];
  for (let i = messages.length - 1; i >= 0; i--) {
    const text = messageText(messages[i]);
    const lower = text.toLowerCase();
    const idx = lower.indexOf(needle);
    if (idx < 0) continue;
    score += 1;
    if (!snippet) {
      const start = Math.max(0, idx - 24);
      const end = Math.min(text.length, idx + needle.length + 48);
      snippet = `${start > 0 ? '…' : ''}${text.slice(start, end).replace(/\s+/g, ' ')}${
        end < text.length ? '…' : ''
      }`;
    }
    // 多条命中略加权，最多扫尾部 40 条
    if (messages.length - i > 40) break;
  }
  if (score <= 0) return null;
  return { score, snippet: snippet || title || session.id };
}

/** 在会话 store 内按关键词检索（标题 + 消息正文） */
export function querySessions(
  store: SessionStore | null | undefined,
  query: string,
  opts?: { limit?: number; includeArchived?: boolean },
): SessionQueryHit[] {
  const q = String(query ?? '').trim();
  if (!q || !store?.sessions?.length) return [];
  const limit = Math.min(Math.max(opts?.limit ?? 20, 1), 50);
  const includeArchived = opts?.includeArchived === true;
  const hits: SessionQueryHit[] = [];
  for (const s of store.sessions) {
    if (s.deleted) continue;
    if (s.archived && !includeArchived) continue;
    const scored = scoreSession(s, q);
    if (!scored) continue;
    hits.push({
      sessionId: s.id,
      title: s.title || '新对话',
      archived: Boolean(s.archived),
      score: scored.score,
      snippet: scored.snippet,
      updatedAt: s.updatedAt,
    });
  }
  hits.sort((a, b) => b.score - a.score || b.updatedAt - a.updatedAt);
  return hits.slice(0, limit);
}

/** 侧栏过滤：无查询时原样返回；有查询时按命中会话 id 过滤 */
export function filterSessionsByQuery<T extends { id: string }>(
  sessions: T[],
  store: SessionStore | null | undefined,
  query: string,
): T[] {
  const q = String(query ?? '').trim();
  if (!q) return sessions;
  const ids = new Set(
    querySessions(store, q, { limit: 50, includeArchived: true }).map((h) => h.sessionId),
  );
  return sessions.filter((s) => ids.has(s.id));
}

/** 经本地服务 sqlite FTS 检索；失败返回 null（调用方回退 JSON） */
export async function querySessionsViaApi(
  query: string,
  opts?: { limit?: number; includeArchived?: boolean },
): Promise<{ backend: string; hits: SessionQueryHit[] } | null> {
  const q = String(query ?? '').trim();
  if (!q) return { backend: 'sqlite', hits: [] };
  try {
    const sp = new URLSearchParams({
      q,
      limit: String(opts?.limit ?? 20),
    });
    if (opts?.includeArchived) sp.set('archived', '1');
    const res = await fetch(`${QUERY_API}?${sp}`, { signal: AbortSignal.timeout(4000) });
    const data = (await res.json().catch(() => null)) as {
      ok?: boolean;
      backend?: string;
      hits?: SessionQueryHit[];
    } | null;
    if (!res.ok || !data || !Array.isArray(data.hits)) return null;
    return { backend: data.backend || 'sqlite', hits: data.hits };
  } catch {
    return null;
  }
}
