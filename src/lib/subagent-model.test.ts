import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { resolveSubagentSettings } from './subagent-model';
import type { LLMSettings } from './settings';

const parent: LLMSettings = {
  baseURL: 'https://api.deepseek.com/v1',
  apiKey: 'k',
  model: 'deepseek-chat',
};

describe('subagent-model', () => {
  it('inherits when empty or inherit', () => {
    assert.equal(resolveSubagentSettings(parent, '').model, 'deepseek-chat');
    assert.equal(resolveSubagentSettings(parent, 'inherit').model, 'deepseek-chat');
    assert.equal(resolveSubagentSettings(parent, null).model, 'deepseek-chat');
  });

  it('overrides model only', () => {
    const next = resolveSubagentSettings(parent, 'deepseek-reasoner');
    assert.equal(next.model, 'deepseek-reasoner');
    assert.equal(next.baseURL, parent.baseURL);
    assert.equal(next.apiKey, parent.apiKey);
  });
});
