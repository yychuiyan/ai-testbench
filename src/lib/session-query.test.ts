import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { filterSessionsByQuery, querySessions } from './session-query';
import type { SessionStore } from './sessions';

const store: SessionStore = {
  activeId: 's1',
  sessions: [
    {
      id: 's1',
      title: '登录用例',
      createdAt: 1,
      updatedAt: 10,
      archived: false,
      messages: [{ role: 'user', content: '请写登录测试' }],
    },
    {
      id: 's2',
      title: '新对话',
      createdAt: 2,
      updatedAt: 20,
      archived: false,
      messages: [{ role: 'user', content: '分析支付回调' }],
    },
    {
      id: 's3',
      title: '归档项',
      createdAt: 3,
      updatedAt: 5,
      archived: true,
      messages: [{ role: 'user', content: '登录回归' }],
    },
  ],
};

describe('session-query', () => {
  it('matches title and message body', () => {
    const byTitle = querySessions(store, '登录');
    assert.ok(byTitle.some((h) => h.sessionId === 's1'));
    const byBody = querySessions(store, '支付');
    assert.equal(byBody.length, 1);
    assert.equal(byBody[0].sessionId, 's2');
  });

  it('includeArchived opt', () => {
    const open = querySessions(store, '登录', { includeArchived: false });
    assert.ok(!open.some((h) => h.sessionId === 's3'));
    const all = querySessions(store, '登录', { includeArchived: true });
    assert.ok(all.some((h) => h.sessionId === 's3'));
  });

  it('filterSessionsByQuery', () => {
    const list = store.sessions.filter((s) => !s.archived);
    const filtered = filterSessionsByQuery(list, store, '支付');
    assert.deepEqual(
      filtered.map((s) => s.id),
      ['s2'],
    );
  });
});
