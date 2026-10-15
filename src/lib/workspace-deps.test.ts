import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { loadWorkspaceDependencies } from '../../builtin/session/workspace-deps.mjs';

describe('workspace-deps', () => {
  it('resolves at least node on this host', async () => {
    const tools = await loadWorkspaceDependencies();
    const node = tools.find((t: { id: string }) => t.id === 'node');
    assert.ok(node);
    assert.equal(node.available, true);
    assert.ok(node.path);
    assert.ok(tools.some((t: { id: string }) => t.id === 'python'));
  });
});
