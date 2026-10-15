// @ts-check
import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import tailwindcss from '@tailwindcss/vite';
import { tbMemoryPlugin } from './tb-plugins/tb-memory.mjs';
import { tbKbPlugin } from './tb-plugins/tb-kb.mjs';
import { tbBashPlugin } from './builtin/session/tb-bash.mjs';
import { tbFsPlugin } from './builtin/session/tb-fs.mjs';
import { tbSchedulePlugin } from './builtin/session/tb-schedule.mjs';
import { tbSpillPlugin } from './builtin/session/tb-spill.mjs';
import { tbWebPlugin } from './builtin/session/tb-web.mjs';
import { tbSessionRunsPlugin } from './builtin/session/session-runs.mjs';
import { tbConfigPlugin } from './tb-plugins/tb-config.mjs';
import { tbResourcesPlugin } from './tb-plugins/tb-resources.mjs';
import {
  tbCasesPlugin,
  tbKnowledgePlugin,
  tbPromptsPlugin,
  tbRequirementsPlugin,
  tbTemplatesPlugin,
} from './tb-plugins/tb-project-docs.mjs';

// BASE_PATH 由 GitHub Actions 注入为 /<仓库名>（项目站点子路径），
// 本地开发不设置，默认 '/'
export default defineConfig({
  output: 'static',
  base: process.env.BASE_PATH ?? '/',
  /** 开发环境固定 IPv4，避免只监听 [::1] 导致 127.0.0.1 / 回环工具失败 */
  server: {
    host: '127.0.0.1',
    port: 4321,
  },
  /** 开发环境右下角 Astro 工具条（审计/设置等） */
  devToolbar: { enabled: false },
  /** 站内链接悬停预取，配合 ClientRouter 减少「每次整页重载」感 */
  prefetch: {
    prefetchAll: true,
    defaultStrategy: 'hover',
  },
  integrations: [react()],
  vite: {
    server: {
      watch: {
        // 业务内容目录由库页 API 自刷新；监听它们会在增删文件时整页 HMR
        ignored: [
          '**/AGENTS.md',
          '**/AGENTS.local.md',
          '**/CLAUDE.md',
          '**/CLAUDE.local.md',
          '**/.local/**',
          '**/用例管理/**',
          '**/知识库管理/**',
          '**/提示词管理/**',
          '**/需求文档库/**',
          '**/测试模板库/**',
        ],
      },
    },
    plugins: [
      tailwindcss(),
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
    ],
  },
  markdown: {
    shikiConfig: {
      theme: 'github-light',
    },
  },
});
