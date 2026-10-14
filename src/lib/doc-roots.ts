/**
 * 文档根：磁盘为英文目录，界面为中文 label（方案 C）。
 * DocsRoot 英文 id 与 path 一致。
 */
import type { DocsRoot } from './project-docs';

export interface DocRootMeta {
  /** 仓库根下真实目录名（英文） */
  path: string;
  /** 侧栏 / 文案展示名（中文） */
  label: string;
  /** 旧目录名（中文长名 / 短名等），启动时可自动迁移到 path */
  legacyPaths: string[];
}

export const DOC_ROOT_META: Record<DocsRoot, DocRootMeta> = {
  cases: {
    path: 'cases',
    label: '用例管理',
    legacyPaths: ['用例管理', '用例'],
  },
  requirements: {
    path: 'requirements',
    label: '需求文档库',
    legacyPaths: ['需求文档库', '需求'],
  },
  prompts: {
    path: 'prompts',
    label: '提示词管理',
    legacyPaths: ['提示词管理', '提示词'],
  },
  knowledge: {
    path: 'knowledge',
    label: '知识库管理',
    legacyPaths: ['知识库管理', '知识库'],
  },
  templates: {
    path: 'templates',
    label: '测试模板库',
    legacyPaths: ['测试模板库', '模板'],
  },
};

export const DOC_ROOT_ORDER: DocsRoot[] = [
  'requirements',
  'cases',
  'prompts',
  'knowledge',
  'templates',
];

export function docRootLabel(root: DocsRoot): string {
  return DOC_ROOT_META[root]?.label ?? root;
}

/** 展示用中文路径前缀，如「知识库管理/」 */
export function docRootLabelPath(root: DocsRoot): string {
  return `${docRootLabel(root)}/`;
}

/** 磁盘相对路径前缀，如 knowledge/ */
export function docRootFsPrefix(root: DocsRoot): string {
  return `${DOC_ROOT_META[root]?.path ?? root}/`;
}
