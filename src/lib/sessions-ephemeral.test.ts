import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isEphemeralEmptySession, type ChatSession } from './sessions';

function base(partial: Partial<ChatSession> = {}): ChatSession {
  return {
    id: 's1',
    title: '新对话',
    createdAt: 1,
    updatedAt: 1,
    archived: false,
    messages: [],
    ...partial,
  };
}

describe('isEphemeralEmptySession', () => {
  it('discards empty session even with promptGen active', () => {
    assert.equal(
      isEphemeralEmptySession(
        base({
          title: '新对话',
          promptGen: { active: true, kind: '功能' } as ChatSession['promptGen'],
        }),
      ),
      true,
    );
  });

  it('keeps session that already has messages', () => {
    assert.equal(
      isEphemeralEmptySession(
        base({
          messages: [{ role: 'user', content: 'hi' }],
          knowledgeGen: { active: true } as ChatSession['knowledgeGen'],
        }),
      ),
      false,
    );
  });
});
