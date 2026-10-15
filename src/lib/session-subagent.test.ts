import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import {
  SUBAGENT_PRESETS,
  abortSubagent,
  listSubagentRecords,
  resetSubagentRegistryForTests,
  runSubagentTool,
  type SubagentToolContext,
} from './session-subagent';

function stubCtx(partial?: Partial<SubagentToolContext>): SubagentToolContext {
  return {
    settings: {
      baseURL: 'http://127.0.0.1:9/v1',
      apiKey: 'x',
      model: 'test',
    },
    access: 'readonly',
    fsEnabled: false,
    webEnabled: false,
    runFs: async () => JSON.stringify({ error: 'no fs' }),
    runWeb: async () => JSON.stringify({ error: 'no web' }),
    ...partial,
  };
}

beforeEach(() => {
  resetSubagentRegistryForTests();
});

describe('session-subagent', () => {
  it('list_agents returns presets', async () => {
    const raw = await runSubagentTool('list_agents', '{}', stubCtx());
    const parsed = JSON.parse(raw) as {
      ok: boolean;
      presets: typeof SUBAGENT_PRESETS;
      maxConcurrent: number;
    };
    assert.equal(parsed.ok, true);
    assert.equal(parsed.presets.length, 2);
    assert.ok(parsed.presets.some((p) => p.id === 'explore'));
    assert.equal(parsed.maxConcurrent, 2);
  });

  it('spawn without prompt fails', async () => {
    const raw = await runSubagentTool('spawn_subagent', '{}', stubCtx());
    const parsed = JSON.parse(raw) as { ok: boolean; error?: string };
    assert.equal(parsed.ok, false);
    assert.match(parsed.error ?? '', /prompt/);
  });

  it('abort unknown id fails', () => {
    const r = abortSubagent('missing');
    assert.equal(r.ok, false);
  });

  it('subagent_list empty initially', async () => {
    const raw = await runSubagentTool('subagent_list', '{}', stubCtx());
    const parsed = JSON.parse(raw) as { agents: unknown[] };
    assert.equal(parsed.agents.length, 0);
    assert.equal(listSubagentRecords().length, 0);
  });
});
