/**
 * session-log-deepseek：按会话追加 DeepSeek 形态回合日志（本机 JSONL）。
 */
import fs from 'node:fs';
import path from 'node:path';

const MAX_FILE_BYTES = 4 * 1024 * 1024;

export function sessionLogDir(root) {
  return path.join(root, '.local', 'session-log');
}

function safeSessionId(id) {
  return (
    String(id ?? '')
      .trim()
      .replace(/[^\w.-]+/g, '_')
      .slice(0, 80) || 'unknown'
  );
}

/**
 * @param {string} root
 * @param {{ sessionId: string, model?: string, messages?: Array<object> }} entry
 */
export function appendDeepseekSessionLog(root, entry) {
  const sessionId = safeSessionId(entry.sessionId);
  if (!sessionId || sessionId === 'unknown') {
    throw new Error('sessionId is required');
  }
  const dir = sessionLogDir(root);
  fs.mkdirSync(dir, { recursive: true });
  const fp = path.join(dir, `${sessionId}.jsonl`);
  const line = JSON.stringify({
    type: 'turn',
    at: new Date().toISOString(),
    sessionId,
    model: entry.model ?? '',
    messages: Array.isArray(entry.messages) ? entry.messages : [],
  });
  fs.appendFileSync(fp, `${line}\n`, 'utf8');
  try {
    const st = fs.statSync(fp);
    if (st.size > MAX_FILE_BYTES) {
      const buf = fs.readFileSync(fp);
      fs.writeFileSync(fp, buf.subarray(Math.max(0, buf.length - Math.floor(MAX_FILE_BYTES / 2))));
    }
  } catch {
    // ignore trim errors
  }
  return { path: path.join('.local', 'session-log', `${sessionId}.jsonl`) };
}
