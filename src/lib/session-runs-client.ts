/**
 * 服务端会话回合客户端：启动 / 停止 / 列表 / SSE 订阅。
 */
const API = '/__tb_sessions/runs';

export type RunStatus = 'running' | 'waiting_user' | 'completed' | 'stopped' | 'error';

export interface ServerRunSummary {
  sessionId: string;
  status: RunStatus;
  startedAt: number;
  seq: number;
}

export interface ServerRunEvent {
  type: 'reasoning' | 'content' | 'tool' | 'usage' | 'status';
  seq?: number;
  delta?: string;
  name?: string;
  status?: string;
  args?: string;
  result?: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  error?: string;
  assistant?: {
    content?: string;
    reasoning?: string;
    reasoningApi?: string;
    activitySteps?: unknown[];
    turnStatus?: string;
    usage?: unknown;
    model?: string;
    llmMs?: number;
    ttftMs?: number;
    toolMs?: number;
    tps?: number;
  };
}

export async function sessionRunsAvailable(signal?: AbortSignal): Promise<boolean> {
  try {
    const res = await fetch(API, { signal: signal ?? AbortSignal.timeout(1500) });
    return res.ok;
  } catch {
    return false;
  }
}

export async function listSessionRuns(signal?: AbortSignal): Promise<ServerRunSummary[]> {
  const res = await fetch(API, { signal: signal ?? AbortSignal.timeout(3000) });
  if (!res.ok) return [];
  const data = (await res.json()) as { runs?: ServerRunSummary[] };
  return Array.isArray(data.runs) ? data.runs : [];
}

export async function startSessionRun(body: {
  sessionId: string;
  messages: unknown[];
  settings: { baseURL: string; apiKey: string; model: string; reasoningEffort?: string };
  tools?: unknown[];
  thinking?: boolean;
  workspace?: string;
  access?: string;
  maxToolRounds?: number;
}): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch(API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
  if (!res.ok) return { ok: false, error: data.error || `HTTP ${res.status}` };
  return { ok: true };
}

export async function stopSessionRun(sessionId: string): Promise<void> {
  await fetch(`${API}/${encodeURIComponent(sessionId)}/stop`, { method: 'POST' }).catch(() => {});
}

export async function getSessionRun(sessionId: string): Promise<{
  ok: boolean;
  status?: RunStatus;
  seq?: number;
  assistant?: ServerRunEvent['assistant'];
} | null> {
  try {
    const res = await fetch(`${API}/${encodeURIComponent(sessionId)}`, {
      signal: AbortSignal.timeout(3000),
    });
    if (res.status === 404) return { ok: false };
    if (!res.ok) return null;
    return (await res.json()) as {
      ok: boolean;
      status?: RunStatus;
      seq?: number;
      assistant?: ServerRunEvent['assistant'];
    };
  } catch {
    return null;
  }
}

function isTerminalStatus(status: string | undefined): boolean {
  return status === 'completed' || status === 'stopped' || status === 'error';
}

/**
 * 订阅 SSE；返回取消函数。
 * 流异常结束（非主动 abort）会走 onError，供上层重连。
 */
export function subscribeSessionRun(
  sessionId: string,
  afterSeq: number,
  onEvent: (ev: ServerRunEvent) => void,
  onError?: (err: Error) => void,
): () => void {
  const ctrl = new AbortController();
  const url = `${API}/${encodeURIComponent(sessionId)}/events?after=${Math.max(0, afterSeq)}`;
  void (async () => {
    try {
      const res = await fetch(url, {
        headers: { Accept: 'text/event-stream' },
        signal: ctrl.signal,
      });
      if (!res.ok || !res.body) {
        onError?.(new Error(`SSE ${res.status}`));
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) {
          // 服务端仍在跑时连接被掐断：通知上层重连，勿当成正常结束
          if (!ctrl.signal.aborted) onError?.(new Error('SSE disconnected'));
          break;
        }
        buf += decoder.decode(value, { stream: true });
        const parts = buf.split('\n');
        buf = parts.pop() ?? '';
        for (const line of parts) {
          const t = line.trim();
          if (!t.startsWith('data:')) continue;
          const raw = t.slice(5).trim();
          if (!raw) continue;
          try {
            onEvent(JSON.parse(raw) as ServerRunEvent);
          } catch {
            // ignore
          }
        }
      }
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return;
      onError?.(e instanceof Error ? e : new Error(String(e)));
    }
  })();
  return () => ctrl.abort();
}

/**
 * 带断线重连的 SSE 监视：仅在终态 / 主动取消 / 重试耗尽时结束。
 */
export function watchSessionRun(
  sessionId: string,
  afterSeq: number,
  handlers: {
    onEvent: (ev: ServerRunEvent) => void;
    onTerminal?: (ev: ServerRunEvent) => void;
    onGaveUp?: (err: Error) => void;
    signal?: AbortSignal;
    maxAttempts?: number;
  },
): () => void {
  let stopped = false;
  let seq = Math.max(0, afterSeq);
  let attempt = 0;
  let currentUnsub: (() => void) | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const maxAttempts = handlers.maxAttempts ?? 10;

  const stop = () => {
    stopped = true;
    if (timer != null) clearTimeout(timer);
    timer = undefined;
    currentUnsub?.();
    currentUnsub = null;
  };

  const connect = () => {
    if (stopped || handlers.signal?.aborted) return;
    currentUnsub?.();
    currentUnsub = subscribeSessionRun(
      sessionId,
      seq,
      (ev) => {
        if (typeof ev.seq === 'number' && Number.isFinite(ev.seq)) {
          seq = Math.max(seq, ev.seq);
        }
        handlers.onEvent(ev);
        if (ev.type === 'status' && isTerminalStatus(ev.status)) {
          handlers.onTerminal?.(ev);
          stop();
        }
      },
      (err) => {
        if (stopped || handlers.signal?.aborted) return;
        void (async () => {
          attempt += 1;
          try {
            const snap = await getSessionRun(sessionId);
            if (snap?.ok && typeof snap.seq === 'number') {
              seq = Math.max(seq, snap.seq);
            }
            if (snap?.ok && isTerminalStatus(snap.status)) {
              const terminalEv: ServerRunEvent = {
                type: 'status',
                status: snap.status,
                seq: snap.seq,
                assistant: snap.assistant,
              };
              handlers.onEvent(terminalEv);
              handlers.onTerminal?.(terminalEv);
              stop();
              return;
            }
            if (snap && snap.ok === false) {
              handlers.onGaveUp?.(new Error(err.message || 'run not found'));
              stop();
              return;
            }
          } catch {
            // 快照失败也继续重连
          }
          if (attempt >= maxAttempts) {
            handlers.onGaveUp?.(err);
            stop();
            return;
          }
          const delay = Math.min(4000, 250 * attempt);
          timer = setTimeout(connect, delay);
        })();
      },
    );
  };

  const onAbort = () => stop();
  handlers.signal?.addEventListener('abort', onAbort);
  connect();
  return () => {
    handlers.signal?.removeEventListener('abort', onAbort);
    stop();
  };
}
