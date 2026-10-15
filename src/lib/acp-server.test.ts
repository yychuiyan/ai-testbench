import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, describe, it } from 'node:test';

const cli = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../cli/ai-testbench.mjs',
);

function rpcLine(child, req) {
  return new Promise((resolve, reject) => {
    let buf = '';
    const onData = (chunk) => {
      buf += String(chunk);
      const nl = buf.indexOf('\n');
      if (nl < 0) return;
      child.stdout.off('data', onData);
      try {
        resolve(JSON.parse(buf.slice(0, nl)));
      } catch (e) {
        reject(e);
      }
    };
    child.stdout.on('data', onData);
    child.stdin.write(`${JSON.stringify(req)}\n`);
    setTimeout(() => {
      child.stdout.off('data', onData);
      reject(new Error('rpc timeout'));
    }, 5000);
  });
}

describe('acp-server cli', () => {
  let tmp = '';

  before(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tb-acp-'));
    fs.mkdirSync(path.join(tmp, 'config'), { recursive: true });
    fs.mkdirSync(path.join(tmp, '.local'), { recursive: true });
    fs.writeFileSync(
      path.join(tmp, 'config', 'app.defaults.json'),
      JSON.stringify({ version: 1, model: { activeId: '', providers: [] } }),
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
              model: 'demo',
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

  it('initialize and session/new over stdio', async () => {
    const child = spawn(process.execPath, [cli, 'acp', '--dir', tmp], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    try {
      const init = await rpcLine(child, {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
      });
      assert.equal(init.result?.protocolVersion, 1);
      assert.equal(init.result?.serverInfo?.name, 'ai-testbench-acp');
      assert.equal(init.result?.capabilities?.tools, true);

      const created = await rpcLine(child, {
        jsonrpc: '2.0',
        id: 2,
        method: 'session/new',
      });
      assert.ok(created.result?.sessionId);

      const shut = await rpcLine(child, {
        jsonrpc: '2.0',
        id: 3,
        method: 'shutdown',
      });
      assert.equal(shut.result?.ok, true);
    } finally {
      child.kill('SIGTERM');
    }
  });
});
