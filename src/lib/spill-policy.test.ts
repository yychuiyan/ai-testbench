import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DEFAULT_SPILL_POLICY, buildSpillPlaceholder, shouldSpill } from './spill-policy';

describe('spill-policy', () => {
  it('shouldSpill respects threshold', () => {
    assert.equal(shouldSpill('short', { ...DEFAULT_SPILL_POLICY, spillChars: 100 }), false);
    assert.equal(shouldSpill('x'.repeat(101), { ...DEFAULT_SPILL_POLICY, spillChars: 100 }), true);
    assert.equal(
      shouldSpill('x'.repeat(200), { ...DEFAULT_SPILL_POLICY, spillChars: 100, enabled: false }),
      false,
    );
  });

  it('buildSpillPlaceholder includes path marker', () => {
    const t = buildSpillPlaceholder(
      { path: '.local/spill/a.txt', bytes: 12, originalChars: 100 },
      'HEAD',
      'TAIL',
    );
    assert.match(t, /spilled 100 chars/);
    assert.match(t, /\.local\/spill\/a\.txt/);
    assert.ok(t.startsWith('HEAD'));
    assert.ok(t.endsWith('TAIL'));
  });
});
