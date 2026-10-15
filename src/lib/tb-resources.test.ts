import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import connect from 'connect';
import { after, before, describe, it } from 'node:test';
import { tbResourcesPlugin } from '../../tb-plugins/tb-resources.mjs';

describe('tb-resources', () => {
  let tmp = '';
  /** @type {http.Server | null} */
  let server = null;
  let base = '';

  before(async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tb-res-'));
    fs.mkdirSync(path.join(tmp, '.local'), { recursive: true });
    fs.mkdirSync(path.join(tmp, 'cases'), { recursive: true });
    const app = connect();
    const plugin = tbResourcesPlugin();
    plugin.configureServer({
      config: { root: tmp },
      middlewares: app,
    });
    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const addr = server.address();
    base = `http://127.0.0.1:${addr.port}`;
  });

  after(async () => {
    await new Promise((resolve) => server?.close(() => resolve(undefined)));
    try {
      fs.rmSync(tmp, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it('lists storage and doc resources', async () => {
    const res = await fetch(`${base}/__tb_resources`);
    assert.equal(res.ok, true);
    const data = await res.json();
    assert.ok(data.count >= 1);
    assert.ok(data.resources.some((r) => String(r.uri).startsWith('tb://storage/')));
    assert.ok(data.resources.some((r) => r.id === 'cases'));
  });

  it('reads resource by uri and mcp resources/list', async () => {
    const read = await fetch(
      `${base}/__tb_resources/read?uri=${encodeURIComponent('tb://docs/cases')}`,
    );
    assert.equal(read.ok, true);
    const body = await read.json();
    assert.equal(body.ok, true);
    assert.ok(String(body.text || '').includes('entries'));

    const mcp = await fetch(`${base}/__tb_resources/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'resources/list' }),
    });
    assert.equal(mcp.ok, true);
    const rpc = await mcp.json();
    assert.ok(Array.isArray(rpc.result?.resources));
  });
});
