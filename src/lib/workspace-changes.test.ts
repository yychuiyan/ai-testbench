import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  parseFsMutationSuccess,
  recordWorkspaceChange,
  runWorkspaceChangesTool,
} from './workspace-changes';

describe('workspace-changes', () => {
  it('recordWorkspaceChange dedupes by path and caps', () => {
    let list = recordWorkspaceChange([], { path: 'a.txt', op: 'write', at: 1 });
    list = recordWorkspaceChange(list, { path: 'a.txt', op: 'write', at: 2 });
    assert.equal(list.length, 1);
    assert.equal(list[0].at, 2);
    list = recordWorkspaceChange(list, { path: 'dir', op: 'mkdir', at: 3 });
    assert.equal(list.length, 2);
  });

  it('parseFsMutationSuccess reads write/mkdir', () => {
    assert.deepEqual(parseFsMutationSuccess('fs_write', '{"ok":true,"path":"x.md"}'), {
      path: 'x.md',
      op: 'write',
    });
    assert.deepEqual(parseFsMutationSuccess('fs_mkdir', '{"ok":true,"path":"d"}'), {
      path: 'd',
      op: 'mkdir',
    });
    assert.equal(parseFsMutationSuccess('fs_read', '{"ok":true,"path":"x"}'), null);
    assert.equal(parseFsMutationSuccess('fs_write', '{"error":"no"}'), null);
  });

  it('runWorkspaceChangesTool list and clear', () => {
    const listed = runWorkspaceChangesTool('workspace_changes_list', [
      { path: 'a', op: 'write', at: 1 },
    ]);
    assert.match(listed.text, /"count": 1/);
    const cleared = runWorkspaceChangesTool('workspace_changes_clear', [
      { path: 'a', op: 'write', at: 1 },
    ]);
    assert.deepEqual(cleared.next, []);
  });
});
