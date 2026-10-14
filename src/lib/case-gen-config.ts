/**
 * AI 工作台「用例生成」插件：会话级配置（面板确认后生效，发送时注入）。
 */
import type { CaseOutputFormat, CaseType } from './case-sessions';

export interface CaseGenPluginConfig {
  /** 当前会话是否启用（确认后为 true） */
  active: boolean;
  caseType: CaseType;
  outputFormat: CaseOutputFormat;
  reqPath?: string;
  templateId?: string;
  templateTitle?: string;
  promptPath?: string;
  /** 引用知识库相对路径（knowledge/ 下） */
  knowledgePaths?: string[];
  /** 确认时缓存，发送时不必再读盘 */
  templateHeaders: string[];
  templateBody: string;
  promptBody: string;
  confirmedAt: number;
  /** 本会话最近一次生成入库的用例文件相对路径 */
  linkedCasePath?: string;
}

export function caseGenConfigLabel(cfg: CaseGenPluginConfig): string {
  const parts = [
    cfg.templateTitle || cfg.templateId?.split('/').pop() || '默认模板',
    cfg.outputFormat.toUpperCase(),
  ];
  if (cfg.reqPath) parts.push(cfg.reqPath.split('/').pop() || cfg.reqPath);
  return parts.join(' · ');
}
