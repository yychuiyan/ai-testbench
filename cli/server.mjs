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
import { tbSpacesPlugin } from '../builtin/session/tb-spaces.mjs';
import { ensureSpaceContext, getDataRoot } from '../builtin/session/space-context.mjs';
import { prepareSpacesRoot } from './data-root.mjs';
import {
  tbCasesPlugin,
  tbKnowledgePlugin,
  tbPromptsPlugin,
  tbRequirementsPlugin,
  tbTemplatesPlugin,
} from '../tb-plugins/tb-project-docs.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const PKG_ROOT = path.resolve(__dirname, '..');
export const DIST_DIR = path.join(PKG_ROOT, 'dist');

// 数据根初始化已抽到 `cli/data-root.mjs`（tb-spaces 插件也要用，避免循环依赖）；
// 这里继续对外导出，保持既有调用方不受影响。
export { prepareSpacesRoot, prepareSpaceDir } from './data-root.mjs';

function attachPlugins(app, dataRoot) {
  // 数据空间上下文：所有插件通过 getDataRoot() 惰性取根，切换空间无需重启
  ensureSpaceContext(dataRoot);
  const fakeServer = {
    config: { root: dataRoot },
    middlewares: app,
  };
  const plugins = [
    tbSessionRunsPlugin(),
    tbSpacesPlugin(),
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
 * `opts.dataRoot` 是池根（tbench 记住的数据目录）：公共空间在 `<池根>/公共空间`。
 * @returns {Promise<{ url: string, server: http.Server, dataRoot: string }>} dataRoot 为当前生效的空间目录
 */
export function startLocalServer(opts) {
  const spacesRoot = prepareSpacesRoot(opts.dataRoot);
  const host = opts.host ?? '127.0.0.1';
  const port = Number(opts.port) || 4321;

  if (!fs.existsSync(DIST_DIR) || !fs.existsSync(path.join(DIST_DIR, 'index.html'))) {
    throw new Error(
      `未找到构建产物 dist/。请先在仓库执行 pnpm build，或重新安装 ai-testbench 包。\n路径：${DIST_DIR}`,
    );
  }

  const app = connect();
  attachPlugins(app, spacesRoot);

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
      resolve({ url, server, dataRoot: getDataRoot() });
    });
  });
}
