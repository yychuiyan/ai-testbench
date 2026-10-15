/**
 * session-log-deepseek：回合结束后把 user/assistant（含 reasoning）追加到本机 JSONL。
 */

const API = '/__tb_sessions/log';

export interface DeepseekLogMessage {
  role: string;
  content: string;
  reasoning_content?: string;
}

export function buildDeepseekTurnMessages(opts: {
  userContent: string;
  assistantContent: string;
  reasoning?: string;
}): DeepseekLogMessage[] {
  const user = String(opts.userContent ?? '').trim();
  const assistant = String(opts.assistantContent ?? '').trim();
  const reasoning = String(opts.reasoning ?? '').trim();
  const msgs: DeepseekLogMessage[] = [];
  if (user) msgs.push({ role: 'user', content: user });
  if (assistant || reasoning) {
    const a: DeepseekLogMessage = { role: 'assistant', content: assistant };
    if (reasoning) a.reasoning_content = reasoning;
    msgs.push(a);
  }
  return msgs;
}

export async function appendDeepseekSessionLogClient(body: {
  sessionId: string;
  model?: string;
  messages: DeepseekLogMessage[];
}): Promise<{ ok: boolean; path?: string; error?: string }> {
  try {
    const res = await fetch(API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(5000),
    });
    const data = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      path?: string;
      error?: string;
    };
    if (!res.ok) {
      return { ok: false, error: data.error || `HTTP ${res.status}` };
    }
    return { ok: true, path: data.path };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
