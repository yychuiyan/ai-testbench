/**
 * session-query-sqlite：本机 sqlite 索引（node:sqlite）。
 * CJK 用 LIKE 检索（FTS5 unicode61 对中文分词不友好）；会话 PUT 时同步。
 */
import fs from 'node:fs';
import path from 'node:path';

export function sessionQueryDbPath(root) {
  return path.join(root, '.local', 'session-query.sqlite');
}

function messageText(raw) {
  if (!raw || typeof raw !== 'object') return '';
  const m = raw;
  if (typeof m.content === 'string') return m.content;
  if (Array.isArray(m.content)) {
    return m.content
      .map((p) => {
        if (typeof p === 'string') return p;
        if (p && typeof p === 'object' && 'text' in p) return String(p.text ?? '');
        return '';
      })
      .join('\n');
  }
  return '';
}

function loadSqlite() {
  try {
    return import('node:sqlite');
  } catch {
    return null;
  }
}

/**
 * @returns {{ ok: boolean, backend: 'sqlite'|'unavailable', reason?: string, count?: number, path?: string }}
 */
export async function syncSessionQueryIndex(root, store) {
  const mod = await loadSqlite();
  if (!mod?.DatabaseSync) {
    return { ok: false, backend: 'unavailable', reason: 'node:sqlite not available' };
  }
  const fp = sessionQueryDbPath(root);
  fs.mkdirSync(path.dirname(fp), { recursive: true });
  const db = new mod.DatabaseSync(fp);
  try {
    db.exec(`
      PRAGMA journal_mode=WAL;
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL DEFAULT '',
        body TEXT NOT NULL DEFAULT '',
        archived INTEGER NOT NULL DEFAULT 0,
        deleted INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL DEFAULT 0
      );
    `);
    db.exec('DELETE FROM sessions;');
    const insertSess = db.prepare(
      `INSERT INTO sessions (id, title, body, archived, deleted, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
    );
    const sessions = Array.isArray(store?.sessions) ? store.sessions : [];
    for (const s of sessions) {
      if (!s || typeof s.id !== 'string') continue;
      const title = String(s.title ?? '');
      const body = (Array.isArray(s.messages) ? s.messages : [])
        .map((m) => messageText(m))
        .filter(Boolean)
        .join('\n');
      insertSess.run(
        s.id,
        title,
        body,
        s.archived ? 1 : 0,
        s.deleted ? 1 : 0,
        Number(s.updatedAt) || 0,
      );
    }
    return { ok: true, backend: 'sqlite', count: sessions.length, path: fp };
  } finally {
    try {
      db.close();
    } catch {
      // ignore
    }
  }
}

function snippetAround(text, needle) {
  const lower = text.toLowerCase();
  const n = needle.toLowerCase();
  const idx = lower.indexOf(n);
  if (idx < 0) return text.slice(0, 80);
  const start = Math.max(0, idx - 24);
  const end = Math.min(text.length, idx + needle.length + 48);
  return `${start > 0 ? '…' : ''}${text.slice(start, end).replace(/\s+/g, ' ')}${
    end < text.length ? '…' : ''
  }`;
}

/**
 * @returns {{ ok: boolean, backend: string, hits: Array<{ sessionId: string, title: string, archived: boolean, score: number, snippet: string, updatedAt: number }>, error?: string }}
 */
export async function querySessionIndex(root, query, opts = {}) {
  const q = String(query ?? '').trim();
  if (!q) return { ok: true, backend: 'sqlite', hits: [] };
  const mod = await loadSqlite();
  if (!mod?.DatabaseSync) {
    return { ok: false, backend: 'unavailable', hits: [], error: 'node:sqlite not available' };
  }
  const fp = sessionQueryDbPath(root);
  if (!fs.existsSync(fp)) {
    return { ok: false, backend: 'sqlite', hits: [], error: 'index missing; sync first' };
  }
  const limit = Math.min(Math.max(Number(opts.limit) || 20, 1), 50);
  const includeArchived = opts.includeArchived === true;
  const db = new mod.DatabaseSync(fp, { readOnly: true });
  try {
    const like = `%${q.replace(/%/g, '').replace(/_/g, '')}%`;
    const rows = db
      .prepare(
        `
      SELECT id AS sessionId, title, body, archived, updated_at AS updatedAt
      FROM sessions
      WHERE deleted = 0
        ${includeArchived ? '' : 'AND archived = 0'}
        AND (title LIKE ? OR body LIKE ?)
      ORDER BY updated_at DESC
      LIMIT ?
    `,
      )
      .all(like, like, limit);
    const hits = rows.map((r) => {
      const title = String(r.title || '');
      const body = String(r.body || '');
      const inTitle = title.toLowerCase().includes(q.toLowerCase());
      return {
        sessionId: String(r.sessionId),
        title: title || '新对话',
        archived: Boolean(r.archived),
        score: inTitle ? 10 : 1,
        snippet: inTitle ? title : snippetAround(body, q) || title,
        updatedAt: Number(r.updatedAt) || 0,
      };
    });
    hits.sort((a, b) => b.score - a.score || b.updatedAt - a.updatedAt);
    return { ok: true, backend: 'sqlite', hits };
  } catch (e) {
    return {
      ok: false,
      backend: 'sqlite',
      hits: [],
      error: e instanceof Error ? e.message : String(e),
    };
  } finally {
    try {
      db.close();
    } catch {
      // ignore
    }
  }
}
