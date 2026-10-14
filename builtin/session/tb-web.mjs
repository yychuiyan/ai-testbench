/**
 * 本地网页搜索 / 获取代理：仅 `astro dev` 与 ai-testbench 一体服务可用。
 * 服务端代抓，绕过浏览器 CORS；搜索走 DuckDuckGo HTML。
 */

const PREFIX = '/__tb_web';
const MAX_FETCH = 400_000;
const MAX_TEXT = 24_000;
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 TestBench/0.1';

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

function stripTags(html) {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function decodeBasicEntities(s) {
  return String(s || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

function unwrapDdgHref(href) {
  try {
    const u = new URL(href, 'https://duckduckgo.com');
    const uddg = u.searchParams.get('uddg');
    if (uddg) return decodeURIComponent(uddg);
    if (href.startsWith('http')) return href;
  } catch {
    // ignore
  }
  return href;
}

function isBlockedHost(hostname) {
  const h = String(hostname || '').toLowerCase();
  if (!h) return true;
  if (h === 'localhost' || h.endsWith('.localhost')) return true;
  if (h === '127.0.0.1' || h === '0.0.0.0' || h === '::1') return true;
  if (/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[0-1])\.)/.test(h)) return true;
  if (h.endsWith('.local') || h.endsWith('.internal')) return true;
  return false;
}

async function searchDuckDuckGo(query, maxResults = 8) {
  const q = String(query || '').trim();
  if (!q) return { results: [], error: 'empty query' };
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`;
  const res = await fetch(url, {
    headers: {
      'User-Agent': UA,
      Accept: 'text/html',
    },
    redirect: 'follow',
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) {
    return { results: [], error: `search HTTP ${res.status}` };
  }
  const html = await res.text();
  const results = [];
  const re =
    /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html)) && results.length < maxResults) {
    const href = unwrapDdgHref(decodeBasicEntities(m[1]));
    const title = stripTags(m[2]).slice(0, 200);
    if (!href.startsWith('http') || !title) continue;
    try {
      if (isBlockedHost(new URL(href).hostname)) continue;
    } catch {
      continue;
    }
    results.push({ title, url: href });
  }
  // snippet: nearby result__snippet
  if (results.length) {
    const snipRe =
      /<a[^>]*class="[^"]*result__a[^"]*"[^>]*>[\s\S]*?<\/a>[\s\S]*?(?:class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/(?:a|td|div)>)/gi;
    let i = 0;
    let sm;
    while ((sm = snipRe.exec(html)) && i < results.length) {
      results[i].snippet = stripTags(sm[1]).slice(0, 280);
      i++;
    }
  }
  return { results, provider: 'duckduckgo-html' };
}

async function fetchPage(rawUrl) {
  let parsed;
  try {
    parsed = new URL(String(rawUrl || '').trim());
  } catch {
    return { error: 'invalid url' };
  }
  if (!/^https?:$/i.test(parsed.protocol)) {
    return { error: 'only http/https allowed' };
  }
  if (isBlockedHost(parsed.hostname)) {
    return { error: 'blocked host' };
  }
  const res = await fetch(parsed.toString(), {
    headers: {
      'User-Agent': UA,
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    },
    redirect: 'follow',
    signal: AbortSignal.timeout(25000),
  });
  const ctype = (res.headers.get('content-type') || '').toLowerCase();
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_FETCH) {
    return {
      error: `response too large (>${MAX_FETCH} bytes)`,
      status: res.status,
      url: res.url || parsed.toString(),
    };
  }
  const raw = buf.toString('utf8');
  let title = '';
  const tm = raw.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (tm) title = stripTags(tm[1]).slice(0, 200);
  let text = raw;
  if (ctype.includes('html') || /<html[\s>]/i.test(raw)) {
    text = stripTags(raw);
  }
  if (text.length > MAX_TEXT) text = `${text.slice(0, MAX_TEXT)}\n…(truncated)`;
  return {
    ok: true,
    status: res.status,
    url: res.url || parsed.toString(),
    contentType: ctype,
    title,
    text,
  };
}

/**
 * @returns {import('vite').Plugin}
 */
export function tbWebPlugin() {
  return {
    name: 'tb-web',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = req.url?.split('?')[0] ?? '';
        if (!url.startsWith(PREFIX)) return next();

        try {
          if (url === `${PREFIX}/health` && req.method === 'GET') {
            return sendJson(res, 200, { ok: true, mode: 'proxy', search: 'duckduckgo-html' });
          }

          if (url === `${PREFIX}/search` && req.method === 'POST') {
            const body = JSON.parse((await readBody(req)) || '{}');
            const maxResults = Math.min(12, Math.max(1, Number(body.maxResults) || 8));
            const data = await searchDuckDuckGo(body.query, maxResults);
            return sendJson(res, data.error && !data.results?.length ? 502 : 200, data);
          }

          if (url === `${PREFIX}/fetch` && req.method === 'POST') {
            const body = JSON.parse((await readBody(req)) || '{}');
            const data = await fetchPage(body.url);
            return sendJson(res, data.error && !data.ok ? 400 : 200, data);
          }

          return sendJson(res, 404, { error: 'not found' });
        } catch (e) {
          return sendJson(res, 500, { error: e instanceof Error ? e.message : String(e) });
        }
      });
    },
  };
}
