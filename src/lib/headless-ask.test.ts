import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { loadHeadlessSettings } from '../../cli/headless.mjs';

describe('headless settings', () => {
  const originalXdg = process.env.XDG_CONFIG_HOME;
  let tmp = '';
  let home = '';

  before(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tb-headless-'));
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'tb-headless-home-'));
    process.env.XDG_CONFIG_HOME = home;
    const modelsDir = path.join(home, 'lantern-harness');
    fs.mkdirSync(modelsDir, { recursive: true });
    fs.writeFileSync(
      path.join(modelsDir, 'models.json'),
      JSON.stringify({
        activeId: 'p1',
        reasoningEffort: 'high',
        providers: [
          {
            id: 'p1',
            name: 't',
            baseURL: 'https://api.example.com/v1',
            model: 'demo-model',
            apiKey: 'sk-test',
          },
        ],
      }),
    );
  });

  after(() => {
    if (originalXdg === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = originalXdg;
    for (const d of [tmp, home]) {
      try {
        fs.rmSync(d, { recursive: true, force: true });
      } catch {
        // ignore
      }
    }
  });

  it('loadHeadlessSettings reads provider', () => {
    const s = loadHeadlessSettings(tmp);
    assert.equal(s.model, 'demo-model');
    assert.equal(s.baseURL, 'https://api.example.com/v1');
    assert.equal(s.apiKey, 'sk-test');
  });
});
