/**
 * 会话目标（tool-goal + command-goal 共用）：
 * 模型用工具读写；人类用 /goal 命令管理。
 */

export type GoalStatus = 'active' | 'done' | 'cleared';

export interface SessionGoal {
  text: string;
  status: GoalStatus;
  updatedAt: number;
}

export const GOAL_SYSTEM_HINT =
  '你可以使用会话目标工具：\n' +
  '- goal_get：读取本会话当前目标\n' +
  '- goal_set：设定或更新目标（status=active）\n' +
  '- goal_done：将目标标为已完成\n' +
  '- goal_clear：清除目标\n' +
  '有活跃目标时应围绕其推进；重大偏离前用 ask_user_question 或更新目标。';

export const GOAL_TOOLS = [
  {
    type: 'function' as const,
    function: {
      name: 'goal_get',
      description: 'Get the current session goal (text + status).',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'goal_set',
      description: 'Set or replace the session goal. Marks it active.',
      parameters: {
        type: 'object',
        properties: {
          text: { type: 'string', description: 'Goal statement for this session' },
        },
        required: ['text'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'goal_done',
      description: 'Mark the current session goal as done.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'goal_clear',
      description: 'Clear the session goal.',
      parameters: { type: 'object', properties: {} },
    },
  },
];

export function normalizeGoal(raw: unknown): SessionGoal | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const text = String(o.text ?? '').trim();
  if (!text) return null;
  const status =
    o.status === 'done' || o.status === 'cleared' || o.status === 'active' ? o.status : 'active';
  return {
    text: text.slice(0, 500),
    status,
    updatedAt: typeof o.updatedAt === 'number' ? o.updatedAt : Date.now(),
  };
}

export function formatGoalForModel(goal: SessionGoal | null): string {
  if (!goal || goal.status === 'cleared' || !goal.text) {
    return JSON.stringify({ ok: true, goal: null });
  }
  return JSON.stringify({ ok: true, goal: { text: goal.text, status: goal.status } });
}

export function activeGoalText(goal: SessionGoal | null | undefined): string | null {
  if (!goal || goal.status !== 'active') return null;
  const t = goal.text.trim();
  return t || null;
}

/** /goal | /goal set … | /goal clear | /goal done */
export function parseGoalCommand(text: string): {
  kind: 'show' | 'set' | 'clear' | 'done';
  text?: string;
} | null {
  const raw = text.trim();
  if (!/^\/goal(?:\s|$)/i.test(raw)) return null;
  const rest = raw.replace(/^\/goal\s*/i, '').trim();
  if (!rest) return { kind: 'show' };
  if (/^clear\b/i.test(rest)) return { kind: 'clear' };
  if (/^done\b/i.test(rest)) return { kind: 'done' };
  if (/^set\s+/i.test(rest)) {
    const t = rest.replace(/^set\s+/i, '').trim();
    return t ? { kind: 'set', text: t } : { kind: 'show' };
  }
  // `/goal 做某某事` 视为 set
  return { kind: 'set', text: rest };
}

export function isGoalCommand(text: string): boolean {
  return parseGoalCommand(text) != null;
}
