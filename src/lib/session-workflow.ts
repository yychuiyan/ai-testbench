/**
 * 会话工作流（tool-workflow + workflow-ptc MVP）：
 * 浏览器内受限 AsyncFunction 跑编排脚本；agent() 复用子代理。
 * 非真 Node PTC 沙箱；刷新清空。
 */

import type { ToolDef } from './llm';
import { runIsolatedSubagentTask, type SubagentToolContext } from './session-subagent';

const MAX_SCRIPT_CHARS = 40_000;
const MAX_RESULT_CHARS = 50_000;
const MAX_TOTAL_AGENTS = 12;
const MAX_PARALLEL = 4;
const MAX_LOG_LINES = 80;

export const WORKFLOW_SYSTEM_HINT =
  '你可以使用 workflow 工具（仅当用户明确要求工作流 / 大规模多代理编排时）：\n' +
  '- 参数：meta{name,description,phases?}、script（纯 JS 函数体，可用 top-level await）、args?\n' +
  '- 脚本内钩子：agent(prompt, opts?)、parallel(fns)、pipeline(fns)、phase(name)、log(...)\n' +
  '- agent() 返回子代理结论文本，失败返回 null\n' +
  '- 一两个子任务请用 spawn_subagent / fork_subagent，勿滥用 workflow';

export const WORKFLOW_TOOLS: ToolDef[] = [
  {
    type: 'function',
    function: {
      name: 'workflow',
      description:
        'Run a JavaScript orchestration script that fans out subagents and returns a JSON value. ' +
        'Use ONLY when the user explicitly asks for a workflow or large multi-agent orchestration. ' +
        'Script body may use top-level await and helpers: agent, parallel, pipeline, phase, log. ' +
        'Example body: const xs = await parallel([() => agent("task A"), () => agent("task B")]); return xs.filter(Boolean);',
      parameters: {
        type: 'object',
        properties: {
          meta: {
            type: 'object',
            description: 'Workflow identity',
            properties: {
              name: { type: 'string' },
              description: { type: 'string' },
              phases: {
                type: 'array',
                items: { type: 'string' },
              },
            },
            required: ['name', 'description'],
          },
          script: {
            type: 'string',
            description:
              'Plain JavaScript body (no export). Globals: args, agent, parallel, pipeline, phase, log.',
          },
          args: {
            type: 'object',
            description: 'JSON object exposed to the script as args (wrap arrays in a field)',
          },
        },
        required: ['meta', 'script'],
      },
    },
  },
];

export interface WorkflowMeta {
  name: string;
  description: string;
  phases?: string[];
}

export interface WorkflowRunResult {
  ok: boolean;
  kind: 'foreground';
  runId: string;
  name: string;
  agentsStarted: number;
  result?: unknown;
  error?: string;
  stopReason: 'completed' | 'error' | 'cancelled';
  logs?: string[];
  phases?: string[];
}

export type WorkflowToolContext = SubagentToolContext;

function uid(): string {
  return `wf_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

function validateMeta(raw: unknown): WorkflowMeta | { error: string } {
  if (!raw || typeof raw !== 'object') return { error: 'meta is required' };
  const o = raw as Record<string, unknown>;
  const name = String(o.name ?? '').trim();
  const description = String(o.description ?? '').trim();
  if (!name) return { error: 'meta.name is required' };
  if (!description) return { error: 'meta.description is required' };
  const phases = Array.isArray(o.phases)
    ? o.phases
        .map((p) => String(p).trim())
        .filter(Boolean)
        .slice(0, 20)
    : undefined;
  return { name: name.slice(0, 80), description: description.slice(0, 400), phases };
}

/** 粗拦危险 API（字符串字面量误伤可接受） */
export function scriptLooksUnsafe(script: string): string | null {
  const banned =
    /\brequire\b|\bprocess\.|\bchild_process\b|\bfs\.|\bglobalThis\b|\bFunction\s*\(|\beval\s*\(|\bimport\s*\(|\bXMLHttpRequest\b|\blocalStorage\b|\bindexedDB\b|\bdocument\.|\bwindow\./;
  if (banned.test(script)) {
    return 'script uses disallowed APIs (browser/Node escape)';
  }
  return null;
}

async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
  signal?: AbortSignal,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function pump() {
    while (next < items.length) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      const i = next++;
      results[i] = await worker(items[i]!, i);
    }
  }
  const n = Math.min(Math.max(1, concurrency), items.length || 1);
  await Promise.all(Array.from({ length: n }, () => pump()));
  return results;
}

export async function runWorkflowEngine(
  meta: WorkflowMeta,
  script: string,
  args: Record<string, unknown>,
  ctx: WorkflowToolContext,
): Promise<WorkflowRunResult> {
  const runId = uid();
  const logs: string[] = [];
  const phaseTrail: string[] = [];
  let agentsStarted = 0;
  let agentsBudget = MAX_TOTAL_AGENTS;

  const pushLog = (...parts: unknown[]) => {
    const line = parts
      .map((p) => {
        if (typeof p === 'string') return p;
        try {
          return JSON.stringify(p);
        } catch {
          return String(p);
        }
      })
      .join(' ');
    logs.push(line.slice(0, 500));
    if (logs.length > MAX_LOG_LINES) logs.splice(0, logs.length - MAX_LOG_LINES);
    ctx.onHint?.(`workflow ${meta.name}: ${line.slice(0, 80)}`);
  };

  const agent = async (
    promptRaw: unknown,
    opts?: { label?: string; agent?: string },
  ): Promise<string | null> => {
    if (ctx.parentSignal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const prompt = String(promptRaw ?? '').trim();
    if (!prompt) return null;
    if (agentsBudget <= 0) {
      pushLog('agent budget exhausted');
      return null;
    }
    agentsBudget--;
    agentsStarted++;
    const label = opts?.label ? ` [${opts.label}]` : '';
    pushLog(`agent${label}: ${prompt.slice(0, 120)}`);
    const r = await runIsolatedSubagentTask(prompt, ctx, {
      agent: opts?.agent ?? 'explore',
      forked: false,
    });
    if (!r.ok) {
      pushLog(`agent failed${label}: ${r.error ?? 'error'}`);
      return null;
    }
    return r.text;
  };

  const parallel = async (
    fns: Array<() => Promise<unknown>>,
    concurrency = MAX_PARALLEL,
  ): Promise<unknown[]> => {
    if (!Array.isArray(fns)) throw new Error('parallel() expects an array of functions');
    const list = fns.slice(0, MAX_TOTAL_AGENTS);
    return mapPool(
      list,
      Math.min(MAX_PARALLEL, concurrency || MAX_PARALLEL),
      async (fn) => {
        if (typeof fn !== 'function') return null;
        try {
          return await fn();
        } catch (e) {
          pushLog('parallel task error', e instanceof Error ? e.message : String(e));
          return null;
        }
      },
      ctx.parentSignal,
    );
  };

  const pipeline = async (fns: Array<() => Promise<unknown>>): Promise<unknown[]> => {
    if (!Array.isArray(fns)) throw new Error('pipeline() expects an array of functions');
    const out: unknown[] = [];
    for (const fn of fns.slice(0, MAX_TOTAL_AGENTS)) {
      if (ctx.parentSignal?.aborted) throw new DOMException('Aborted', 'AbortError');
      if (typeof fn !== 'function') {
        out.push(null);
        continue;
      }
      try {
        out.push(await fn());
      } catch (e) {
        pushLog('pipeline task error', e instanceof Error ? e.message : String(e));
        out.push(null);
      }
    }
    return out;
  };

  const phase = (nameRaw: unknown) => {
    const name = String(nameRaw ?? '').trim() || 'phase';
    phaseTrail.push(name.slice(0, 80));
    pushLog(`phase: ${name}`);
    ctx.onHint?.(`workflow ${meta.name} · ${name}`);
  };

  const log = (...parts: unknown[]) => pushLog(...parts);

  const unsafe = scriptLooksUnsafe(script);
  if (unsafe) {
    return {
      ok: false,
      kind: 'foreground',
      runId,
      name: meta.name,
      agentsStarted: 0,
      stopReason: 'error',
      error: unsafe,
    };
  }
  if (script.length > MAX_SCRIPT_CHARS) {
    return {
      ok: false,
      kind: 'foreground',
      runId,
      name: meta.name,
      agentsStarted: 0,
      stopReason: 'error',
      error: `script too long (max ${MAX_SCRIPT_CHARS})`,
    };
  }

  try {
    const AsyncFunction = Object.getPrototypeOf(async function noop() {}).constructor as new (
      ...args: string[]
    ) => (...args: unknown[]) => Promise<unknown>;
    const fn = new AsyncFunction(
      'args',
      'agent',
      'parallel',
      'pipeline',
      'phase',
      'log',
      `"use strict";\n${script}`,
    );
    const value = await fn(args, agent, parallel, pipeline, phase, log);
    if (ctx.parentSignal?.aborted) {
      return {
        ok: false,
        kind: 'foreground',
        runId,
        name: meta.name,
        agentsStarted,
        stopReason: 'cancelled',
        error: 'workflow run was cancelled',
        logs,
        phases: phaseTrail,
      };
    }
    let result: unknown = value === undefined ? null : value;
    try {
      const encoded = JSON.stringify(result);
      if (encoded && encoded.length > MAX_RESULT_CHARS) {
        result = {
          truncated: true,
          preview: encoded.slice(0, MAX_RESULT_CHARS),
        };
      } else {
        result = encoded === undefined ? null : JSON.parse(encoded);
      }
    } catch {
      result = String(result).slice(0, MAX_RESULT_CHARS);
    }
    return {
      ok: true,
      kind: 'foreground',
      runId,
      name: meta.name,
      agentsStarted,
      result,
      stopReason: 'completed',
      logs,
      phases: phaseTrail,
    };
  } catch (e) {
    const aborted =
      (e instanceof DOMException && e.name === 'AbortError') || Boolean(ctx.parentSignal?.aborted);
    return {
      ok: false,
      kind: 'foreground',
      runId,
      name: meta.name,
      agentsStarted,
      stopReason: aborted ? 'cancelled' : 'error',
      error: aborted ? 'workflow run was cancelled' : e instanceof Error ? e.message : String(e),
      logs,
      phases: phaseTrail,
    };
  }
}

export async function runWorkflowTool(
  name: string,
  argsJson: string,
  ctx: WorkflowToolContext,
): Promise<string> {
  if (name !== 'workflow') {
    return JSON.stringify({ error: `unknown tool: ${name}` });
  }
  let args: Record<string, unknown> = {};
  try {
    args = JSON.parse(argsJson || '{}') as Record<string, unknown>;
  } catch {
    return JSON.stringify({ error: 'invalid JSON arguments' });
  }
  const meta = validateMeta(args.meta);
  if ('error' in meta) return JSON.stringify({ ok: false, error: meta.error });
  const script = String(args.script ?? '');
  if (!script.trim()) return JSON.stringify({ ok: false, error: 'script is required' });
  const scriptArgs =
    args.args && typeof args.args === 'object' && !Array.isArray(args.args)
      ? (args.args as Record<string, unknown>)
      : {};

  ctx.onHint?.(`workflow "${meta.name}" 启动…`);
  const out = await runWorkflowEngine(meta, script, scriptArgs, ctx);
  if (out.ok) {
    return [
      `workflow "${out.name}" completed (${out.agentsStarted} agent${out.agentsStarted === 1 ? '' : 's'}).`,
      'Return value:',
      JSON.stringify(out.result, null, 2),
    ].join('\n');
  }
  if (out.stopReason === 'cancelled') {
    return `Error: workflow run was cancelled${out.error && out.error !== 'workflow run was cancelled' ? ` (${out.error})` : ''}`;
  }
  return `Error: workflow run failed: ${out.error ?? 'unknown'}`;
}
