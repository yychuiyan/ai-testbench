/**
 * 数据空间 HTTP 接口的集成测试：
 * - 用临时数据根起本地服务，走真实 HTTP 打 `/__tb_spaces`
 * - 重点验证「有会话在跑时拒绝切换」的并发保护（靠 __sessionRunsForTest 注入状态）
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';

import {
  __resetSpaceContext,
  getDataRoot,
  publicSpacePath,
} from '../../builtin/session/space-context.mjs';
import { __sessionRunsForTest } from '../../builtin/session/session-runs.mjs';
import { startLocalServer } from '../../cli/server.mjs';

const ORIGINAL_XDG = process.env.XDG_CONFIG_HOME;

let home = '';
let base = '';
let managed = '';
let server: { close: () => void } | null = null;
let origin = '';

/** 取一个当前空闲的端口（startLocalServer 会把 0 当成「未指定」而回落到 4321） */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const addr = probe.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      probe.close(() => resolve(port));
    });
  });
}

function api(p: string): string {
  return `${origin}${p}`;
}

async function getJson(p: string): Promise<Record<string, unknown>> {
  const res = await fetch(api(p));
  return (await res.json()) as Record<string, unknown>;
}

async function postJson(
  p: string,
  body: unknown,
): Promise<{ status: number; data: Record<string, unknown> }> {
  const res = await fetch(api(p), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
  return { status: res.status, data: (await res.json()) as Record<string, unknown> };
}

before(async () => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'tb-api-home-'));
  base = fs.mkdtempSync(path.join(os.tmpdir(), 'tb-api-base-'));
  // 新建空间与拷贝进来的空间文件夹都落在选中的文件夹下（池根 = base）
  managed = base;
  process.env.XDG_CONFIG_HOME = home;

  const regPath = path.join(home, 'ai-testbench', 'spaces.json');
  fs.mkdirSync(path.dirname(regPath), { recursive: true });
  fs.writeFileSync(regPath, JSON.stringify({ activeId: 'public', spaces: [] }, null, 2));

  __resetSpaceContext();
  const port = await freePort();
  const started = (await startLocalServer({ dataRoot: base, port })) as unknown as {
    server: { address: () => { port: number }; close: () => void };
  };
  server = started.server;
  origin = `http://127.0.0.1:${started.server.address().port}`;
});

after(() => {
  // fetch 走 keep-alive，不主动断开的话 server.close() 会一直等连接
  (server as unknown as { closeAllConnections?: () => void })?.closeAllConnections?.();
  server?.close();
  __sessionRunsForTest.clear();
  if (ORIGINAL_XDG === undefined) delete process.env.XDG_CONFIG_HOME;
  else process.env.XDG_CONFIG_HOME = ORIGINAL_XDG;
  for (const d of [home, base]) {
    try {
      fs.rmSync(d, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
});

describe('GET /__tb_spaces', () => {
  it('返回公共空间与当前数据根，体积默认不统计', async () => {
    const d = await getJson('/__tb_spaces');
    assert.equal(d.ok, true);
    assert.equal(d.activeId, 'public');
    assert.equal(d.dataRoot, publicSpacePath(base));

    const spaces = d.spaces as Array<Record<string, unknown>>;
    assert.equal(spaces.length, 1);
    assert.equal(spaces[0]!.isPublic, true);
    assert.equal(spaces[0]!.bytes, null, '默认不应统计体积');
  });

  it('stats=1 时才统计体积', async () => {
    const d = await getJson('/__tb_spaces?stats=1');
    const spaces = d.spaces as Array<Record<string, unknown>>;
    assert.equal(typeof spaces[0]!.bytes, 'number');
  });
});

describe('POST /__tb_spaces/create 与 switch', () => {
  it('创建会铺设数据根骨架，并可顺带切换', async () => {
    const { data } = await postJson('/__tb_spaces/create', {
      name: '接口空间',
      switch: true,
    });
    assert.equal(data.ok, true);
    assert.equal(data.switched, true);

    const space = data.space as { path: string };
    // prepareSpaceDir 应铺好隐藏元数据目录（.tb/config + .tb/local）与五个内容目录
    for (const dirName of [
      '.tb',
      '.tb/config',
      '.tb/local',
      '需求文档库',
      '用例管理',
      '提示词管理',
      '知识库管理',
      '测试模板库',
    ]) {
      assert.equal(fs.existsSync(path.join(space.path, dirName)), true, `缺少 ${dirName}`);
    }
    assert.equal(
      path.resolve(path.dirname(space.path)),
      path.resolve(base),
      '新空间应与公共空间同级，直接落在选中的文件夹下',
    );
    assert.equal(getDataRoot(), space.path);

    const cfg = await getJson('/__tb_config');
    assert.equal(
      String((cfg.paths as { local: string }).local).startsWith(space.path),
      true,
      '配置路径应指向新空间',
    );
  });

  it('名称非法 / 重名返回 400', async () => {
    const bad = await postJson('/__tb_spaces/create', { name: '../escape' });
    assert.equal(bad.status, 400);
    assert.equal(bad.data.ok, false);

    const dup = await postJson('/__tb_spaces/create', { name: '接口空间' });
    assert.equal(dup.status, 400);
  });

  it('有会话在运行时拒绝切换（409），且数据根不变', async () => {
    const before = getDataRoot();
    // 注入一条运行中的会话
    __sessionRunsForTest.set('fake-session', { status: 'running' } as never);

    const blocked = await postJson('/__tb_spaces/switch', { id: 'public' });
    assert.equal(blocked.status, 409);
    assert.match(String(blocked.data.error), /仍有会话在运行/);
    assert.equal(getDataRoot(), before, '被拒绝时数据根不应改变');

    __sessionRunsForTest.clear();
    const ok = await postJson('/__tb_spaces/switch', { id: 'public' });
    assert.equal(ok.status, 200);
    assert.equal(ok.data.ok, true);
    assert.equal(getDataRoot(), publicSpacePath(base));
  });
});

describe('POST /__tb_spaces/delete 安全语义', () => {
  it('purge 未显式确认时拒绝（400）', async () => {
    const listed = await getJson('/__tb_spaces');
    const target = (listed.spaces as Array<Record<string, unknown>>).find((s) => !s.isPublic);
    assert.ok(target);

    const res = await fetch(api('/__tb_spaces/delete'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: target!.id, purge: true }),
    });
    assert.equal(res.status, 400);
    assert.match(String(((await res.json()) as { error?: string }).error), /显式确认/);
  });

  it('公共空间不可删除 / 不可重命名', async () => {
    const del = await postJson('/__tb_spaces/delete', { id: 'public', purge: false });
    assert.equal(del.status, 400);
    assert.match(String(del.data.error), /不支持删除/);

    const ren = await postJson('/__tb_spaces/rename', { id: 'public', name: '改名' });
    assert.equal(ren.status, 400);
    assert.match(String(ren.data.error), /不支持重命名/);
  });

  it('删除当前激活空间后回落到公共空间', async () => {
    const created = await postJson('/__tb_spaces/create', { name: '待清理', switch: true });
    const space = created.data.space as { id: string; path: string };
    assert.equal(getDataRoot(), space.path);

    const del = await postJson('/__tb_spaces/delete', {
      id: space.id,
      purge: true,
      confirm: true,
    });
    assert.equal(del.status, 200);
    assert.equal(del.data.purged, true);
    assert.equal(fs.existsSync(space.path), false);
    assert.equal(getDataRoot(), publicSpacePath(base), '应回落到公共空间');
    assert.equal((await getJson('/__tb_spaces')).activeId, 'public');
  });
});

describe('POST /__tb_spaces/validate-name', () => {
  it('透传名称校验结果', async () => {
    assert.equal((await postJson('/__tb_spaces/validate-name', { name: 'ok名' })).data.ok, true);
    assert.equal((await postJson('/__tb_spaces/validate-name', { name: 'a/b' })).data.ok, false);
  });
});

describe('GET /__tb_spaces/export 范围', () => {
  it('scope=content 时排除密钥与会话，scope 缺省为完整备份', async () => {
    const created = await postJson('/__tb_spaces/create', { name: '导出空间' });
    const space = created.data.space as { id: string; path: string };
    assert.equal(created.data.ok, true);

    fs.writeFileSync(path.join(space.path, '.env'), 'TW_API_KEY=sk-x\n', 'utf8');
    fs.mkdirSync(path.join(space.path, '.tb', 'local', 'memories'), { recursive: true });
    fs.writeFileSync(path.join(space.path, '.tb', 'local', 'memories', 'USER.md'), 'p', 'utf8');
    fs.writeFileSync(path.join(space.path, '需求文档库', 'a.md'), '# a', 'utf8');

    const JSZip = (await import('jszip')).default;

    const contentRes = await fetch(api(`/__tb_spaces/export?id=${space.id}&scope=content`));
    assert.equal(contentRes.status, 200);
    const contentZip = await JSZip.loadAsync(Buffer.from(await contentRes.arrayBuffer()));
    const names = Object.keys(contentZip.files);
    assert.ok(names.includes('需求文档库/a.md'));
    assert.equal(names.includes('.env'), false);
    assert.equal(
      names.some((n) => n.startsWith('.tb/local/memories/')),
      false,
    );

    // 非法 scope 退回完整备份（宁可多带，也不能误以为不含密钥）
    const weird = await fetch(api(`/__tb_spaces/export?id=${space.id}&scope=whatever`));
    const weirdZip = await JSZip.loadAsync(Buffer.from(await weird.arrayBuffer()));
    assert.ok(Object.keys(weirdZip.files).includes('.env'));
  });
});

describe('POST /__tb_spaces/discover', () => {
  it('纳入空间池内带 space.json 清单的文件夹', async () => {
    // 模拟「整体拷进来」：手工造一个带清单的目录
    const incoming = path.join(managed, '外部拷入');
    fs.mkdirSync(path.join(incoming, '.tb', 'local'), { recursive: true });
    fs.writeFileSync(
      path.join(incoming, '.tb', 'space.json'),
      JSON.stringify({
        kind: 'ai-testbench-space',
        schema: 1,
        id: 'sp_outer',
        name: '外部拷入',
        createdAt: 1,
      }),
      'utf8',
    );

    const out = await postJson('/__tb_spaces/discover', {});
    assert.equal(out.status, 200);
    assert.equal(out.data.ok, true);
    const added = out.data.added as Array<{ name: string; path: string }>;
    assert.ok(
      added.some((s) => s.name === '外部拷入' && path.resolve(s.path) === path.resolve(incoming)),
    );

    // 纳入后应出现在列表里
    const listed = await getJson('/__tb_spaces');
    const names = (listed.spaces as Array<Record<string, unknown>>).map((s) => s.name);
    assert.ok(names.includes('外部拷入'));
  });
});
