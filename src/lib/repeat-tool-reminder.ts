/**
 * 重复工具调用提醒（对齐 dsh-repeat-tool-reminder 子集）：
 * 同一轮 tools loop 内，连续相同 name+arguments 达到阈值时，
 * 在工具结果末尾追加提醒，促使模型换路或向用户说明。
 */

export interface RepeatToolReminderOptions {
  /** 连续相同调用达到该次数时开始附加提醒（含当次），默认 3 */
  threshold?: number;
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((v) => stableStringify(v)).join(',')}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`;
}

function normalizeArgs(argsJson: string): string {
  const raw = String(argsJson ?? '').trim() || '{}';
  try {
    return stableStringify(JSON.parse(raw));
  } catch {
    return raw;
  }
}

export function callKey(name: string, argsJson: string): string {
  return `${String(name ?? '').trim()}\0${normalizeArgs(argsJson)}`;
}

export function buildRepeatReminder(name: string, streak: number): string {
  const n = String(name || 'tool');
  return (
    `\n\n[repeat-tool-reminder] Tool \`${n}\` was called ${streak} times with the same arguments. ` +
    'Stop repeating; change approach, adjust arguments, or explain the blocker to the user.'
  );
}

/** 跨单次 streamChatWithTools 调用的连续重复计数器 */
export class RepeatToolTracker {
  private lastKey = '';
  private streak = 0;
  private readonly threshold: number;

  constructor(opts: RepeatToolReminderOptions = {}) {
    this.threshold = Math.max(2, Math.floor(opts.threshold ?? 3));
  }

  reset(): void {
    this.lastKey = '';
    this.streak = 0;
  }

  /**
   * 记录一次工具调用；若达到阈值返回应追加到 tool result 的提醒文案，否则 null。
   */
  note(name: string, argsJson: string): string | null {
    const key = callKey(name, argsJson);
    if (key === this.lastKey) {
      this.streak += 1;
    } else {
      this.lastKey = key;
      this.streak = 1;
    }
    if (this.streak >= this.threshold) {
      return buildRepeatReminder(name, this.streak);
    }
    return null;
  }
}

/** 将提醒追加到工具结果（若有） */
export function appendRepeatReminder(result: string, reminder: string | null): string {
  if (!reminder) return String(result ?? '');
  return `${String(result ?? '')}${reminder}`;
}
