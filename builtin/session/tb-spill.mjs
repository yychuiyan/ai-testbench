/**
 * 过大内容溢出落盘：`.tb/local/spill/<id>.txt`
 * HTTP：`/__tb_spill`
 */
import fs from 'node:fs';
import path from 'node:path';

import { getDataRoot } from './space-context.mjs';
import { LOCAL_REL } from './space-layout.mjs';

const PREFIX = '/__tb_spill';
const MAX_BYTES = 2_000_000;
const MAX_FILES = 200;
/** 溢出缓存的 posix 相对路径（同时用于落盘校验与前端展示） */
const SPILL_REL = `${LOCAL_REL}/spill`;

function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function spillDir(root) {
  return path.join(root, LOCAL_REL, 'spill');
}

function uid() {
  return `sp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function pruneOld(dir) {
  try {
    const names = fs
      .readdirSync(dir)
      .filter((n) => n.endsWith('.txt'))
      .map((n) => {
        const fp = path.join(dir, n);
        let mtime = 0;
        try {
          mtime = fs.statSync(fp).mtimeMs;
        } catch {
          // ignore
        }
        return { n, fp, mtime };
      })
      .sort((a, b) => b.mtime - a.mtime);
    for (const item of names.slice(MAX_FILES)) {
      try {
        fs.unlinkSync(item.fp);
      } catch {
        // ignore
      }
    }
  } catch {
    // ignore
  }
}

/**
 * @returns {import('vite').Plugin}
 */
export function tbSpillPlugin() {
  return {
    name: 'tb-spill',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = req.url?.split('?')[0] ?? '';
        if (!url.startsWith(PREFIX)) return next();
        // 数据根惰性读取：切换数据空间后无需重启即可生效
        const root = getDataRoot();

        try {
          if (url === `${PREFIX}/health` && req.method === 'GET') {
            return sendJson(res, 200, { ok: true, mode: 'file', dir: SPILL_REL });
          }

          if (url === `${PREFIX}/write` && req.method === 'POST') {
            const body = JSON.parse((await readBody(req)) || '{}');
            const content = String(body.content ?? '');
            const label = String(body.label ?? 'spill')
              .replace(/[^\w.\-]+/g, '_')
              .slice(0, 40);
            if (!content) return sendJson(res, 400, { ok: false, error: 'content required' });
            const buf = Buffer.from(content, 'utf8');
            if (buf.length > MAX_BYTES) {
              return sendJson(res, 413, {
                ok: false,
                error: `content exceeds ${MAX_BYTES} bytes`,
              });
            }
            const dir = spillDir(root);
            fs.mkdirSync(dir, { recursive: true });
            const id = uid();
            const name = `${id}_${label || 'spill'}.txt`;
            const fp = path.join(dir, name);
            fs.writeFileSync(fp, buf);
            pruneOld(dir);
            const rel = path.join(SPILL_REL, name).replace(/\\/g, '/');
            return sendJson(res, 200, {
              ok: true,
              id,
              path: rel,
              absPath: fp,
              bytes: buf.length,
            });
          }

          if (url === `${PREFIX}/read` && req.method === 'POST') {
            const body = JSON.parse((await readBody(req)) || '{}');
            const rel = String(body.path ?? '')
              .replace(/\\/g, '/')
              .trim();
            if (!rel.startsWith(`${SPILL_REL}/`) || rel.includes('..')) {
              return sendJson(res, 400, { ok: false, error: 'invalid path' });
            }
            const fp = path.join(root, rel);
            if (!fs.existsSync(fp)) return sendJson(res, 404, { ok: false, error: 'not found' });
            const text = fs.readFileSync(fp, 'utf8');
            return sendJson(res, 200, { ok: true, path: rel, content: text, bytes: text.length });
          }

          return sendJson(res, 404, { error: 'not found' });
        } catch (e) {
          return sendJson(res, 500, { error: e instanceof Error ? e.message : String(e) });
        }
      });
    },
  };
}
