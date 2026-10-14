// @ts-check
import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import tailwindcss from '@tailwindcss/vite';
import { localMemoryPlugin } from './dev-plugins/local-memory.mjs';
import { localKbPlugin } from './dev-plugins/local-kb.mjs';
import { localFsPlugin } from './dev-plugins/local-fs.mjs';
import { localConfigPlugin } from './dev-plugins/local-config.mjs';
import {
  localCasesPlugin,
  localKnowledgePlugin,
  localPromptsPlugin,
  localRequirementsPlugin,
  localTemplatesPlugin,
} from './dev-plugins/local-project-docs.mjs';

// BASE_PATH 由 GitHub Actions 注入为 /<仓库名>（项目站点子路径），
// 本地开发不设置，默认 '/'
export default defineConfig({
  output: 'static',
  base: process.env.BASE_PATH ?? '/',
  integrations: [react()],
  vite: {
    plugins: [
      tailwindcss(),
      localConfigPlugin(),
      localMemoryPlugin(),
      localKbPlugin(),
      localFsPlugin(),
      localRequirementsPlugin(),
      localCasesPlugin(),
      localTemplatesPlugin(),
      localPromptsPlugin(),
      localKnowledgePlugin(),
    ],
  },
  markdown: {
    shikiConfig: {
      theme: 'github-light',
    },
  },
});
