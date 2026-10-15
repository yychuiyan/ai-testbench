/**
 * 会话定时提醒（tool-schedule）：
 * - 优先主机 `/__tb_schedule`（落盘 + 服务 tick 投递会话）
 * - 无本地服务时回退 localStorage（仅页面打开时投递）
 */

const STORE_KEY = 'tw-session-schedules';
const API = '/__tb_schedule';

export type ScheduleStatus = 'scheduled' | 'delivered' | 'cancelled';

export interface ScheduledReminder {
  id: string;
  sessionId: string;
  text: string;
  dueAt: number;
  status: ScheduleStatus;
  createdAt: number;
  updatedAt: number;
}

export const SCHEDULE_SYSTEM_HINT =
  '你可以使用定时提醒工具：\n' +
  '- schedule_create：创建提醒（text + dueAt ISO 或 delayMinutes）\n' +
  '- schedule_list：列出本会话未取消的提醒\n' +
  '- schedule_update：修改 text / dueAt\n' +
  '- schedule_cancel：取消提醒\n' +
  '本地服务在线时提醒落盘并由主机到点写入原会话；否则仅页面打开时投递。';

export const SCHEDULE_TOOLS = [
  {
    type: 'function' as const,
    function: {
      name: 'schedule_create',
      description:
        'Create a session reminder. Provide dueAt (ISO datetime) or delayMinutes from now.',
      parameters: {
        type: 'object',
        properties: {
          text: { type: 'string', description: 'Reminder content' },
          dueAt: { type: 'string', description: 'ISO 8601 datetime' },
          delayMinutes: {
            type: 'number',
            description: 'Minutes from now (alternative to dueAt)',
          },
        },
        required: ['text'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'schedule_list',
      description: 'List scheduled reminders for the current session.',
      parameters: {
        type: 'object',
        properties: {
          includeDelivered: { type: 'boolean' },
        },
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'schedule_update',
      description: 'Update a scheduled reminder text and/or dueAt.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          text: { type: 'string' },
          dueAt: { type: 'string' },
          delayMinutes: { type: 'number' },
        },
        required: ['id'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'schedule_cancel',
      description: 'Cancel a scheduled reminder.',
      parameters: {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
      },
    },
  },
];

function uid(): string {
  return `sch_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

let hostAvailable: boolean | null = null;

export async function probeScheduleHost(): Promise<boolean> {
  try {
    const res = await fetch(`${API}/health`, { signal: AbortSignal.timeout(1500) });
    if (!res.ok) {
      hostAvailable = false;
      return false;
    }
    const data = (await res.json()) as { ok?: boolean };
    hostAvailable = Boolean(data.ok);
    return hostAvailable;
  } catch {
    hostAvailable = false;
    return false;
  }
}

export function isScheduleHostCached(): boolean | null {
  return hostAvailable;
}

export function loadSchedules(): ScheduledReminder[] {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((x) => normalizeReminder(x))
      .filter((x): x is ScheduledReminder => Boolean(x));
  } catch {
    return [];
  }
}

export function saveSchedules(list: ScheduledReminder[]): void {
  localStorage.setItem(STORE_KEY, JSON.stringify(list.slice(-200)));
}

function normalizeReminder(raw: unknown): ScheduledReminder | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const id = String(o.id ?? '').trim();
  const sessionId = String(o.sessionId ?? '').trim();
  const text = String(o.text ?? '').trim();
  const dueAt = Number(o.dueAt);
  if (!id || !sessionId || !text || !Number.isFinite(dueAt)) return null;
  const status =
    o.status === 'delivered' || o.status === 'cancelled' || o.status === 'scheduled'
      ? o.status
      : 'scheduled';
  return {
    id,
    sessionId,
    text: text.slice(0, 500),
    dueAt,
    status,
    createdAt: Number(o.createdAt) || Date.now(),
    updatedAt: Number(o.updatedAt) || Date.now(),
  };
}

function resolveDueAt(args: { dueAt?: unknown; delayMinutes?: unknown }): number | null {
  if (typeof args.delayMinutes === 'number' && Number.isFinite(args.delayMinutes)) {
    const m = Math.max(0.1, args.delayMinutes);
    return Date.now() + Math.round(m * 60_000);
  }
  const iso = String(args.dueAt ?? '').trim();
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
}

export function listSchedulesForSession(
  sessionId: string,
  includeDelivered = false,
): ScheduledReminder[] {
  return loadSchedules()
    .filter((s) => s.sessionId === sessionId)
    .filter((s) => includeDelivered || s.status === 'scheduled')
    .sort((a, b) => a.dueAt - b.dueAt);
}

export function createSchedule(
  sessionId: string,
  args: { text?: unknown; dueAt?: unknown; delayMinutes?: unknown },
): { ok: true; reminder: ScheduledReminder } | { ok: false; error: string } {
  const text = String(args.text ?? '').trim();
  if (!text) return { ok: false, error: 'text is required' };
  if (!sessionId) return { ok: false, error: 'no active session' };
  const dueAt = resolveDueAt(args);
  if (dueAt == null) return { ok: false, error: 'dueAt or delayMinutes is required' };
  if (dueAt < Date.now() - 5_000) return { ok: false, error: 'dueAt is in the past' };
  const now = Date.now();
  const reminder: ScheduledReminder = {
    id: uid(),
    sessionId,
    text: text.slice(0, 500),
    dueAt,
    status: 'scheduled',
    createdAt: now,
    updatedAt: now,
  };
  const list = loadSchedules();
  list.push(reminder);
  saveSchedules(list);
  return { ok: true, reminder };
}

export function updateSchedule(
  sessionId: string,
  args: { id?: unknown; text?: unknown; dueAt?: unknown; delayMinutes?: unknown },
): { ok: true; reminder: ScheduledReminder } | { ok: false; error: string } {
  const id = String(args.id ?? '').trim();
  if (!id) return { ok: false, error: 'id is required' };
  const list = loadSchedules();
  const idx = list.findIndex((s) => s.id === id && s.sessionId === sessionId);
  if (idx < 0) return { ok: false, error: 'reminder not found' };
  const cur = list[idx]!;
  if (cur.status !== 'scheduled') return { ok: false, error: `cannot update status=${cur.status}` };
  let dueAt = cur.dueAt;
  if (args.dueAt != null || args.delayMinutes != null) {
    const next = resolveDueAt(args);
    if (next == null) return { ok: false, error: 'invalid dueAt / delayMinutes' };
    dueAt = next;
  }
  const text = args.text != null ? String(args.text).trim() : cur.text;
  if (!text) return { ok: false, error: 'text cannot be empty' };
  const reminder: ScheduledReminder = {
    ...cur,
    text: text.slice(0, 500),
    dueAt,
    updatedAt: Date.now(),
  };
  list[idx] = reminder;
  saveSchedules(list);
  return { ok: true, reminder };
}

export function cancelSchedule(
  sessionId: string,
  idRaw: unknown,
): { ok: true; reminder: ScheduledReminder } | { ok: false; error: string } {
  const id = String(idRaw ?? '').trim();
  if (!id) return { ok: false, error: 'id is required' };
  const list = loadSchedules();
  const idx = list.findIndex((s) => s.id === id && s.sessionId === sessionId);
  if (idx < 0) return { ok: false, error: 'reminder not found' };
  const reminder: ScheduledReminder = {
    ...list[idx]!,
    status: 'cancelled',
    updatedAt: Date.now(),
  };
  list[idx] = reminder;
  saveSchedules(list);
  return { ok: true, reminder };
}

/** 取出所有已到期且仍 scheduled 的提醒，并标记 delivered（localStorage） */
export function claimDueSchedules(now = Date.now()): ScheduledReminder[] {
  const list = loadSchedules();
  const due: ScheduledReminder[] = [];
  let changed = false;
  for (let i = 0; i < list.length; i++) {
    const s = list[i]!;
    if (s.status === 'scheduled' && s.dueAt <= now) {
      const next = { ...s, status: 'delivered' as const, updatedAt: now };
      list[i] = next;
      due.push(next);
      changed = true;
    }
  }
  if (changed) saveSchedules(list);
  return due;
}

export function formatReminderShort(r: ScheduledReminder): string {
  const when = new Date(r.dueAt).toLocaleString();
  return `${r.id} · ${r.status} · ${when} · ${r.text}`;
}

export function reminderMessageContent(text: string, scheduleId: string): string {
  return `⏰ 定时提醒：${text}\n<!--tb-schedule:${scheduleId}-->`;
}

async function hostPost(
  path: string,
  body: Record<string, unknown>,
): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetch(`${API}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return null;
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** 优先主机 claim（会写入 sessions.json）；失败则 localStorage */
export async function claimDueSchedulesAsync(): Promise<ScheduledReminder[]> {
  if (hostAvailable !== false) {
    const data = await hostPost('/claim', {});
    if (data && data.ok) {
      hostAvailable = true;
      const list = Array.isArray(data.reminders)
        ? data.reminders.map(normalizeReminder).filter((x): x is ScheduledReminder => Boolean(x))
        : [];
      return list;
    }
    if (hostAvailable === true) {
      // 曾可用但本次失败：仍尝试本地补投
      return claimDueSchedules();
    }
    await probeScheduleHost();
    if (hostAvailable) {
      const retry = await hostPost('/claim', {});
      if (retry && retry.ok && Array.isArray(retry.reminders)) {
        return retry.reminders
          .map(normalizeReminder)
          .filter((x): x is ScheduledReminder => Boolean(x));
      }
    }
  }
  return claimDueSchedules();
}

export async function runScheduleTool(
  name: string,
  argsJson: string,
  sessionId: string,
): Promise<string> {
  let args: Record<string, unknown> = {};
  try {
    args = JSON.parse(argsJson || '{}') as Record<string, unknown>;
  } catch {
    return JSON.stringify({ error: 'invalid JSON arguments' });
  }

  const useHost = hostAvailable ?? (await probeScheduleHost());

  if (useHost) {
    if (name === 'schedule_create') {
      const data = await hostPost('/create', { ...args, sessionId });
      if (data) return JSON.stringify(data, null, 2);
    } else if (name === 'schedule_list') {
      try {
        const q = new URLSearchParams({
          sessionId,
          includeDelivered: args.includeDelivered ? '1' : '0',
        });
        const res = await fetch(`${API}/list?${q}`, { signal: AbortSignal.timeout(5000) });
        if (res.ok) return JSON.stringify(await res.json(), null, 2);
      } catch {
        // fall through
      }
    } else if (name === 'schedule_update') {
      const data = await hostPost('/update', { ...args, sessionId });
      if (data) return JSON.stringify(data, null, 2);
    } else if (name === 'schedule_cancel') {
      const data = await hostPost('/cancel', { id: args.id, sessionId });
      if (data) return JSON.stringify(data, null, 2);
    } else {
      return JSON.stringify({ error: `unknown tool: ${name}` });
    }
    // host 失败则回退本地
    hostAvailable = false;
  }

  if (name === 'schedule_create') {
    return JSON.stringify(createSchedule(sessionId, args), null, 2);
  }
  if (name === 'schedule_list') {
    const list = listSchedulesForSession(sessionId, Boolean(args.includeDelivered));
    return JSON.stringify({ ok: true, count: list.length, reminders: list }, null, 2);
  }
  if (name === 'schedule_update') {
    return JSON.stringify(updateSchedule(sessionId, args), null, 2);
  }
  if (name === 'schedule_cancel') {
    return JSON.stringify(cancelSchedule(sessionId, args.id), null, 2);
  }
  return JSON.stringify({ error: `unknown tool: ${name}` });
}
