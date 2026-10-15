import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import {
  appendSessionsJsonl,
  checkpointsDir,
  listCheckpoints,
  maybeWriteCheckpoint,
  readLatestCheckpoint,
  sessionsJsonlPath,
} from '../../tb-plugins/session-persist.mjs';

describe('session-persist', () => {
  let tmp = '';

  before(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tb-sess-persist-'));
  });

  after(() => {
    try {
      fs.rmSync(tmp, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it('appendSessionsJsonl writes a line', () => {
    appendSessionsJsonl(tmp, {
      activeId: 's1',
      sessions: [{ id: 's1', title: 't', updatedAt: 1, messages: [{ role: 'user' }] }],
    });
    const raw = fs.readFileSync(sessionsJsonlPath(tmp), 'utf8').trim();
    const row = JSON.parse(raw);
    assert.equal(row.type, 'session-store');
    assert.equal(row.activeId, 's1');
    assert.equal(row.sessions[0].messageCount, 1);
  });

  it('maybeWriteCheckpoint only on messageCount % 10 === 0', () => {
    const msgs = Array.from({ length: 10 }, (_, i) => ({ role: 'user', content: String(i) }));
    const fp = maybeWriteCheckpoint(tmp, {
      activeId: 's1',
      sessions: [{ id: 's1', title: 't', messages: msgs }],
    });
    assert.ok(fp);
    assert.ok(fs.existsSync(fp!));
    assert.ok(fp!.startsWith(checkpointsDir(tmp)));

    const skip = maybeWriteCheckpoint(tmp, {
      activeId: 's1',
      sessions: [{ id: 's1', title: 't', messages: msgs.slice(0, 3) }],
    });
    assert.equal(skip, null);

    const cp = readLatestCheckpoint(tmp, 's1');
    assert.ok(cp);
    assert.equal(cp!.sessionId, 's1');
    assert.equal(cp!.messageCount, 10);
    const listed = listCheckpoints(tmp);
    assert.ok(listed.some((x) => x.sessionId === 's1'));
  });
});
