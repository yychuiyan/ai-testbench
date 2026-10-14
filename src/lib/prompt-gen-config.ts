/**
 * AI 工作台「生成提示词」插件：会话级配置（面板确认后生效，发送时注入）。
 */
import { promptKindMeta, type PromptGenKind } from './prompt-kinds';

export type { PromptGenKind };

export interface PromptGenPluginConfig {
  active: boolean;
  /** 期望文件名（不含扩展名），可空——由模型在结果里给出 */
  titleHint: string;
  /** @deprecated 要求改由主输入框描述；保留字段兼容旧会话 */
  purpose?: string;
  kind: PromptGenKind;
  confirmedAt: number;
  /** 本会话最近一次入库的提示词相对路径 */
  linkedPromptPath?: string;
}

export function promptGenConfigLabel(cfg: PromptGenPluginConfig): string {
  const kindLabel = promptKindMeta(cfg.kind).label;
  const name = cfg.titleHint.trim() || '未命名';
  return `${kindLabel} · ${name}`;
}
