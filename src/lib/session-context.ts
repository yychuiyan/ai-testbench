/**
 * 会话注入上下文：time-context（对齐 dsh-time-context 语义的精简版）。
 */

export const TIME_CONTEXT_INTERVAL_MS = 600_000; // 10 分钟

function formatElapsed(ms: number | null): string {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return 'unavailable';
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  const rem = sec % 60;
  if (min < 60) return rem ? `${min}m${rem}s` : `${min}m`;
  const hr = Math.floor(min / 60);
  const m2 = min % 60;
  return m2 ? `${hr}h${m2}m` : `${hr}h`;
}

function resolveTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'unavailable';
  } catch {
    return 'unavailable';
  }
}

function formatTimestamp(d: Date, timeZone: string): string {
  try {
    const fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
      timeZoneName: 'shortOffset',
    });
    return `${fmt.format(d).replace(',', '')} (${timeZone})`;
  } catch {
    return d.toISOString();
  }
}

export interface TimeContextInput {
  /** 上一轮用户可见消息时间戳（ms） */
  lastUserMessageAt?: number | null;
  /** 上次注入时间（ms）；用于节流 */
  lastInjectAt?: number | null;
  now?: number;
}

export interface TimeContextResult {
  text: string;
  /** 是否计入新的节流锚点（完整采样） */
  injected: boolean;
  at: number;
}

/**
 * 生成 time-context 段落。间隔不足 10 分钟时返回简短「沿用」说明，仍可拼入 system。
 */
export function formatTimeContext(input: TimeContextInput = {}): TimeContextResult {
  const now = input.now ?? Date.now();
  const tz = resolveTimeZone();
  const lastInject = input.lastInjectAt ?? null;
  const due =
    lastInject == null ||
    !Number.isFinite(lastInject) ||
    now - lastInject >= TIME_CONTEXT_INTERVAL_MS;

  if (!due && lastInject != null) {
    return {
      text:
        `【时间上下文 time-context】沿用上次采样（节流 ${TIME_CONTEXT_INTERVAL_MS / 60000} 分钟）。` +
        `浏览器时区：${tz}。解释未标注时区的日期时间时请使用该时区；若不确定请向用户确认。`,
      injected: false,
      at: lastInject,
    };
  }

  const elapsed =
    input.lastUserMessageAt != null && Number.isFinite(input.lastUserMessageAt)
      ? now - input.lastUserMessageAt
      : null;

  const text = [
    '【时间上下文 time-context】',
    `当前时间：${formatTimestamp(new Date(now), tz)}`,
    `浏览器时区：${tz}`,
    `距上一轮用户消息：${formatElapsed(elapsed)}`,
    '解释未标注时区的日期时间时请使用上述时区；若时区信息混杂或缺失，请向用户确认。',
  ].join('\n');

  return { text, injected: true, at: now };
}
