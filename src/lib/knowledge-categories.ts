/**
 * 知识库分类：本机可增删改。
 */
import { flushAppConfig, getCachedAppConfig, updateAppConfig } from './app-config';
import {
  DEFAULT_KNOWLEDGE_CATEGORIES,
  normalizeKnowledgeCategories,
  type KnowledgeCategory,
} from './knowledge-category-defs';

export type { KnowledgeCategory };
export {
  DEFAULT_KNOWLEDGE_CATEGORIES,
  normalizeKnowledgeCategories,
} from './knowledge-category-defs';

export function listKnowledgeCategories(): KnowledgeCategory[] {
  const fromCfg = getCachedAppConfig().knowledgeCategories;
  if (fromCfg?.length) return [...fromCfg];
  return [...DEFAULT_KNOWLEDGE_CATEGORIES];
}

export function persistKnowledgeCategories(list: KnowledgeCategory[]): KnowledgeCategory[] {
  const normalized = normalizeKnowledgeCategories(list);
  updateAppConfig({ knowledgeCategories: normalized });
  void flushAppConfig();
  return normalized;
}

export function addKnowledgeCategory(label: string): KnowledgeCategory {
  const name = label.trim();
  if (!name) throw new Error('分类名称不能为空');
  if (name.length > 40) throw new Error('分类名称过长（最多 40 字）');
  if (/[\\/]/.test(name)) throw new Error('分类名称不可包含路径分隔符');
  const list = listKnowledgeCategories();
  if (list.includes(name)) throw new Error(`已存在「${name}」`);
  persistKnowledgeCategories([...list, name]);
  return name;
}

export function updateKnowledgeCategory(from: string, to: string): KnowledgeCategory {
  const name = to.trim();
  if (!name) throw new Error('分类名称不能为空');
  if (name.length > 40) throw new Error('分类名称过长（最多 40 字）');
  if (/[\\/]/.test(name)) throw new Error('分类名称不可包含路径分隔符');
  const list = listKnowledgeCategories();
  const idx = list.indexOf(from);
  if (idx < 0) throw new Error('分类不存在');
  if (list.some((x, i) => i !== idx && x === name)) {
    throw new Error(`已存在「${name}」`);
  }
  const copy = [...list];
  copy[idx] = name;
  persistKnowledgeCategories(copy);
  return name;
}

export function removeKnowledgeCategory(name: string): KnowledgeCategory[] {
  const list = listKnowledgeCategories();
  if (list.length <= 1) throw new Error('至少保留一个分类');
  if (!list.includes(name)) throw new Error('分类不存在');
  return persistKnowledgeCategories(list.filter((x) => x !== name));
}
