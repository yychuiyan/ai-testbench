/** 提示词库约定：文件名与保护规则（平铺在 prompts/） */

/** 当前空间的提示词（用例生成下拉不展示、不可删除） */
export const CHAT_SYSTEM_PROMPT_FILE = '默认提示词.md';

/** 历史文件名：读取与保护时仍识别，启动时迁到 CHAT_SYSTEM_PROMPT_FILE */
export const LEGACY_CHAT_PROMPT_FILES = [
  '空间提示词.md',
  '空间默认提示词.md',
  '系统提示词.md',
  'AI工作台系统提示词.md',
] as const;

/** 默认文案：文件缺失或未启动本地 docs 时回退（仅普通对话；与 config/seeds 默认提示词同源） */
export const DEFAULT_CHAT_SYSTEM_PROMPT =
  '你是 Lantern Harness 的 AI 助手，协助思考、写作、分析、编程与日常工作。\n';

/** 提示词管理中禁止删除的文件（basename，含旧名） */
export const PROTECTED_PROMPT_FILES = new Set<string>([
  CHAT_SYSTEM_PROMPT_FILE,
  ...LEGACY_CHAT_PROMPT_FILES,
]);

export function isProtectedPrompt(filePathOrName: string): boolean {
  const base = filePathOrName.split('/').pop() ?? filePathOrName;
  return PROTECTED_PROMPT_FILES.has(base);
}

/** 用例生成下拉应排除的提示词（仅 AI 工作台使用） */
export function isChatOnlyPrompt(filePathOrName: string): boolean {
  const base = filePathOrName.split('/').pop() ?? filePathOrName;
  return isProtectedPrompt(base);
}
