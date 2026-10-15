/**
 * session-persistence-jsonl / session-checkpoint-policy 轻量子集。
 */
import fs from 'node:fs';
import path from 'node:path';

export function sessionsJsonlPath(root) {
  return path.join(root, '.local', 'sessions.jsonl');
}

export function checkpointsDir(root) {
  return path.join(root, '.local', 'checkpoints');
}

function writeJson(fp, data) {
  fs.mkdirSync(path.dirname(fp), { recursive: true });
  fs.writeFileSync(fp, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

/** 追加一行会话快照到 JSONL */
export function appendSessionsJsonl(root, store) {
  const line = JSON.stringify({
    type: 'session-store',
    at: new Date().toISOString(),
    activeId: store.activeId ?? '',
    count: Array.isArray(store.sessions) ? store.sessions.length : 0,
    sessions: (store.sessions || []).map((s) => ({
      id: s.id,
      title: s.title,
      updatedAt: s.updatedAt,
      archived: s.archived,
      messageCount: Array.isArray(s.messages) ? s.messages.length : 0,
    })),
  });
  const fp = sessionsJsonlPath(root);
  fs.mkdirSync(path.dirname(fp), { recursive: true });
  fs.appendFileSync(fp, `${line}\n`, 'utf8');
  const st = fs.statSync(fp);
  if (st.size > 8 * 1024 * 1024) {
    const buf = fs.readFileSync(fp);
    fs.writeFileSync(fp, buf.subarray(Math.max(0, buf.length - 4 * 1024 * 1024)));
  }
}

/**
 * 活跃会话消息检查点：消息数 ≥ 2 且为 10 的倍数时写盘。
 * @returns {string | null} 写入路径
 */
export function maybeWriteCheckpoint(root, store) {
  const activeId = store.activeId;
  if (!activeId || !Array.isArray(store.sessions)) return null;
  const sess = store.sessions.find((s) => s && s.id === activeId);
  if (!sess || !Array.isArray(sess.messages)) return null;
  const n = sess.messages.length;
  if (n < 2 || n % 10 !== 0) return null;
  const dir = checkpointsDir(root);
  fs.mkdirSync(dir, { recursive: true });
  const fp = path.join(dir, `${activeId}-latest.json`);
  writeJson(fp, {
    at: new Date().toISOString(),
    sessionId: activeId,
    title: sess.title,
    messageCount: n,
    messages: sess.messages.slice(-80),
    goal: sess.goal,
    todos: sess.todos,
  });
  return fp;
}

/** 读取某会话最新检查点（不存在则 null） */
export function readLatestCheckpoint(root, sessionId) {
  const id = String(sessionId ?? '').trim();
  if (!id) return null;
  const fp = path.join(checkpointsDir(root), `${id}-latest.json`);
  if (!fs.existsSync(fp)) return null;
  try {
    const data = JSON.parse(fs.readFileSync(fp, 'utf8'));
    if (!data || typeof data !== 'object') return null;
    return { path: fp, ...data };
  } catch {
    return null;
  }
}

/** 列出本机全部检查点摘要 */
export function listCheckpoints(root) {
  const dir = checkpointsDir(root);
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith('-latest.json')) continue;
    const fp = path.join(dir, name);
    try {
      const st = fs.statSync(fp);
      const data = JSON.parse(fs.readFileSync(fp, 'utf8'));
      out.push({
        sessionId: String(data.sessionId || name.replace(/-latest\.json$/, '')),
        title: typeof data.title === 'string' ? data.title : '',
        at: typeof data.at === 'string' ? data.at : '',
        messageCount: Number(data.messageCount) || 0,
        bytes: st.size,
        path: fp,
      });
    } catch {
      // ignore broken files
    }
  }
  out.sort((a, b) => String(b.at).localeCompare(String(a.at)));
  return out;
}
