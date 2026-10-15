import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { listStorageDomains } from '../../tb-plugins/storage-domain.mjs';

describe('storage-domain', () => {
  let tmp = '';

  before(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tb-storage-dom-'));
    fs.mkdirSync(path.join(tmp, '.local'), { recursive: true });
    fs.writeFileSync(path.join(tmp, '.local', 'sessions.json'), '{"sessions":[]}\n');
    fs.mkdirSync(path.join(tmp, '.local', 'spill'), { recursive: true });
  });

  after(() => {
    try {
      fs.rmSync(tmp, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it('lists known domains with exists flags', () => {
    const domains = listStorageDomains(tmp);
    const sessions = domains.find((d: { id: string }) => d.id === 'sessions');
    const spill = domains.find((d: { id: string }) => d.id === 'spill');
    const mem = domains.find((d: { id: string }) => d.id === 'memories');
    assert.ok(sessions?.exists);
    assert.ok(spill?.exists);
    assert.equal(mem?.exists, false);
    assert.ok(domains.length >= 8);
  });
});
