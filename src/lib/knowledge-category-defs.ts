/**
 * 知识库分类数据结构（无 app-config 依赖）。
 */
export type KnowledgeCategory = string;

export const DEFAULT_KNOWLEDGE_CATEGORIES: KnowledgeCategory[] = ['测试规范', '方法论', '环境约定'];

export function normalizeKnowledgeCategories(raw: unknown): KnowledgeCategory[] {
  if (!Array.isArray(raw)) return [...DEFAULT_KNOWLEDGE_CATEGORIES];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    const name = String(item ?? '').trim();
    if (!name || name.length > 40 || seen.has(name)) continue;
    seen.add(name);
    out.push(name);
  }
  return out.length ? out : [...DEFAULT_KNOWLEDGE_CATEGORIES];
}
