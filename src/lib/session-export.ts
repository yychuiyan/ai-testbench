/**
 * 会话日志导出（session-log-download）：浏览器侧下载 JSON / JSONL。
 */
import type { ChatSession } from './sessions';

export type SessionExportFormat = 'json' | 'jsonl';

function safeFilenamePart(s: string): string {
  return (
    s
      .trim()
      .replace(/[\\/:*?"<>|]+/g, '_')
      .replace(/\s+/g, ' ')
      .slice(0, 48) || 'session'
  );
}

/** 导出用精简消息行（去掉过大的 dataUrl 等） */
export function exportableMessage(m: unknown): Record<string, unknown> {
  if (!m || typeof m !== 'object') return { raw: m };
  const o = m as Record<string, unknown>;
  const out: Record<string, unknown> = {
    role: o.role,
    content: typeof o.content === 'string' ? o.content : o.content,
  };
  if (typeof o.reasoning === 'string' && o.reasoning) out.reasoning = o.reasoning;
  if (typeof o.time === 'number') out.time = o.time;
  if (typeof o.model === 'string') out.model = o.model;
  if (o.usage && typeof o.usage === 'object') out.usage = o.usage;
  if (typeof o.scheduleId === 'string') out.scheduleId = o.scheduleId;
  if (Array.isArray(o.attachments)) {
    out.attachments = o.attachments.map((a) => {
      if (!a || typeof a !== 'object') return a;
      const att = a as Record<string, unknown>;
      return { name: att.name, size: att.size, type: att.type };
    });
  }
  if (Array.isArray(o.images)) {
    out.images = o.images.map((img) => {
      if (!img || typeof img !== 'object') return img;
      const im = img as Record<string, unknown>;
      return { id: im.id, name: im.name, /* 省略 dataUrl */ omittedDataUrl: true };
    });
  }
  if (Array.isArray(o.refs)) out.refs = o.refs;
  return out;
}

export const SESSION_EXPORT_FORMAT = 'lantern-harness-session-v1';

export function buildSessionExportObject(session: ChatSession) {
  return {
    exportedAt: new Date().toISOString(),
    format: SESSION_EXPORT_FORMAT,
    session: {
      id: session.id,
      title: session.title,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      archived: session.archived,
      pinned: session.pinned,
      workspacePath: session.workspacePath,
      goal: session.goal,
      todos: session.todos,
      messages: (session.messages ?? []).map(exportableMessage),
    },
  };
}

export function sessionToJson(session: ChatSession): string {
  return `${JSON.stringify(buildSessionExportObject(session), null, 2)}\n`;
}

/** 每行一条：meta + 各消息 */
export function sessionToJsonl(session: ChatSession): string {
  const lines: string[] = [];
  lines.push(
    JSON.stringify({
      type: 'session',
      exportedAt: new Date().toISOString(),
      id: session.id,
      title: session.title,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      workspacePath: session.workspacePath,
      goal: session.goal,
    }),
  );
  for (const m of session.messages ?? []) {
    lines.push(JSON.stringify({ type: 'message', sessionId: session.id, ...exportableMessage(m) }));
  }
  return `${lines.join('\n')}\n`;
}

export function downloadTextFile(filename: string, text: string, mime: string): void {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function exportSessionDownload(
  session: ChatSession,
  format: SessionExportFormat = 'json',
): { ok: true; filename: string } | { ok: false; error: string } {
  if (typeof document === 'undefined') {
    return { ok: false, error: 'download requires browser' };
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const base = `session-${safeFilenamePart(session.title)}-${stamp}`;
  if (format === 'jsonl') {
    const filename = `${base}.jsonl`;
    downloadTextFile(filename, sessionToJsonl(session), 'application/x-ndjson;charset=utf-8');
    return { ok: true, filename };
  }
  const filename = `${base}.json`;
  downloadTextFile(filename, sessionToJson(session), 'application/json;charset=utf-8');
  return { ok: true, filename };
}
