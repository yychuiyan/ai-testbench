import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  getFsObservationPolicy,
  shouldSkipDirName,
} from '../../builtin/session/fs-observation-policy.mjs';

describe('fs-observation-policy', () => {
  it('exposes skip dirs and limits', () => {
    const p = getFsObservationPolicy();
    assert.ok(p.skipDirs.includes('node_modules'));
    assert.ok(p.skipDirs.includes('.git'));
    assert.equal(p.globMax, 100);
    assert.equal(p.grepMax, 250);
    assert.ok(p.maxReadBytes > 0);
    assert.ok(p.maxWriteBytes >= p.maxReadBytes);
  });

  it('shouldSkipDirName', () => {
    assert.equal(shouldSkipDirName('node_modules'), true);
    assert.equal(shouldSkipDirName('src'), false);
  });
});
