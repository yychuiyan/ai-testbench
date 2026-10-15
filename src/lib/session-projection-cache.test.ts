import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { clearProjectionCacheForTests, getCachedProjection } from './session-projection-cache';

describe('session-projection-cache', () => {
  it('reuses value for same stamp', () => {
    clearProjectionCacheForTests();
    let builds = 0;
    const a = getCachedProjection('outline', 's1', 10, () => {
      builds += 1;
      return 'A';
    });
    const b = getCachedProjection('outline', 's1', 10, () => {
      builds += 1;
      return 'B';
    });
    assert.equal(a, 'A');
    assert.equal(b, 'A');
    assert.equal(builds, 1);
  });

  it('invalidates when updatedAt changes', () => {
    clearProjectionCacheForTests();
    getCachedProjection('stats', 's1', 1, () => 'old');
    const next = getCachedProjection('stats', 's1', 2, () => 'new');
    assert.equal(next, 'new');
  });
});
