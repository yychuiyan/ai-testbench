import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import {
  cancelSchedule,
  claimDueSchedules,
  createSchedule,
  listSchedulesForSession,
  loadSchedules,
  saveSchedules,
  updateSchedule,
} from './session-schedule';

const mem = new Map<string, string>();

beforeEach(() => {
  mem.clear();
  (globalThis as { localStorage?: Storage }).localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => {
      mem.set(k, v);
    },
    removeItem: (k: string) => {
      mem.delete(k);
    },
    clear: () => mem.clear(),
    key: () => null,
    get length() {
      return mem.size;
    },
  } as Storage;
  saveSchedules([]);
});

describe('session-schedule', () => {
  it('creates and lists reminders for a session', () => {
    const r = createSchedule('s1', { text: '喝水', delayMinutes: 5 });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    const list = listSchedulesForSession('s1');
    assert.equal(list.length, 1);
    assert.equal(list[0]!.text, '喝水');
    assert.equal(list[0]!.status, 'scheduled');
  });

  it('rejects past dueAt', () => {
    const r = createSchedule('s1', {
      text: '旧',
      dueAt: new Date(Date.now() - 60_000).toISOString(),
    });
    assert.equal(r.ok, false);
  });

  it('updates and cancels', () => {
    const created = createSchedule('s1', { text: 'a', delayMinutes: 10 });
    assert.equal(created.ok, true);
    if (!created.ok) return;
    const updated = updateSchedule('s1', { id: created.reminder.id, text: 'b' });
    assert.equal(updated.ok, true);
    if (!updated.ok) return;
    assert.equal(updated.reminder.text, 'b');
    const cancelled = cancelSchedule('s1', created.reminder.id);
    assert.equal(cancelled.ok, true);
    assert.equal(listSchedulesForSession('s1').length, 0);
  });

  it('claims due reminders once', () => {
    const created = createSchedule('s1', { text: '到点', delayMinutes: 0.1 });
    assert.equal(created.ok, true);
    if (!created.ok) return;
    // force due
    const list = loadSchedules();
    list[0] = { ...list[0]!, dueAt: Date.now() - 1 };
    saveSchedules(list);
    const due1 = claimDueSchedules();
    assert.equal(due1.length, 1);
    assert.equal(due1[0]!.status, 'delivered');
    const due2 = claimDueSchedules();
    assert.equal(due2.length, 0);
  });
});
