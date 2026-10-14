/**
 * 提示词类型数据结构（无 app-config 依赖）。
 */
export type PromptGenKind = string;

export interface PromptKindDef {
  id: string;
  label: string;
  /** 写入生成系统提示的类型说明 */
  hint: string;
}

export const DEFAULT_PROMPT_KINDS: PromptKindDef[] = [
  {
    id: 'case',
    label: '用例生成提示词',
    hint: '生成「测试用例生成」类提示词：指导模型按需求与模板输出可入库用例；须约束输出 JSON 结构、字段对齐模板、步骤换行、覆盖策略等；不要限定固定用例条数。',
  },
  {
    id: 'general',
    label: '通用提示词',
    hint: '生成通用测试/工作台提示词：角色、输出风格、约束清晰，可直接作为系统或任务提示词使用。',
  },
];

function uid(): string {
  return `pk_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

export function defaultHintForLabel(label: string): string {
  const name = label.trim() || '自定义';
  return `生成「${name}」类提示词：角色、输出风格与约束清晰，可直接作为系统或任务提示词使用。`;
}

export function normalizePromptKindDef(raw: unknown): PromptKindDef | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const label = String(o.label ?? '').trim();
  if (!label) return null;
  const id = String(o.id ?? '').trim() || uid();
  const hint =
    typeof o.hint === 'string' && o.hint.trim() ? o.hint.trim() : defaultHintForLabel(label);
  return { id, label, hint };
}

export function normalizePromptKinds(raw: unknown): PromptKindDef[] {
  if (!Array.isArray(raw)) return DEFAULT_PROMPT_KINDS.map((x) => ({ ...x }));
  const out: PromptKindDef[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    const def = normalizePromptKindDef(item);
    if (!def || seen.has(def.id)) continue;
    seen.add(def.id);
    out.push(def);
  }
  return out.length ? out : DEFAULT_PROMPT_KINDS.map((x) => ({ ...x }));
}

export function newPromptKindId(): string {
  return uid();
}
