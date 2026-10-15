/**
 * session-turn-outline：从会话消息提取对话回合摘要。
 */

export interface TurnOutlineItem {
  index: number;
  userPreview: string;
  assistantPreview: string;
  /** 用户完整正文（展开用） */
  userText: string;
  /** 助手完整正文（展开用） */
  assistantText: string;
  /** 助手思考过程（展开用） */
  reasoning?: string;
  reasoningDuration?: number;
  userTime?: number;
  assistantTime?: number;
  /** 该回合在 messages 中的结束下标（含；用于检查点恢复截断） */
  endMessageIndex: number;
}

function asText(text: unknown): string {
  return String(text ?? '').trim();
}

function preview(text: unknown, max = 80): string {
  const t = asText(text).replace(/\s+/g, ' ');
  if (!t) return '';
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

export function buildTurnOutline(
  messages: Array<{
    role?: string;
    content?: unknown;
    time?: number;
    reasoning?: string;
    reasoningDuration?: number;
  }>,
  limit = 40,
): TurnOutlineItem[] {
  const out: TurnOutlineItem[] = [];
  let pendingUser: {
    text: string;
    preview: string;
    time?: number;
    messageIndex: number;
  } | null = null;
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i]!;
    if (m.role === 'user') {
      const text = asText(m.content);
      const p = preview(text);
      if (!p) continue;
      if (pendingUser) {
        out.push({
          index: out.length + 1,
          userPreview: pendingUser.preview,
          assistantPreview: '',
          userText: pendingUser.text,
          assistantText: '',
          userTime: pendingUser.time,
          endMessageIndex: pendingUser.messageIndex,
        });
      }
      pendingUser = {
        text,
        preview: p,
        time: typeof m.time === 'number' ? m.time : undefined,
        messageIndex: i,
      };
    } else if (m.role === 'assistant' && pendingUser) {
      const text = asText(m.content);
      const reasoning = asText(m.reasoning) || undefined;
      out.push({
        index: out.length + 1,
        userPreview: pendingUser.preview,
        assistantPreview: preview(text) || (reasoning ? '（含思考）' : ''),
        userText: pendingUser.text,
        assistantText: text,
        reasoning,
        reasoningDuration:
          typeof m.reasoningDuration === 'number' ? m.reasoningDuration : undefined,
        userTime: pendingUser.time,
        assistantTime: typeof m.time === 'number' ? m.time : undefined,
        endMessageIndex: i,
      });
      pendingUser = null;
    }
    if (out.length >= limit) break;
  }
  if (pendingUser && out.length < limit) {
    out.push({
      index: out.length + 1,
      userPreview: pendingUser.preview,
      assistantPreview: '',
      userText: pendingUser.text,
      assistantText: '',
      userTime: pendingUser.time,
      endMessageIndex: pendingUser.messageIndex,
    });
  }
  return out;
}

export function formatTurnOutline(items: TurnOutlineItem[]): string {
  if (!items.length) return '暂无回合（还没有用户/助手对话）。';
  return items
    .map((it) => {
      const a = it.assistantPreview || '（待回复）';
      return `${it.index}. 用户：${it.userPreview}\n   助手：${a}`;
    })
    .join('\n');
}
