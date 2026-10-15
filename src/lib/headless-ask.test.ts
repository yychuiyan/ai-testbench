import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { loadHeadlessSettings } from '../../cli/headless.mjs';

describe('headless settings', () => {
  let tmp = '';

  before(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tb-headless-'));
    fs.mkdirSync(path.join(tmp, 'config'), { recursive: true });
    fs.mkdirSync(path.join(tmp, '.local'), { recursive: true });
    fs.writeFileSync(
      path.join(tmp, 'config', 'app.defaults.json'),
      JSON.stringify({
        version: 1,
        model: { activeId: 'p1', providers: [], reasoningEffort: 'high' },
        access: 'readonly',
        general: {},
        plugins: {},
      }),
    );
    fs.writeFileSync(
      path.join(tmp, '.local', 'app.config.json'),
      JSON.stringify({
        version: 1,
        model: {
          activeId: 'p1',
          providers: [
            {
              id: 'p1',
              name: 't',
              baseURL: 'https://api.example.com/v1',
              model: 'demo-model',
              apiKey: 'sk-test',
            },
          ],
        },
      }),
    );
  });

  after(() => {
    try {
      fs.rmSync(tmp, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it('loadHeadlessSettings reads provider', () => {
    const s = loadHeadlessSettings(tmp);
    assert.equal(s.model, 'demo-model');
    assert.equal(s.baseURL, 'https://api.example.com/v1');
    assert.equal(s.apiKey, 'sk-test');
  });
});
