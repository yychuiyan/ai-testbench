/**
 * 主机级定时提醒：
 * - 落盘 `.tb/local/schedules.json`
 * - 本地服务运行时 tick：到期写入 `.tb/local/sessions.json` 对应会话
 * - HTTP：`/__tb_schedule/*`
 */
import fs from 'node:fs';
import path from 'node:path';

import { getDataRoot } from './space-context.mjs';
import { LOCAL_REL } from './space-layout.mjs';

const PREFIX = '/__tb_schedule';
const TICK_MS = 15_000;
const MAX_REMINDERS = 200;

function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function schedulesPath(root) {
  return path.join(root, LOCAL_REL, 'schedules.json');
}

function sessionsPath(root) {
  return path.join(root, LOCAL_REL, 'sessions.json');
}

function readJson(fp, fallback) {
  try {
    if (!fs.existsSync(fp)) return fallback;
    return JSON.parse(fs.readFileSync(fp, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(fp, data) {
  fs.mkdirSync(path.dirname(fp), { recursive: true });
  fs.writeFileSync(fp, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

function uid() {
  return `sch_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

/** @param {unknown} raw */
export function normalizeReminder(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const o = /** @type {Record<string, unknown>} */ (raw);
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

export function loadReminderStore(root) {
  const data = readJson(schedulesPath(root), { reminders: [] });
  const list = Array.isArray(data?.reminders) ? data.reminders : [];
  return list.map(normalizeReminder).filter(Boolean);
}

export function saveReminderStore(root, list) {
  writeJson(schedulesPath(root), { reminders: list.slice(-MAX_REMINDERS) });
}

function resolveDueAt(args) {
  if (typeof args.delayMinutes === 'number' && Number.isFinite(args.delayMinutes)) {
    const m = Math.max(0.1, args.delayMinutes);
    return Date.now() + Math.round(m * 60_000);
  }
  const iso = String(args.dueAt ?? '').trim();
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
}

export function createHostReminder(root, sessionId, args) {
  const text = String(args.text ?? '').trim();
  if (!text) return { ok: false, error: 'text is required' };
  if (!sessionId) return { ok: false, error: 'no active session' };
  const dueAt = resolveDueAt(args);
  if (dueAt == null) return { ok: false, error: 'dueAt or delayMinutes is required' };
  if (dueAt < Date.now() - 5_000) return { ok: false, error: 'dueAt is in the past' };
  const now = Date.now();
  const reminder = {
    id: uid(),
    sessionId,
    text: text.slice(0, 500),
    dueAt,
    status: 'scheduled',
    createdAt: now,
    updatedAt: now,
  };
  const list = loadReminderStore(root);
  list.push(reminder);
  saveReminderStore(root, list);
  return { ok: true, reminder };
}

export function listHostReminders(root, sessionId, includeDelivered = false) {
  return loadReminderStore(root)
    .filter((s) => s.sessionId === sessionId)
    .filter((s) => includeDelivered || s.status === 'scheduled')
    .sort((a, b) => a.dueAt - b.dueAt);
}

export function updateHostReminder(root, sessionId, args) {
  const id = String(args.id ?? '').trim();
  if (!id) return { ok: false, error: 'id is required' };
  const list = loadReminderStore(root);
  const idx = list.findIndex((s) => s.id === id && s.sessionId === sessionId);
  if (idx < 0) return { ok: false, error: 'reminder not found' };
  const cur = list[idx];
  if (cur.status !== 'scheduled') return { ok: false, error: `cannot update status=${cur.status}` };
  let dueAt = cur.dueAt;
  if (args.dueAt != null || args.delayMinutes != null) {
    const next = resolveDueAt(args);
    if (next == null) return { ok: false, error: 'invalid dueAt / delayMinutes' };
    dueAt = next;
  }
  const text = args.text != null ? String(args.text).trim() : cur.text;
  if (!text) return { ok: false, error: 'text cannot be empty' };
  const reminder = { ...cur, text: text.slice(0, 500), dueAt, updatedAt: Date.now() };
  list[idx] = reminder;
  saveReminderStore(root, list);
  return { ok: true, reminder };
}

export function cancelHostReminder(root, sessionId, idRaw) {
  const id = String(idRaw ?? '').trim();
  if (!id) return { ok: false, error: 'id is required' };
  const list = loadReminderStore(root);
  const idx = list.findIndex((s) => s.id === id && s.sessionId === sessionId);
  if (idx < 0) return { ok: false, error: 'reminder not found' };
  const reminder = { ...list[idx], status: 'cancelled', updatedAt: Date.now() };
  list[idx] = reminder;
  saveReminderStore(root, list);
  return { ok: true, reminder };
}

export function reminderMessageContent(text, scheduleId) {
  return `⏰ 定时提醒：${text}\n<!--tb-schedule:${scheduleId}-->`;
}

export function sessionHasScheduleMessage(messages, scheduleId) {
  const marker = `<!--tb-schedule:${scheduleId}-->`;
  if (!Array.isArray(messages)) return false;
  return messages.some((m) => typeof m?.content === 'string' && m.content.includes(marker));
}

/** 将到期提醒写入 sessions.json，并标记 delivered；返回本次投递列表 */
export function claimAndDeliverDue(root, now = Date.now()) {
  const list = loadReminderStore(root);
  const due = [];
  let changed = false;
  for (let i = 0; i < list.length; i++) {
    const s = list[i];
    if (s.status === 'scheduled' && s.dueAt <= now) {
      const next = { ...s, status: 'delivered', updatedAt: now };
      list[i] = next;
      due.push(next);
      changed = true;
    }
  }
  if (!changed) return [];

  const store = readJson(sessionsPath(root), null);
  if (store && Array.isArray(store.sessions)) {
    let sessChanged = false;
    for (const r of due) {
      const sid = r.sessionId;
      const idx = store.sessions.findIndex((s) => s && s.id === sid);
      if (idx < 0) continue;
      const sess = store.sessions[idx];
      const messages = Array.isArray(sess.messages) ? [...sess.messages] : [];
      if (sessionHasScheduleMessage(messages, r.id)) continue;
      messages.push({
        role: 'assistant',
        content: reminderMessageContent(r.text, r.id),
        time: now,
        scheduleId: r.id,
      });
      store.sessions[idx] = { ...sess, messages, updatedAt: now };
      sessChanged = true;
    }
    if (sessChanged) {
      writeJson(sessionsPath(root), {
        sessions: store.sessions,
        activeId: store.activeId ?? store.sessions[0]?.id ?? '',
      });
    }
  }

  saveReminderStore(root, list);
  return due;
}

/**
 * @returns {import('vite').Plugin}
 */
export function tbSchedulePlugin() {
  /** @type {ReturnType<typeof setInterval> | null} */
  let timer = null;

  return {
    name: 'tb-schedule',
    configureServer(server) {
      const tick = () => {
        try {
          // 数据根惰性读取：切换数据空间后，定时扫描跟着切到新空间
          claimAndDeliverDue(getDataRoot());
        } catch {
          // ignore tick errors
        }
      };
      if (timer) clearInterval(timer);
      timer = setInterval(tick, TICK_MS);
      // 定时器只做后勤工作，不应阻止进程退出（否则测试 / 嵌入式调用会被永久挂住）
      timer.unref?.();
      // 启动后稍晚扫一次
      setTimeout(tick, 2_000).unref?.();

      server.middlewares.use(async (req, res, next) => {
        const url = req.url?.split('?')[0] ?? '';
        if (!url.startsWith(PREFIX)) return next();
        // 数据根惰性读取：切换数据空间后无需重启即可生效
        const root = getDataRoot();

        try {
          if (url === `${PREFIX}/health` && req.method === 'GET') {
            return sendJson(res, 200, { ok: true, mode: 'host', tickMs: TICK_MS });
          }

          if (url === `${PREFIX}/list` && req.method === 'GET') {
            const q = new URL(req.url || '', 'http://local');
            const sessionId = String(q.searchParams.get('sessionId') || '').trim();
            const includeDelivered = q.searchParams.get('includeDelivered') === '1';
            if (!sessionId) return sendJson(res, 400, { error: 'sessionId required' });
            const reminders = listHostReminders(root, sessionId, includeDelivered);
            return sendJson(res, 200, { ok: true, count: reminders.length, reminders });
          }

          if (url === `${PREFIX}/create` && req.method === 'POST') {
            const body = JSON.parse((await readBody(req)) || '{}');
            const sessionId = String(body.sessionId ?? '').trim();
            return sendJson(res, 200, createHostReminder(root, sessionId, body));
          }

          if (url === `${PREFIX}/update` && req.method === 'POST') {
            const body = JSON.parse((await readBody(req)) || '{}');
            const sessionId = String(body.sessionId ?? '').trim();
            return sendJson(res, 200, updateHostReminder(root, sessionId, body));
          }

          if (url === `${PREFIX}/cancel` && req.method === 'POST') {
            const body = JSON.parse((await readBody(req)) || '{}');
            const sessionId = String(body.sessionId ?? '').trim();
            return sendJson(res, 200, cancelHostReminder(root, sessionId, body.id));
          }

          if (url === `${PREFIX}/claim` && req.method === 'POST') {
            const due = claimAndDeliverDue(root);
            return sendJson(res, 200, { ok: true, count: due.length, reminders: due });
          }

          return sendJson(res, 404, { error: 'not found' });
        } catch (e) {
          return sendJson(res, 500, { error: e instanceof Error ? e.message : String(e) });
        }
      });
    },
  };
}
