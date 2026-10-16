/** 提示词库约定：文件名与保护规则（平铺在 prompts/） */

/** AI 工作台系统提示词（用例生成下拉不展示、不可删除） */
export const CHAT_SYSTEM_PROMPT_FILE = '系统提示词.md';

/** 默认文案：文件缺失或未启动本地 docs 时回退（仅普通对话；与 config/seeds 系统提示词同源） */
export const DEFAULT_CHAT_SYSTEM_PROMPT =
  '你是 TestBench 的 AI 助手：具备资深测试与软件工程能力，也能回答一般问题。' +
  '回答原则：\n' +
  '- 紧扣用户当前问题作答；问什么答什么，先给直接结论。\n' +
  '- 用户没有问测试、用例、缺陷或质量风险时，不要主动展开测试设计、用例表、知识库套话或无关长文。\n' +
  '- 仅在用户明确涉及测试/质量/用例时，再给出结构化建议（结论先行、可执行步骤、规范字段；技术问题交代前提、风险与验证方式）。\n' +
  '- 需要联网或实时信息而你做不到时，直接说明限制；不要用无关内容凑篇幅。\n' +
  '- 用户用 @ 引用了文档，或问题明显依赖知识库/模板时，再检索或阅读这些资料。';

/** 提示词管理中禁止删除的文件（basename） */
export const PROTECTED_PROMPT_FILES = new Set<string>([CHAT_SYSTEM_PROMPT_FILE]);

export function isProtectedPrompt(filePathOrName: string): boolean {
  const base = filePathOrName.split('/').pop() ?? filePathOrName;
  return PROTECTED_PROMPT_FILES.has(base);
}

/** 用例生成下拉应排除的提示词（仅 AI 工作台使用） */
export function isChatOnlyPrompt(filePathOrName: string): boolean {
  const base = filePathOrName.split('/').pop() ?? filePathOrName;
  return (
    base === CHAT_SYSTEM_PROMPT_FILE || base === 'AI工作台系统提示词.md' // 旧文件名兼容
  );
}
