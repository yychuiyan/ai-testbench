/**
 * 本地知识库 / 模板检索（仿 dsh kb-sieve 能力子集）：
 * 仅 `astro dev` / 本地一体服务可用。知识库跨空间共用（公共空间），模板仍跟当前空间。
 */
import fs from 'node:fs';
import path from 'node:path';

import { getDataRoot, getPublicSpaceRoot } from '../builtin/session/space-context.mjs';
import { DOC_ROOT_DIRS } from './tb-project-docs.mjs';

const PREFIX = '/__tb_kb';
const ROOTS = [DOC_ROOT_DIRS.knowledge.dirName, DOC_ROOT_DIRS.templates.dirName];
const MAX_RESULTS = 12;
const SNIPPET_LEN = 180;
const MAX_READ_CHARS = 24_000;

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

function walkMd(absDir, relRoot, out) {
  if (!fs.existsSync(absDir)) return;
  for (const name of fs.readdirSync(absDir)) {
    if (name.startsWith('.')) continue;
    const abs = path.join(absDir, name);
    const rel = path.posix.join(relRoot, name.split(path.sep).join('/'));
    const st = fs.statSync(abs);
    if (st.isDirectory()) walkMd(abs, rel, out);
    else if (st.isFile() && name.endsWith('.md')) out.push({ abs, rel });
  }
}

function parseFrontmatter(raw) {
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return { title: '', body: raw, description: '' };
  const fm = m[1];
  const body = m[2] ?? '';
  const title = (fm.match(/^title:\s*(.+)$/m)?.[1] ?? '').replace(/^['"]|['"]$/g, '').trim();
  const description = (fm.match(/^description:\s*(.+)$/m)?.[1] ?? '')
    .replace(/^['"]|['"]$/g, '')
    .trim();
  const category = (fm.match(/^category:\s*(.+)$/m)?.[1] ?? '').replace(/^['"]|['"]$/g, '').trim();
  return { title, description, category, body };
}

function rootForKbTop(top) {
  return top === DOC_ROOT_DIRS.knowledge.dirName ? getPublicSpaceRoot() : getDataRoot();
}

function listDocs() {
  const files = [];
  for (const root of ROOTS) {
    walkMd(path.join(rootForKbTop(root), root), root, files);
  }
  return files.map(({ abs, rel }) => {
    let raw = '';
    try {
      raw = fs.readFileSync(abs, 'utf8');
    } catch {
      raw = '';
    }
    const meta = parseFrontmatter(raw);
    return {
      path: rel,
      title: meta.title || path.basename(rel, '.md'),
      description: meta.description || '',
      category: meta.category || '',
      body: meta.body,
      raw,
    };
  });
}

function safeRelPath(rel) {
  const n = String(rel ?? '')
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .trim();
  if (!n || n.includes('..') || n.includes('\0')) return null;
  const top = n.split('/')[0];
  if (!ROOTS.includes(top)) return null;
  if (!n.endsWith('.md')) return null;
  return n;
}

/**
 * @returns {import('vite').Plugin}
 */
export function tbKbPlugin() {
  return {
    name: 'tb-kb',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = req.url?.split('?')[0] ?? '';
        if (!url.startsWith(PREFIX)) return next();

        try {
          if (url === `${PREFIX}/health` && req.method === 'GET') {
            const docs = listDocs();
            return sendJson(res, 200, {
              ok: true,
              mode: 'fs',
              roots: ROOTS,
              docCount: docs.length,
            });
          }

          if (url === `${PREFIX}/search` && req.method === 'POST') {
            const body = JSON.parse((await readBody(req)) || '{}');
            const q = String(body.query ?? '')
              .trim()
              .toLowerCase();
            const scope = String(body.scope ?? 'all').toLowerCase();
            const docs = listDocs().filter((d) => {
              if (scope === 'knowledge')
                return d.path.startsWith(`${DOC_ROOT_DIRS.knowledge.dirName}/`);
              if (scope === 'templates')
                return d.path.startsWith(`${DOC_ROOT_DIRS.templates.dirName}/`);
              return true;
            });
            if (!q) {
              return sendJson(res, 200, {
                results: docs.slice(0, MAX_RESULTS).map((d) => ({
                  path: d.path,
                  title: d.title,
                  category: d.category,
                  description: d.description,
                  snippet: (d.description || d.body).slice(0, SNIPPET_LEN),
                })),
                query: body.query,
              });
            }
            const scored = [];
            for (const d of docs) {
              const hay = [d.path, d.title, d.category, d.description, d.body]
                .join('\n')
                .toLowerCase();
              const idx = hay.indexOf(q);
              if (idx < 0) continue;
              const fromBody = d.body.toLowerCase().indexOf(q);
              let snippet = d.description || '';
              if (fromBody >= 0) {
                const start = Math.max(0, fromBody - 40);
                snippet = d.body.slice(start, start + SNIPPET_LEN).replace(/\s+/g, ' ');
              } else if (!snippet) {
                snippet = d.body.slice(0, SNIPPET_LEN).replace(/\s+/g, ' ');
              }
              scored.push({
                path: d.path,
                title: d.title,
                category: d.category,
                description: d.description,
                snippet,
                score: idx,
              });
            }
            scored.sort((a, b) => a.score - b.score);
            return sendJson(res, 200, {
              results: scored.slice(0, MAX_RESULTS).map(({ score: _s, ...rest }) => rest),
              query: body.query,
            });
          }

          if (url === `${PREFIX}/read` && req.method === 'POST') {
            const body = JSON.parse((await readBody(req)) || '{}');
            const rel = safeRelPath(body.path);
            if (!rel) return sendJson(res, 400, { error: 'invalid path' });
            const abs = path.join(rootForKbTop(rel.split('/')[0]), ...rel.split('/'));
            if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
              return sendJson(res, 404, { error: 'not found', path: rel });
            }
            const raw = fs.readFileSync(abs, 'utf8');
            const meta = parseFrontmatter(raw);
            const truncated = raw.length > MAX_READ_CHARS;
            return sendJson(res, 200, {
              path: rel,
              title: meta.title || path.basename(rel, '.md'),
              category: meta.category || '',
              description: meta.description || '',
              content: truncated ? raw.slice(0, MAX_READ_CHARS) : raw,
              truncated,
              chars: raw.length,
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
