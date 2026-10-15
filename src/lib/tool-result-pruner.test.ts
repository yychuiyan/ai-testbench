import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { pruneToolResult } from './tool-result-pruner';

describe('pruneToolResult', () => {
  it('passes through short text', () => {
    assert.equal(pruneToolResult('hello'), 'hello');
  });

  it('keeps head and tail when over max', () => {
    const body = `${'A'.repeat(5000)}${'B'.repeat(5000)}${'C'.repeat(5000)}`;
    const out = pruneToolResult(body, { maxChars: 12_000, headChars: 4_000, tailChars: 4_000 });
    assert.ok(out.length < body.length);
    assert.ok(out.startsWith('A'.repeat(4_000)));
    assert.ok(out.endsWith('C'.repeat(4_000)));
    assert.ok(out.includes('tool result pruned'));
  });
});
