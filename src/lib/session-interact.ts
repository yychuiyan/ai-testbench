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
  /** 用户跳过了这道题（关闭卡片或点「跳过本题」） */
  skipped?: boolean;
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
      header: (q as AskUserQuestion).header ? String((q as AskUserQuestion).header) : undefined,
      options: options?.length ? options : undefined,
      multi_select: Boolean((q as AskUserQuestion).multi_select),
    });
  }
  return out;
}

/** 提问卡片里一题的作答草稿（点击 / 手打 / 跳过） */
export interface AskUserDraft {
  selected: string[];
  text: string;
  skipped?: boolean;
}

/**
 * 「1」「1,3」「2、4」→ 选项 label；含非法序号或非纯数字返回 null（当作自由回答）。
 * 手打序号与点击选项语义一致，只是给不想用鼠标的场景留的入口。
 */
export function parseAskSelection(q: AskUserQuestion, raw: string): string[] | null {
  const options = q.options ?? [];
  if (!options.length) return null;
  const tokens = raw
    .trim()
    .split(/[,，、;；\s]+/)
    .filter(Boolean);
  if (!tokens.length) return null;
  const picked: string[] = [];
  for (const token of tokens) {
    const n = Number(token.replace(/^第/, '').replace(/[.。)]$/, ''));
    if (!Number.isInteger(n) || n < 1 || n > options.length) return null;
    const label = options[n - 1]?.label;
    if (label && !picked.includes(label)) picked.push(label);
  }
  // 单选题不接受多个序号：这种输入更像自由回答，原样传文本
  if (!q.multi_select && picked.length > 1) return null;
  return picked.length ? picked : null;
}

/** 把一题草稿落成答案：序号/点选 → selected，自由文本 → text，跳过 → skipped */
export function resolveAskAnswer(
  q: AskUserQuestion,
  draft: AskUserDraft | undefined,
): AskUserAnswer {
  const cur = draft ?? { selected: [], text: '' };
  if (cur.skipped) return { id: q.id, selected: [], skipped: true };
  const text = cur.text.trim();
  if (text) {
    const picked = q.options?.length ? parseAskSelection(q, text) : null;
    return picked ? { id: q.id, selected: picked } : { id: q.id, text };
  }
  return { id: q.id, selected: [...cur.selected] };
}

/**
 * 给模型的文案版本：按题号列出「问题 → 回答 / 跳过」。
 * 工具结果里同时带结构化 answers 和这段 summary，模型可直接引用，省得自己拼句子。
 */
export function formatAskAnswersText(
  questions: AskUserQuestion[],
  answers: AskUserAnswer[],
): string {
  return questions
    .map((q, i) => {
      const a = answers[i];
      const value = a?.skipped
        ? '（跳过，未作答）'
        : a?.text?.trim()
          ? a.text.trim()
          : (a?.selected ?? []).join('、') || '（跳过，未作答）';
      const title = q.header ? `${q.header} / ${q.question}` : q.question;
      return `${i + 1}. ${title}\n   → ${value}`;
    })
    .join('\n');
}
