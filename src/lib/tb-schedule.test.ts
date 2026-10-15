import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import {
  claimAndDeliverDue,
  createHostReminder,
  listHostReminders,
  reminderMessageContent,
  sessionHasScheduleMessage,
} from '../../builtin/session/tb-schedule.mjs';

describe('tb-schedule host', () => {
  let root = '';

  before(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'tb-sched-'));
    fs.mkdirSync(path.join(root, '.local'), { recursive: true });
    fs.writeFileSync(
      path.join(root, '.local', 'sessions.json'),
      JSON.stringify(
        {
          activeId: 's1',
          sessions: [
            {
              id: 's1',
              title: 't',
              createdAt: 1,
              updatedAt: 1,
              archived: false,
              messages: [{ role: 'user', content: 'hi' }],
            },
          ],
        },
        null,
        2,
      ),
      'utf8',
    );
  });

  after(() => {
    try {
      fs.rmSync(root, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it('creates, claims, and injects into sessions.json', () => {
    const created = createHostReminder(root, 's1', { text: '喝水', delayMinutes: 5 });
    assert.equal(created.ok, true);
    if (!created.ok) return;
    assert.equal(listHostReminders(root, 's1').length, 1);

    // force due
    const storePath = path.join(root, '.local', 'schedules.json');
    const store = JSON.parse(fs.readFileSync(storePath, 'utf8')) as {
      reminders: Array<{ dueAt: number }>;
    };
    store.reminders[0]!.dueAt = Date.now() - 10;
    fs.writeFileSync(storePath, JSON.stringify(store, null, 2), 'utf8');

    const due = claimAndDeliverDue(root);
    assert.equal(due.length, 1);
    assert.equal(due[0]!.status, 'delivered');

    const sessions = JSON.parse(
      fs.readFileSync(path.join(root, '.local', 'sessions.json'), 'utf8'),
    ) as { sessions: Array<{ messages: Array<{ content?: string }> }> };
    const msgs = sessions.sessions[0]!.messages;
    const reminder = created.reminder;
    assert.ok(reminder, 'created.reminder 应当存在');
    assert.ok(sessionHasScheduleMessage(msgs, reminder.id));
    assert.match(
      String(msgs[msgs.length - 1]!.content),
      new RegExp(
        reminderMessageContent('喝水', reminder.id).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
      ),
    );

    // idempotent
    assert.equal(claimAndDeliverDue(root).length, 0);
  });
});
