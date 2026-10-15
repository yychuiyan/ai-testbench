/**
 * session-stats：从会话消息汇总统计。
 */
import type { ChatSession } from './sessions';

export interface SessionStats {
  sessionId: string;
  title: string;
  messageCount: number;
  userCount: number;
  assistantCount: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  createdAt: number;
  updatedAt: number;
  hasGoal: boolean;
  todoCount: number;
}

export function computeSessionStats(session: ChatSession): SessionStats {
  const messages = Array.isArray(session.messages) ? session.messages : [];
  let userCount = 0;
  let assistantCount = 0;
  let promptTokens = 0;
  let completionTokens = 0;
  let totalTokens = 0;
  for (const raw of messages) {
    if (!raw || typeof raw !== 'object') continue;
    const m = raw as Record<string, unknown>;
    if (m.role === 'user') userCount += 1;
    else if (m.role === 'assistant') assistantCount += 1;
    const usage = m.usage;
    if (usage && typeof usage === 'object') {
      const u = usage as Record<string, unknown>;
      if (typeof u.promptTokens === 'number') promptTokens += u.promptTokens;
      if (typeof u.completionTokens === 'number') completionTokens += u.completionTokens;
      if (typeof u.totalTokens === 'number') totalTokens += u.totalTokens;
      else if (typeof u.promptTokens === 'number' || typeof u.completionTokens === 'number') {
        totalTokens += (Number(u.promptTokens) || 0) + (Number(u.completionTokens) || 0);
      }
    }
  }
  const goal = session.goal;
  const hasGoal = Boolean(goal && goal.status !== 'cleared' && goal.text?.trim());
  return {
    sessionId: session.id,
    title: session.title || '新对话',
    messageCount: messages.length,
    userCount,
    assistantCount,
    promptTokens,
    completionTokens,
    totalTokens,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    hasGoal,
    todoCount: Array.isArray(session.todos) ? session.todos.length : 0,
  };
}

export function formatSessionStats(stats: SessionStats): string {
  const created = new Date(stats.createdAt).toLocaleString();
  const updated = new Date(stats.updatedAt).toLocaleString();
  const lines = [
    `会话：${stats.title}`,
    `消息 ${stats.messageCount}（用户 ${stats.userCount} / 助手 ${stats.assistantCount}）`,
    `用量≈ 输入 ${stats.promptTokens} · 输出 ${stats.completionTokens} · 合计 ${stats.totalTokens}`,
    `待办 ${stats.todoCount} · 目标 ${stats.hasGoal ? '有' : '无'}`,
    `创建 ${created}`,
    `更新 ${updated}`,
  ];
  return lines.join('\n');
}
