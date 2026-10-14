/**
 * 会话交互类工具：todo_write / ask_user_question（对齐 dsh 语义，纯前端）。
 */

export type TodoStatus = 'pending' | 'in_progress' | 'completed';

export interface TodoItem {
  content: string;
  status: TodoStatus;
}

export interface AskUserOption {
  label: string;
  description?: string;
}

export interface AskUserQuestion {
  id: string;
  question: string;
  header?: string;
  options?: AskUserOption[];
  multi_select?: boolean;
}

export interface AskUserAnswer {
  id: string;
  /** 选项 label 列表，或自由文本 */
  selected?: string[];
  text?: string;
}

export const SESSION_INTERACT_HINT =
  '会话交互工具（默认可用）：\n' +
  '- todo_write：维护本会话完整待办列表（替换式写入）；多步任务用它展示进度；允许多个 in_progress\n' +
  '- ask_user_question：向用户提出结构化问题并等待回答；缺信息或需确认时使用，勿空猜';

export const TODO_WRITE_TOOL = {
  type: 'function' as const,
  function: {
    name: 'todo_write',
    description:
      'Record and update a task list for multi-step work. Replace the complete list each call. Keep active work in_progress (several allowed in parallel). Mark completed as soon as done. Skip for trivial single-step tasks.',
    parameters: {
      type: 'object',
      properties: {
        todos: {
          type: 'array',
          description: 'The COMPLETE task list, replacing any previous list.',
          items: {
            type: 'object',
            properties: {
              content: {
                type: 'string',
                description: 'What the task is — a short imperative line.',
              },
              status: {
                type: 'string',
                enum: ['pending', 'in_progress', 'completed'],
                description: 'pending | in_progress | completed',
              },
            },
            required: ['content', 'status'],
          },
        },
      },
      required: ['todos'],
    },
  },
};

export const ASK_USER_QUESTION_TOOL = {
  type: 'function' as const,
  function: {
    name: 'ask_user_question',
    description:
      'Ask the user a concise structured question when you need confirmation, a choice, or missing information before proceeding. Pauses until the user answers.',
    parameters: {
      type: 'object',
      properties: {
        questions: {
          type: 'array',
          description: 'Questions to ask the user before continuing.',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string', description: 'Stable id; echoed in the answer.' },
              question: { type: 'string', description: 'The specific question.' },
              header: { type: 'string', description: 'Optional short heading.' },
              options: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    label: { type: 'string' },
                    description: { type: 'string' },
                  },
                  required: ['label'],
                },
              },
              multi_select: {
                type: 'boolean',
                description: 'Allow selecting more than one option. Default false.',
              },
            },
            required: ['id', 'question'],
          },
        },
      },
      required: ['questions'],
    },
  },
};

export function normalizeTodos(raw: unknown): TodoItem[] {
  if (!Array.isArray(raw)) return [];
  const out: TodoItem[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const content = String((item as { content?: unknown }).content ?? '').trim();
    const status = String((item as { status?: unknown }).status ?? '') as TodoStatus;
    if (!content) continue;
    if (status !== 'pending' && status !== 'in_progress' && status !== 'completed') continue;
    out.push({ content, status });
  }
  return out;
}

export function parseAskUserArgs(argsJson: string): AskUserQuestion[] {
  let raw: { questions?: unknown } = {};
  try {
    raw = JSON.parse(argsJson || '{}') as { questions?: unknown };
  } catch {
    return [];
  }
  if (!Array.isArray(raw.questions)) return [];
  const out: AskUserQuestion[] = [];
  for (const q of raw.questions) {
    if (!q || typeof q !== 'object') continue;
    const id = String((q as AskUserQuestion).id ?? '').trim();
    const question = String((q as AskUserQuestion).question ?? '').trim();
    if (!id || !question) continue;
    const optionsRaw = (q as AskUserQuestion).options;
    const options = Array.isArray(optionsRaw)
      ? optionsRaw
          .map((o) => ({
            label: String(o?.label ?? '').trim(),
            description: o?.description ? String(o.description) : undefined,
          }))
          .filter((o) => o.label)
      : undefined;
    out.push({
      id,
      question,
      header: (q as AskUserQuestion).header
        ? String((q as AskUserQuestion).header)
        : undefined,
      options: options?.length ? options : undefined,
      multi_select: Boolean((q as AskUserQuestion).multi_select),
    });
  }
  return out;
}
