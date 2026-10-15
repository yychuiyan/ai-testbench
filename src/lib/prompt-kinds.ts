/**
 * 提示词类型：本机可增删改。
 */
import { flushAppConfig, getCachedAppConfig, updateAppConfig } from './app-config';
import {
  DEFAULT_PROMPT_KINDS,
  defaultHintForLabel,
  newPromptKindId,
  normalizePromptKinds,
  type PromptGenKind,
  type PromptKindDef,
} from './prompt-kind-defs';

export type { PromptGenKind, PromptKindDef };
export { DEFAULT_PROMPT_KINDS, normalizePromptKinds } from './prompt-kind-defs';

export function listPromptKinds(): PromptKindDef[] {
  const fromCfg = getCachedAppConfig().promptKinds;
  // 走 normalize：纠正常见旧 hint 文案，并保证结构合法
  return normalizePromptKinds(fromCfg?.length ? fromCfg : DEFAULT_PROMPT_KINDS);
}

export function promptKindMeta(id: PromptGenKind): PromptKindDef {
  const list = listPromptKinds();
  return list.find((o) => o.id === id) ?? list[0] ?? DEFAULT_PROMPT_KINDS[0]!;
}

export function persistPromptKinds(list: PromptKindDef[]): PromptKindDef[] {
  const normalized = normalizePromptKinds(list);
  updateAppConfig({ promptKinds: normalized });
  void flushAppConfig();
  return normalized;
}

export function addPromptKind(label: string): PromptKindDef {
  const name = label.trim();
  if (!name) throw new Error('类型名称不能为空');
  if (name.length > 40) throw new Error('类型名称过长（最多 40 字）');
  const list = listPromptKinds();
  if (list.some((x) => x.label === name)) throw new Error(`已存在「${name}」`);
  const def: PromptKindDef = {
    id: newPromptKindId(),
    label: name,
    hint: defaultHintForLabel(name),
  };
  persistPromptKinds([...list, def]);
  return def;
}

export function updatePromptKind(id: string, label: string): PromptKindDef {
  const name = label.trim();
  if (!name) throw new Error('类型名称不能为空');
  if (name.length > 40) throw new Error('类型名称过长（最多 40 字）');
  const list = listPromptKinds();
  const idx = list.findIndex((x) => x.id === id);
  if (idx < 0) throw new Error('类型不存在');
  if (list.some((x) => x.id !== id && x.label === name)) {
    throw new Error(`已存在「${name}」`);
  }
  const prev = list[idx]!;
  const next: PromptKindDef = {
    ...prev,
    label: name,
    hint: prev.id === 'case' || prev.id === 'general' ? prev.hint : defaultHintForLabel(name),
  };
  const copy = [...list];
  copy[idx] = next;
  persistPromptKinds(copy);
  return next;
}

export function removePromptKind(id: string): PromptKindDef[] {
  const list = listPromptKinds();
  if (list.length <= 1) throw new Error('至少保留一个提示词类型');
  if (!list.some((x) => x.id === id)) throw new Error('类型不存在');
  return persistPromptKinds(list.filter((x) => x.id !== id));
}
