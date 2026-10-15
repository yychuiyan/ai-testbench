import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { computeSessionStats, formatSessionStats } from './session-stats';
import type { ChatSession } from './sessions';

describe('session-stats', () => {
  it('aggregates counts and tokens', () => {
    const s: ChatSession = {
      id: 's1',
      title: 't',
      createdAt: 1,
      updatedAt: 2,
      archived: false,
      goal: { text: 'g', status: 'active', updatedAt: 1 },
      todos: [{ content: 'a', status: 'pending' }],
      messages: [
        { role: 'user', content: 'u' },
        {
          role: 'assistant',
          content: 'a',
          usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
        },
      ],
    };
    const st = computeSessionStats(s);
    assert.equal(st.userCount, 1);
    assert.equal(st.assistantCount, 1);
    assert.equal(st.totalTokens, 15);
    assert.equal(st.hasGoal, true);
    assert.equal(st.todoCount, 1);
    assert.match(formatSessionStats(st), /消息 2/);
    assert.match(formatSessionStats(st), /输入 10/);
    assert.match(formatSessionStats(st), /输出 5/);
    assert.match(formatSessionStats(st), /合计 15/);
  });
});
