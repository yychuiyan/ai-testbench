/**
 * session-checkpoint-policy：读取 / 恢复本机检查点。
 */

const API = '/__tb_sessions/checkpoints';

export interface SessionCheckpointMeta {
  sessionId: string;
  title: string;
  at: string;
  messageCount: number;
  bytes?: number;
}

export interface SessionCheckpoint extends SessionCheckpointMeta {
  messages?: unknown[];
  goal?: unknown;
  todos?: unknown;
  path?: string;
}

export async function fetchCheckpoint(sessionId: string): Promise<SessionCheckpoint | null> {
  const id = String(sessionId ?? '').trim();
  if (!id) return null;
  try {
    const res = await fetch(`${API}/${encodeURIComponent(id)}`, {
      signal: AbortSignal.timeout(8000),
    });
    const data = (await res.json().catch(() => null)) as {
      ok?: boolean;
      checkpoint?: SessionCheckpoint;
    } | null;
    if (!res.ok || !data?.checkpoint) return null;
    return data.checkpoint;
  } catch {
    return null;
  }
}

export async function fetchCheckpointList(): Promise<SessionCheckpointMeta[]> {
  try {
    const res = await fetch(API, { signal: AbortSignal.timeout(8000) });
    const data = (await res.json().catch(() => null)) as {
      ok?: boolean;
      checkpoints?: SessionCheckpointMeta[];
    } | null;
    if (!res.ok || !Array.isArray(data?.checkpoints)) return [];
    return data.checkpoints;
  } catch {
    return [];
  }
}
