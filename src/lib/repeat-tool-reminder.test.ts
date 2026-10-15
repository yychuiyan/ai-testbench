import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  RepeatToolTracker,
  appendRepeatReminder,
  buildRepeatReminder,
  callKey,
} from './repeat-tool-reminder';

describe('repeat-tool-reminder', () => {
  it('callKey normalizes JSON argument order', () => {
    assert.equal(
      callKey('fs_read', '{"path":"a","x":1}'),
      callKey('fs_read', '{"x":1,"path":"a"}'),
    );
  });

  it('reminds on 3rd identical call', () => {
    const t = new RepeatToolTracker({ threshold: 3 });
    assert.equal(t.note('fs_read', '{"path":"a"}'), null);
    assert.equal(t.note('fs_read', '{"path":"a"}'), null);
    const rem = t.note('fs_read', '{"path":"a"}');
    assert.ok(rem);
    assert.match(rem!, /repeat-tool-reminder/);
    assert.match(rem!, /3 times/);
  });

  it('resets streak when name or args change', () => {
    const t = new RepeatToolTracker({ threshold: 3 });
    assert.equal(t.note('fs_read', '{"path":"a"}'), null);
    assert.equal(t.note('fs_read', '{"path":"a"}'), null);
    assert.equal(t.note('fs_read', '{"path":"b"}'), null);
    assert.equal(t.note('fs_read', '{"path":"b"}'), null);
    assert.ok(t.note('fs_read', '{"path":"b"}'));
  });

  it('appendRepeatReminder concatenates', () => {
    const rem = buildRepeatReminder('bash', 3);
    assert.equal(appendRepeatReminder('ok', null), 'ok');
    assert.ok(appendRepeatReminder('ok', rem).startsWith('ok'));
    assert.match(appendRepeatReminder('ok', rem), /repeat-tool-reminder/);
  });
});
