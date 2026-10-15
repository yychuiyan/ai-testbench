import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { resetBashSessionsForTests } from '../../builtin/session/bash-session.mjs';
import {
  closePwshSession,
  execPwshSession,
  openPwshSession,
  resetPwshSessionsForTests,
  resolvePwshBinary,
} from '../../builtin/session/pwsh-session.mjs';
import { buildChildEnv } from '../../builtin/session/sandbox-policy.mjs';

const hasPwsh = Boolean(resolvePwshBinary());

describe('pwsh-session', { skip: !hasPwsh }, () => {
  let tmp = '';

  before(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tb-pwsh-sess-'));
    fs.mkdirSync(path.join(tmp, 'sub'));
    resetBashSessionsForTests(); // force pipe (pty cache false)
    resetPwshSessionsForTests();
  });

  after(() => {
    resetPwshSessionsForTests();
    try {
      fs.rmSync(tmp, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it('open → Get-Location → Set-Location persists → close', async () => {
    const env = buildChildEnv({ scrubEnv: true });
    const opened = await openPwshSession({
      cwdAbs: tmp,
      cwdDisplay: '.',
      env,
    });
    assert.equal(opened.ok, true, JSON.stringify(opened));
    assert.ok(opened.sessionId);

    const loc = await execPwshSession({
      sessionId: opened.sessionId!,
      command: '(Get-Location).Path',
      timeoutMs: 15_000,
    });
    assert.ok(!loc.timedOut, JSON.stringify(loc));
    assert.match(String(loc.output || ''), new RegExp(path.basename(tmp)));

    const cd = await execPwshSession({
      sessionId: opened.sessionId!,
      command: 'Set-Location sub',
      timeoutMs: 15_000,
    });
    assert.ok(!cd.timedOut, JSON.stringify(cd));

    const loc2 = await execPwshSession({
      sessionId: opened.sessionId!,
      command: '(Get-Location).Path',
      timeoutMs: 15_000,
    });
    assert.match(String(loc2.output || ''), /sub/);

    const closed = closePwshSession(opened.sessionId!);
    assert.equal(closed.ok, true);
  });

  it('blocks denied commands', async () => {
    const env = buildChildEnv({ scrubEnv: true });
    const opened = await openPwshSession({
      cwdAbs: tmp,
      cwdDisplay: '.',
      env,
    });
    assert.equal(opened.ok, true);
    const denied = await execPwshSession({
      sessionId: opened.sessionId!,
      command: 'rm -rf /',
    });
    assert.equal(denied.ok, false);
    assert.match(String(denied.error || ''), /sandbox-policy/);
    closePwshSession(opened.sessionId!);
  });
});

describe('pwsh-session (no binary)', { skip: hasPwsh }, () => {
  it('open reports missing PowerShell', async () => {
    const r = await openPwshSession({
      cwdAbs: os.tmpdir(),
      cwdDisplay: '.',
      env: buildChildEnv({ scrubEnv: true }),
    });
    assert.equal(r.ok, false);
    assert.match(String(r.error || ''), /PowerShell not found/i);
  });
});
