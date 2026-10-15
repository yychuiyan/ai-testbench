/**
 * AI 工作台「生成知识库」插件：会话级配置（面板确认后生效）。
 */
import { listKnowledgeCategories, type KnowledgeCategory } from './knowledge-categories';

export type { KnowledgeCategory };

export interface KnowledgeGenPluginConfig {
  active: boolean;
  category: KnowledgeCategory;
  /** 期望文件名（不含扩展名），可空 */
  titleHint: string;
  /** @deprecated 要求改由主输入框描述；保留字段兼容旧会话 */
  purpose?: string;
  confirmedAt: number;
  /** 本会话最近一次入库相对路径（相对 知识库管理/） */
  linkedKnowledgePath?: string;
}

/** @deprecated 请用 listKnowledgeCategories() */
export const KNOWLEDGE_CATEGORIES: KnowledgeCategory[] = ['测试规范', '方法论', '环境约定'];

export function knowledgeGenConfigLabel(cfg: KnowledgeGenPluginConfig): string {
  const name = cfg.titleHint.trim() || '未命名';
  return `${cfg.category} · ${name}`;
}

export function isKnownKnowledgeCategory(v: string): boolean {
  return listKnowledgeCategories().includes(v);
}
