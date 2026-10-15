import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import {
  closeBashSession,
  execBashSession,
  openBashSession,
  resetBashSessionsForTests,
} from '../../builtin/session/bash-session.mjs';
import { buildChildEnv } from '../../builtin/session/sandbox-policy.mjs';

describe('bash-session (pipe fallback)', () => {
  let tmp = '';

  before(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tb-bash-sess-'));
    fs.mkdirSync(path.join(tmp, 'sub'));
    resetBashSessionsForTests();
  });

  after(() => {
    resetBashSessionsForTests();
    try {
      fs.rmSync(tmp, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it('open → exec pwd → cd persists → close', async () => {
    const env = buildChildEnv({ scrubEnv: true });
    const opened = await openBashSession({
      cwdAbs: tmp,
      cwdDisplay: '.',
      env,
    });
    assert.equal(opened.ok, true);
    assert.ok(opened.sessionId);
    assert.ok(opened.backend === 'pipe' || opened.backend === 'pty');

    const pwd = await execBashSession({
      sessionId: opened.sessionId!,
      command: 'pwd',
      timeoutMs: 10_000,
    });
    assert.ok(pwd.ok || pwd.output, JSON.stringify(pwd));
    assert.match(String(pwd.output || ''), new RegExp(path.basename(tmp)));

    const cd = await execBashSession({
      sessionId: opened.sessionId!,
      command: 'cd sub',
      timeoutMs: 10_000,
    });
    assert.ok(!cd.timedOut, JSON.stringify(cd));

    const pwd2 = await execBashSession({
      sessionId: opened.sessionId!,
      command: 'pwd',
      timeoutMs: 10_000,
    });
    assert.match(String(pwd2.output || ''), /sub/);

    const closed = closeBashSession(opened.sessionId!);
    assert.equal(closed.ok, true);
  });

  it('blocks denied commands in session exec', async () => {
    const env = buildChildEnv({ scrubEnv: true });
    const opened = await openBashSession({
      cwdAbs: tmp,
      cwdDisplay: '.',
      env,
    });
    assert.equal(opened.ok, true);
    const denied = await execBashSession({
      sessionId: opened.sessionId!,
      command: 'rm -rf /',
    });
    assert.equal(denied.ok, false);
    assert.match(String(denied.error || ''), /sandbox-policy/);
    closeBashSession(opened.sessionId!);
  });
});
