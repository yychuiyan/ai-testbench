import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { unwrapGeneratedPrompt } from './space-system-prompt';

describe('unwrapGeneratedPrompt', () => {
  it('去掉整段 Markdown 围栏', () => {
    assert.equal(unwrapGeneratedPrompt('```markdown\n你是助手。\n```'), '你是助手。');
  });

  it('原文不是围栏时原样返回', () => {
    assert.equal(unwrapGeneratedPrompt('  你是助手。\n'), '你是助手。');
  });
});
