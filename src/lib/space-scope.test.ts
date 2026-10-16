import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';

import { readActiveSpaceId, rememberActiveSpaceId, spaceScopedKey } from './space-scope';

const mem = {
  local: new Map<string, string>(),
  session: new Map<string, string>(),
};

function mockStore(kind: 'local' | 'session'): Storage {
  const m = mem[kind];
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => {
      m.set(k, v);
    },
    removeItem: (k: string) => {
      m.delete(k);
    },
    clear: () => m.clear(),
    key: () => null,
    get length() {
      return m.size;
    },
  } as Storage;
}

beforeEach(() => {
  mem.local.clear();
  mem.session.clear();
  (globalThis as { localStorage?: Storage }).localStorage = mockStore('local');
  (globalThis as { sessionStorage?: Storage }).sessionStorage = mockStore('session');
});

describe('space-scope', () => {
  it('无空间 id 时键保持原样，记住后按空间分键', () => {
    assert.equal(readActiveSpaceId(), '');
    assert.equal(spaceScopedKey('tw-chat-sessions'), 'tw-chat-sessions');
    rememberActiveSpaceId('sp_a');
    assert.equal(readActiveSpaceId(), 'sp_a');
    assert.equal(spaceScopedKey('tw-chat-sessions'), 'tw-chat-sessions::sp_a');
  });

  it('sessionStorage 优先于 localStorage', () => {
    mem.local.set('tw.space.active-id', 'from-local');
    mem.session.set('tw.space.active-id', 'from-session');
    assert.equal(readActiveSpaceId(), 'from-session');
  });
});
