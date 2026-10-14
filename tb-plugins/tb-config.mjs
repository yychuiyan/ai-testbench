/**
 * 本地应用配置 + 会话历史：
 * - 默认：`config/app.defaults.json`（进仓库，绝不含 apiKey）
 * - 本地：`.local/app.config.json`（gitignore；可含 apiKey，页面改动自动写回）
 * - Key 优先级：`.env` 的 TW_API_KEY > 当前激活提供商 providers[].apiKey > 旧 model.apiKey
 * - 会话：`.local/sessions.json`
 * - 用例套件：`.local/case-suites.json`
 * `astro dev` 与 `ai-testbench` CLI 本地服务均可。
 */
import fs from 'node:fs';
import path from 'node:path';

const PREFIX = '/__tb_config';
const SESS_PREFIX = '/__tb_sessions';
const CASES_PREFIX = '/__tb_case_suites';
const CASE_SESS_PREFIX = '/__tb_case_sessions';

/** 轻量读取数据目录下 `.env`（不依赖 vite，供 CLI 本地服务使用） */
function loadDotEnv(root) {
  const out = {};
  try {
    const fp = path.join(root, '.env');
    if (!fs.existsSync(fp)) return out;
    for (const line of fs.readFileSync(fp, 'utf8').split(/\r?\n/)) {
      const t = line.trim();
      if (!t || t.startsWith('#')) continue;
      const i = t.indexOf('=');
      if (i <= 0) continue;
      const key = t.slice(0, i).trim();
      let val = t.slice(i + 1).trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      out[key] = val;
    }
  } catch {
    // ignore
  }
  return out;
}

function defaultsPath(root) {
  return path.join(root, 'config', 'app.defaults.json');
}

function localConfigPath(root) {
  return path.join(root, '.local', 'app.config.json');
}

function sessionsPath(root) {
  return path.join(root, '.local', 'sessions.json');
}

function caseSuitesPath(root) {
  return path.join(root, '.local', 'case-suites.json');
}

function caseSessionsPath(root) {
  return path.join(root, '.local', 'case-sessions.json');
}

function readJson(fp, fallback) {
  try {
    if (!fs.existsSync(fp)) return fallback;
    return JSON.parse(fs.readFileSync(fp, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(fp, data) {
  fs.mkdirSync(path.dirname(fp), { recursive: true });
  fs.writeFileSync(fp, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

function deepMerge(base, over) {
  if (!over || typeof over !== 'object' || Array.isArray(over)) return over ?? base;
  const out = { ...base };
  for (const [k, v] of Object.entries(over)) {
    if (
      v &&
      typeof v === 'object' &&
      !Array.isArray(v) &&
      base?.[k] &&
      typeof base[k] === 'object'
    ) {
      out[k] = deepMerge(base[k], v);
    } else if (v !== undefined) {
      out[k] = v;
    }
  }
  return out;
}

/** 合并 defaults：本地缺省字段用 defaults 补齐；providers 整表以本地为准（含 apiKey） */
function mergeWithDefaults(defaults, local) {
  const safeDefaults = structuredClone(defaults);
  if (safeDefaults.model && typeof safeDefaults.model === 'object') {
    delete safeDefaults.model.apiKey;
    if (Array.isArray(safeDefaults.model.providers)) {
      safeDefaults.model.providers = safeDefaults.model.providers.map((p) => {
        if (!p || typeof p !== 'object') return p;
        const { apiKey: _k, ...rest } = p;
        return rest;
      });
    }
  }
  const localModel = local?.model && typeof local.model === 'object' ? local.model : null;
  const merged = deepMerge(safeDefaults, local && typeof local === 'object' ? local : {});
  const dPlugins =
    safeDefaults.plugins && typeof safeDefaults.plugins === 'object' ? safeDefaults.plugins : {};
  const lPlugins = merged.plugins && typeof merged.plugins === 'object' ? merged.plugins : {};
  merged.plugins = { ...dPlugins, ...lPlugins };
  for (const [id, enabled] of Object.entries(dPlugins)) {
    if (typeof lPlugins[id] !== 'boolean') merged.plugins[id] = enabled;
  }
  if (!merged.model || typeof merged.model !== 'object')
    merged.model = { providers: [], activeId: '' };
  // providers 数组不要被 deepMerge 搞乱：有本地则整段替换
  if (localModel && Array.isArray(localModel.providers)) {
    merged.model.providers = localModel.providers;
    if (typeof localModel.activeId === 'string') merged.model.activeId = localModel.activeId;
  } else if (!Array.isArray(merged.model.providers)) {
    merged.model.providers = [];
  }
  merged.version = safeDefaults.version ?? 1;
  return merged;
}

function ensureLocalConfig(root) {
  const defaults = readJson(defaultsPath(root), null);
  if (!defaults) {
    throw new Error('缺少 config/app.defaults.json');
  }
  const fp = localConfigPath(root);
  let local = readJson(fp, null);
  if (!local) {
    local = structuredClone(defaults);
    writeJson(fp, local);
  } else {
    const merged = mergeWithDefaults(defaults, local);
    // 若补了新字段则写回
    if (JSON.stringify(merged) !== JSON.stringify(local)) {
      writeJson(fp, merged);
      local = merged;
    }
  }
  return mergeWithDefaults(defaults, local);
}

function readApiKey(root, localConfig) {
  const env = loadDotEnv(root);
  const fromEnv = String(env.TW_API_KEY ?? process.env.TW_API_KEY ?? '').trim();
  if (fromEnv) return fromEnv;
  const providers = localConfig?.model?.providers;
  const activeId = localConfig?.model?.activeId;
  if (Array.isArray(providers) && providers.length) {
    const active = providers.find((p) => p && p.id === activeId) ?? providers[0];
    if (active && typeof active.apiKey === 'string' && active.apiKey.trim()) {
      return active.apiKey.trim();
    }
  }
  if (localConfig?.model && typeof localConfig.model.apiKey === 'string') {
    return localConfig.model.apiKey.trim();
  }
  return '';
}

function sanitizeForLocalWrite(config) {
  return structuredClone(config);
}

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

/**
 * @returns {import('vite').Plugin}
 */
export function tbConfigPlugin() {
  return {
    name: 'tb-config',
    configureServer(server) {
      const root = server.config.root;
      server.middlewares.use(async (req, res, next) => {
        const url = req.url?.split('?')[0] ?? '';

        try {
          if (url === `${PREFIX}/health` && req.method === 'GET') {
            return sendJson(res, 200, { ok: true, mode: 'file' });
          }

          if (url === PREFIX && req.method === 'GET') {
            const config = ensureLocalConfig(root);
            return sendJson(res, 200, {
              ok: true,
              config,
              apiKey: readApiKey(root, config),
              paths: {
                defaults: defaultsPath(root),
                local: localConfigPath(root),
              },
            });
          }

          if (url === PREFIX && req.method === 'PUT') {
            const body = JSON.parse((await readBody(req)) || '{}');
            const defaults = readJson(defaultsPath(root), {});
            const incoming = body.config ?? body;
            const merged = sanitizeForLocalWrite(mergeWithDefaults(defaults, incoming));
            writeJson(localConfigPath(root), merged);
            return sendJson(res, 200, {
              ok: true,
              config: merged,
              apiKey: readApiKey(root, merged),
            });
          }

          if (url === SESS_PREFIX && req.method === 'GET') {
            const store = readJson(sessionsPath(root), null);
            return sendJson(res, 200, { ok: true, store });
          }

          if (url === SESS_PREFIX && req.method === 'PUT') {
            const body = JSON.parse((await readBody(req)) || '{}');
            const store = body.store ?? body;
            if (!store || !Array.isArray(store.sessions)) {
              return sendJson(res, 400, { error: 'invalid store' });
            }
            writeJson(sessionsPath(root), {
              sessions: store.sessions,
              activeId: store.activeId ?? store.sessions[0]?.id ?? '',
            });
            return sendJson(res, 200, { ok: true });
          }

          if (url === CASES_PREFIX && req.method === 'GET') {
            const store = readJson(caseSuitesPath(root), { suites: [] });
            return sendJson(res, 200, { ok: true, store });
          }

          if (url === CASES_PREFIX && req.method === 'PUT') {
            const body = JSON.parse((await readBody(req)) || '{}');
            const store = body.store ?? body;
            if (!store || !Array.isArray(store.suites)) {
              return sendJson(res, 400, { error: 'invalid store' });
            }
            writeJson(caseSuitesPath(root), { suites: store.suites });
            return sendJson(res, 200, { ok: true });
          }

          if (url === CASE_SESS_PREFIX && req.method === 'GET') {
            const store = readJson(caseSessionsPath(root), { sessions: [], activeId: '' });
            return sendJson(res, 200, { ok: true, store });
          }

          if (url === CASE_SESS_PREFIX && req.method === 'PUT') {
            const body = JSON.parse((await readBody(req)) || '{}');
            const store = body.store ?? body;
            if (!store || !Array.isArray(store.sessions)) {
              return sendJson(res, 400, { error: 'invalid store' });
            }
            writeJson(caseSessionsPath(root), {
              sessions: store.sessions,
              activeId: store.activeId ?? store.sessions[0]?.id ?? '',
            });
            return sendJson(res, 200, { ok: true });
          }

          if (
            url.startsWith(PREFIX) ||
            url.startsWith(SESS_PREFIX) ||
            url.startsWith(CASES_PREFIX) ||
            url.startsWith(CASE_SESS_PREFIX)
          ) {
            return sendJson(res, 404, { error: 'not found' });
          }
          return next();
        } catch (e) {
          return sendJson(res, 500, { error: e instanceof Error ? e.message : String(e) });
        }
      });
    },
  };
}
