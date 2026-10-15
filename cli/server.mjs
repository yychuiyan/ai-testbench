/**
 * 本地一体服务：静态 dist + 现有 Vite 本地中间件（/__tb_*）。
 */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import connect from 'connect';
import sirv from 'sirv';

import { tbConfigPlugin } from '../tb-plugins/tb-config.mjs';
import { tbBashPlugin } from '../builtin/session/tb-bash.mjs';
import { tbFsPlugin } from '../builtin/session/tb-fs.mjs';
import { tbSchedulePlugin } from '../builtin/session/tb-schedule.mjs';
import { tbSpillPlugin } from '../builtin/session/tb-spill.mjs';
import { tbKbPlugin } from '../tb-plugins/tb-kb.mjs';
import { tbMemoryPlugin } from '../tb-plugins/tb-memory.mjs';
import { tbResourcesPlugin } from '../tb-plugins/tb-resources.mjs';
import { tbWebPlugin } from '../builtin/session/tb-web.mjs';
import { tbSessionRunsPlugin } from '../builtin/session/session-runs.mjs';
import {
  DOC_ROOT_DIRS,
  migrateLegacyRoot,
  tbCasesPlugin,
  tbKnowledgePlugin,
  tbPromptsPlugin,
  tbRequirementsPlugin,
  tbTemplatesPlugin,
} from '../tb-plugins/tb-project-docs.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const PKG_ROOT = path.resolve(__dirname, '..');
export const DIST_DIR = path.join(PKG_ROOT, 'dist');
const PKG_DEFAULTS = path.join(PKG_ROOT, 'config', 'app.defaults.json');

/** 确保数据目录具备默认配置与文档根（不覆盖已有文件；旧英文目录先迁移） */
export function prepareDataRoot(dataRoot) {
  const root = path.resolve(dataRoot);
  fs.mkdirSync(root, { recursive: true });
  fs.mkdirSync(path.join(root, '.local'), { recursive: true });
  fs.mkdirSync(path.join(root, 'config'), { recursive: true });

  const destDefaults = path.join(root, 'config', 'app.defaults.json');
  if (!fs.existsSync(destDefaults)) {
    if (!fs.existsSync(PKG_DEFAULTS)) {
      throw new Error(`缺少包内默认配置：${PKG_DEFAULTS}`);
    }
    fs.copyFileSync(PKG_DEFAULTS, destDefaults);
  }

  for (const { dirName, legacyDirNames } of Object.values(DOC_ROOT_DIRS)) {
    // 必须先迁移：一旦先建出中文目录，旧目录里的文件就再也不会被搬过来
    migrateLegacyRoot(root, legacyDirNames, dirName);
    const dir = path.join(root, dirName);
    fs.mkdirSync(dir, { recursive: true });
    const keep = path.join(dir, '.gitkeep');
    if (!fs.existsSync(keep)) fs.writeFileSync(keep, '', 'utf8');
  }

  return root;
}

function attachPlugins(app, dataRoot) {
  const fakeServer = {
    config: { root: dataRoot },
    middlewares: app,
  };
  const plugins = [
    tbSessionRunsPlugin(),
    tbConfigPlugin(),
    tbResourcesPlugin(),
    tbMemoryPlugin(),
    tbKbPlugin(),
    tbFsPlugin(),
    tbBashPlugin(),
    tbSchedulePlugin(),
    tbSpillPlugin(),
    tbWebPlugin(),
    tbRequirementsPlugin(),
    tbCasesPlugin(),
    tbTemplatesPlugin(),
    tbPromptsPlugin(),
    tbKnowledgePlugin(),
  ];
  for (const plugin of plugins) {
    if (typeof plugin.configureServer === 'function') {
      plugin.configureServer(fakeServer);
    }
  }
}

/**
 * @param {{ dataRoot: string, host?: string, port?: number }} opts
 * @returns {Promise<{ url: string, server: http.Server, dataRoot: string }>}
 */
export function startLocalServer(opts) {
  const dataRoot = prepareDataRoot(opts.dataRoot);
  const host = opts.host ?? '127.0.0.1';
  const port = Number(opts.port) || 4321;

  if (!fs.existsSync(DIST_DIR) || !fs.existsSync(path.join(DIST_DIR, 'index.html'))) {
    throw new Error(
      `未找到构建产物 dist/。请先在仓库执行 pnpm build，或重新安装 ai-testbench 包。\n路径：${DIST_DIR}`,
    );
  }

  const app = connect();
  attachPlugins(app, dataRoot);

  const staticHandler = sirv(DIST_DIR, {
    dev: false,
    etag: true,
    single: false,
  });
  app.use((req, res, next) => {
    // API 未命中时走静态；sirv 404 时 next
    staticHandler(req, res, next);
  });
  app.use((_req, res) => {
    res.statusCode = 404;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.end('Not Found');
  });

  const server = http.createServer(app);

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      const url = `http://${host}:${port}/`;
      resolve({ url, server, dataRoot });
    });
  });
}
