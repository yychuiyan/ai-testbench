/** 创建空间时根据用户要求生成「默认提示词」正文。 */
export const SPACE_PROMPT_GEN_SYSTEM =
  '你是提示词作者。根据用户对这个数据空间的要求，写一份「默认提示词」正文（Markdown 纯文本，不要用代码围栏）。\n' +
  '这份提示词将作为 Lantern Harness 该空间里 AI 助手的默认人设与回答原则。\n' +
  '要求：\n' +
  '- 用「你是…」起头设定角色；\n' +
  '- 紧扣用户描述的领域与工作方式；\n' +
  '- 写几条简洁的回答原则（问什么答什么、先结论）；\n' +
  '- 只输出提示词正文，不要解释、不要标题。';

/** 去掉模型偶尔包上的 Markdown 围栏 */
export function unwrapGeneratedPrompt(text: string): string {
  let s = String(text ?? '')
    .replace(/^\uFEFF/, '')
    .trim();
  const fence = /^```(?:markdown|md|text)?\s*\n([\s\S]*?)\n```$/i.exec(s);
  if (fence) s = fence[1].trim();
  return s;
}
