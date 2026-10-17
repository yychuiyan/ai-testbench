import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import connect from 'connect';
import { after, before, describe, it } from 'node:test';
import { lhResourcesPlugin } from '../../lh-plugins/lh-resources.mjs';
import { DOC_ROOT_DIRS } from '../../lh-plugins/lh-project-docs.mjs';
import { __resetSpaceContext, setActiveRoot } from '../../builtin/session/space-context.mjs';

/** 用例库在磁盘上的真实目录名（现为中文），与实现同源取值，避免硬编码再次漂移 */
const CASES_DIR = DOC_ROOT_DIRS.cases.dirName;

describe('lh-resources', () => {
  let tmp = '';
  let server: http.Server | null = null;
  let base = '';

  before(async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tb-res-'));
    fs.mkdirSync(path.join(tmp, '.local'), { recursive: true });
    fs.mkdirSync(path.join(tmp, CASES_DIR), { recursive: true });
    // 插件改为每个请求惰性读 getDataRoot()；测试里把当前数据根指到临时目录
    __resetSpaceContext();
    setActiveRoot(tmp);
    const app = connect();
    const plugin = lhResourcesPlugin();
    // Vite 的 configureServer 是 ObjectHook 联合类型（函数或 { handler }）；该插件用的是
    // 函数形式，这里按函数收窄后直接调用 hook，传入最小可用的 dev server 替身。
    const configureServer = plugin.configureServer as unknown as (server: {
      config: { root: string };
      middlewares: connect.Server;
    }) => void;
    configureServer({
      config: { root: tmp },
      middlewares: app,
    });
    // let server 被捕获进回调后收窄会失效，赋给局部 const 再用
    server = http.createServer(app);
    const started = server;
    await new Promise<void>((resolve) => started.listen(0, '127.0.0.1', resolve));
    const addr = started.address();
    if (!addr || typeof addr === 'string') throw new Error('未能取得监听端口');
    base = `http://127.0.0.1:${addr.port}`;
  });

  after(async () => {
    await new Promise((resolve) => server?.close(() => resolve(undefined)));
    __resetSpaceContext();
    try {
      fs.rmSync(tmp, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it('lists storage and doc resources', async () => {
    const res = await fetch(`${base}/__tb_resources`);
    assert.equal(res.ok, true);
    const data = (await res.json()) as {
      count: number;
      resources: Array<{ uri: string; id: string }>;
    };
    assert.ok(data.count >= 1);
    assert.ok(data.resources.some((r) => String(r.uri).startsWith('tb://storage/')));
    assert.ok(data.resources.some((r) => r.id === CASES_DIR));
  });

  it('reads resource by uri and mcp resources/list', async () => {
    const read = await fetch(
      `${base}/__tb_resources/read?uri=${encodeURIComponent(`tb://docs/${CASES_DIR}`)}`,
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
