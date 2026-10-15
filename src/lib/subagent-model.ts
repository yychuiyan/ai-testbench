/**
 * subagent-model-selection-settings：解析子代理使用的模型。
 */
import type { LLMSettings } from './settings';

/** 空 / inherit → 跟随主会话模型 */
export function resolveSubagentSettings(
  parent: LLMSettings,
  subagentModel?: string | null,
): LLMSettings {
  const m = String(subagentModel ?? '').trim();
  if (!m || m === 'inherit' || m === parent.model) return parent;
  return { ...parent, model: m };
}
