import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildTurnOutline, formatTurnOutline } from './session-turn-outline';

describe('session-turn-outline', () => {
  it('pairs user/assistant turns', () => {
    const items = buildTurnOutline([
      { role: 'user', content: '问题一' },
      { role: 'assistant', content: '回答一', reasoning: '先分析需求' },
      { role: 'user', content: '问题二' },
    ]);
    assert.equal(items.length, 2);
    assert.equal(items[0]!.assistantPreview, '回答一');
    assert.equal(items[0]!.assistantText, '回答一');
    assert.equal(items[0]!.reasoning, '先分析需求');
    assert.equal(items[0]!.endMessageIndex, 1);
    assert.equal(items[1]!.assistantPreview, '');
    assert.equal(items[1]!.endMessageIndex, 2);
    assert.match(formatTurnOutline(items), /问题一/);
  });
});
