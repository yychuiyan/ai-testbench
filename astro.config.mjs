// @ts-check
import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import tailwindcss from '@tailwindcss/vite';
import { tbMemoryPlugin } from './tb-plugins/tb-memory.mjs';
import { tbKbPlugin } from './tb-plugins/tb-kb.mjs';
import { tbBashPlugin } from './builtin/session/tb-bash.mjs';
import { tbFsPlugin } from './builtin/session/tb-fs.mjs';
import { tbWebPlugin } from './builtin/session/tb-web.mjs';
import { tbConfigPlugin } from './tb-plugins/tb-config.mjs';
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
  /** 开发环境右下角 Astro 工具条（审计/设置等） */
  devToolbar: { enabled: false },
  /** 站内链接悬停预取，配合 ClientRouter 减少「每次整页重载」感 */
  prefetch: {
    prefetchAll: true,
    defaultStrategy: 'hover',
  },
  integrations: [react()],
  vite: {
    plugins: [
      tailwindcss(),
      tbConfigPlugin(),
      tbMemoryPlugin(),
      tbKbPlugin(),
      tbFsPlugin(),
      tbBashPlugin(),
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
