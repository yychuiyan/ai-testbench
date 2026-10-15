import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { appendDeepseekSessionLog } from '../../tb-plugins/session-log-deepseek.mjs';
import { buildDeepseekTurnMessages } from './session-log-deepseek';

describe('session-log-deepseek', () => {
  let tmp = '';

  before(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tb-sess-log-'));
  });

  after(() => {
    try {
      fs.rmSync(tmp, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it('buildDeepseekTurnMessages includes reasoning_content', () => {
    const msgs = buildDeepseekTurnMessages({
      userContent: 'hi',
      assistantContent: 'ok',
      reasoning: 'think',
    });
    assert.equal(msgs.length, 2);
    assert.equal(msgs[1].reasoning_content, 'think');
  });

  it('appendDeepseekSessionLog writes jsonl', () => {
    const { path: rel } = appendDeepseekSessionLog(tmp, {
      sessionId: 's_demo',
      model: 'm',
      messages: buildDeepseekTurnMessages({
        userContent: 'u',
        assistantContent: 'a',
        reasoning: 'r',
      }),
    });
    const fp = path.join(tmp, rel);
    assert.ok(fs.existsSync(fp));
    const row = JSON.parse(fs.readFileSync(fp, 'utf8').trim());
    assert.equal(row.type, 'turn');
    assert.equal(row.messages[1].reasoning_content, 'r');
  });
});
