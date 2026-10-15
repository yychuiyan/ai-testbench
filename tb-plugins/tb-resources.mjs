/**
 * mcp-resources 子集：列举 + 按 URI 读取本机资源（存储域 / 文档库）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { listStorageDomains } from './storage-domain.mjs';
import { DOC_ROOT_DIRS } from './tb-project-docs.mjs';

const PREFIX = '/__tb_resources';
const DOC_DIRS = Object.values(DOC_ROOT_DIRS).map((d) => d.dirName);
const MAX_READ = 256 * 1024;

function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

function listDocRoots(root) {
  return DOC_DIRS.map((name) => {
    const abs = path.join(root, name);
    let exists = false;
    let entries = 0;
    try {
      if (fs.existsSync(abs) && fs.statSync(abs).isDirectory()) {
        exists = true;
        entries = fs.readdirSync(abs).filter((n) => n !== '.gitkeep').length;
      }
    } catch {
      // ignore
    }
    return {
      uri: `tb://docs/${name}`,
      id: name,
      path: name,
      kind: 'dir',
      roleZh: `文档库 · ${name}`,
      exists,
      size: entries,
    };
  });
}

function listAllResources(root) {
  const domains = listStorageDomains(root).map((d) => ({
    uri: `tb://storage/${d.id}`,
    ...d,
  }));
  const docs = listDocRoots(root);
  return [...domains, ...docs];
}

/**
 * @param {string} root
 * @param {string} uri
 */
export function readResourceByUri(root, uri) {
  const raw = String(uri ?? '').trim();
  if (!raw.startsWith('tb://')) {
    return { ok: false, error: 'uri must start with tb://' };
  }
  const rest = raw.slice('tb://'.length);
  const slash = rest.indexOf('/');
  const scheme = slash < 0 ? rest : rest.slice(0, slash);
  const id = slash < 0 ? '' : rest.slice(slash + 1);

  if (scheme === 'storage') {
    const domains = listStorageDomains(root);
    const d = domains.find((x) => x.id === id);
    if (!d) return { ok: false, error: `unknown storage domain: ${id}` };
    const abs = path.join(root, d.rel);
    if (!fs.existsSync(abs)) {
      return { ok: true, uri: raw, mimeType: 'text/plain', text: '', exists: false, path: d.rel };
    }
    const st = fs.statSync(abs);
    if (st.isDirectory()) {
      const names = fs.readdirSync(abs).slice(0, 200);
      return {
        ok: true,
        uri: raw,
        mimeType: 'application/json',
        text: JSON.stringify({ kind: 'dir', path: d.rel, entries: names }, null, 2),
        exists: true,
        path: d.rel,
      };
    }
    if (st.size > MAX_READ) {
      return {
        ok: false,
        error: `file too large (>${MAX_READ} bytes)`,
        path: d.rel,
        bytes: st.size,
      };
    }
    const buf = fs.readFileSync(abs);
    const isText = !buf.includes(0);
    return {
      ok: true,
      uri: raw,
      mimeType: isText ? 'text/plain' : 'application/octet-stream',
      text: isText ? buf.toString('utf8') : undefined,
      blobBase64: isText ? undefined : buf.toString('base64'),
      exists: true,
      path: d.rel,
      bytes: st.size,
    };
  }

  if (scheme === 'docs') {
    if (!DOC_DIRS.includes(id)) return { ok: false, error: `unknown docs id: ${id}` };
    const abs = path.join(root, id);
    if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) {
      return {
        ok: true,
        uri: raw,
        mimeType: 'application/json',
        text: '[]',
        exists: false,
        path: id,
      };
    }
    const names = fs
      .readdirSync(abs)
      .filter((n) => n !== '.gitkeep')
      .slice(0, 200);
    return {
      ok: true,
      uri: raw,
      mimeType: 'application/json',
      text: JSON.stringify({ kind: 'dir', path: id, entries: names }, null, 2),
      exists: true,
      path: id,
    };
  }

  return { ok: false, error: `unsupported uri scheme: ${scheme}` };
}

/**
 * @returns {import('vite').Plugin}
 */
export function tbResourcesPlugin() {
  return {
    name: 'tb-resources',
    configureServer(server) {
      const root = server.config.root;
      server.middlewares.use(async (req, res, next) => {
        const url = req.url?.split('?')[0] ?? '';
        if (!url.startsWith(PREFIX)) return next();
        try {
          if (url === `${PREFIX}/health` && req.method === 'GET') {
            return sendJson(res, 200, { ok: true });
          }
          if ((url === PREFIX || url === `${PREFIX}/`) && req.method === 'GET') {
            const resources = listAllResources(root);
            return sendJson(res, 200, {
              ok: true,
              count: resources.length,
              resources,
            });
          }
          if (url === `${PREFIX}/read` && req.method === 'GET') {
            const u = new URL(req.url || '', 'http://local');
            const uri = String(u.searchParams.get('uri') || '').trim();
            if (!uri) return sendJson(res, 400, { ok: false, error: 'uri is required' });
            const result = readResourceByUri(root, uri);
            return sendJson(res, result.ok ? 200 : 400, result);
          }
          // MCP 风格：JSON-RPC over POST（resources/list · resources/read）
          if (url === `${PREFIX}/mcp` && req.method === 'POST') {
            const chunks = [];
            for await (const c of req) chunks.push(c);
            let body = {};
            try {
              body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
            } catch {
              return sendJson(res, 400, {
                jsonrpc: '2.0',
                id: null,
                error: { code: -32700, message: 'parse error' },
              });
            }
            const id = body.id ?? null;
            const method = String(body.method ?? '');
            const params = body.params && typeof body.params === 'object' ? body.params : {};
            if (method === 'resources/list') {
              return sendJson(res, 200, {
                jsonrpc: '2.0',
                id,
                result: { resources: listAllResources(root) },
              });
            }
            if (method === 'resources/read') {
              const uri = String(params.uri ?? '').trim();
              const result = readResourceByUri(root, uri);
              if (!result.ok) {
                return sendJson(res, 200, {
                  jsonrpc: '2.0',
                  id,
                  error: { code: -32004, message: result.error || 'read failed' },
                });
              }
              return sendJson(res, 200, {
                jsonrpc: '2.0',
                id,
                result: {
                  contents: [
                    {
                      uri: result.uri,
                      mimeType: result.mimeType,
                      text: result.text,
                      blob: result.blobBase64,
                    },
                  ],
                },
              });
            }
            return sendJson(res, 200, {
              jsonrpc: '2.0',
              id,
              error: { code: -32601, message: `method not found: ${method}` },
            });
          }
          return sendJson(res, 404, { error: 'not found' });
        } catch (e) {
          return sendJson(res, 500, { error: e instanceof Error ? e.message : String(e) });
        }
      });
    },
  };
}
