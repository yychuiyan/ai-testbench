/**
 * 本地 bash / pwsh + jobs（/__tb_bash · /__tb_pwsh；对齐 dsh tool-bash / tool-pwsh / tool-jobs）。
 */
import type { AccessLevel } from './settings';

const API_BASH = '/__tb_bash';
const API_PWSH = '/__tb_pwsh';

export interface BashHealth {
  ok: boolean;
  mode?: string;
  available?: boolean;
  projectRoot?: string;
  workspace?: string;
  bash?: string;
  timeoutMs?: number;
  maxOut?: number;
  jobs?: boolean;
  jobCount?: number;
  runningJobs?: number;
}

export interface PwshHealth {
  ok: boolean;
  mode?: string;
  available?: boolean;
  pwsh?: string | null;
  projectRoot?: string;
  workspace?: string;
  timeoutMs?: number;
  maxOut?: number;
  jobs?: boolean;
  jobCount?: number;
  runningJobs?: number;
}

export const BASH_SYSTEM_HINT =
  '你可以使用 bash / jobs 工具（需本地服务，且访问权限为「工作区内修改」或「完全权限」）：\n' +
  '- bash：默认同步执行；长任务设 background=true，立即返回 jobId，再用 job_* 查看/终止\n' +
  '- job_list / job_output / job_kill：管理后台任务（bash 与 pwsh 共用）\n' +
  '- 默认 cwd 为侧栏工作区；完全权限可用绝对路径作 workdir\n' +
  '- 同步有超时与输出截断；后台输出缓存在本地服务内存中\n' +
  '- 改文件优先用 fs_*；bash 适合构建、测试、git 状态等命令';

export const PWSH_SYSTEM_HINT =
  '你可以使用 pwsh 工具（本机已安装 PowerShell 时可用）：\n' +
  '- pwsh：执行 PowerShell 命令（-NoProfile -NonInteractive）；亦可 background=true 挂到同一套 job_*\n' +
  '- Windows 优先；macOS/Linux 需安装 PowerShell 7+（pwsh）\n' +
  '- 与 bash 相同的工作区 / 权限规则';

export const BASH_TOOL = {
  type: 'function' as const,
  function: {
    name: 'bash',
    description:
      'Run a bash command in the workspace (or workdir). Default: synchronous. Set background=true for long-running jobs (returns jobId; use job_output/job_kill).',
    parameters: {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          description: 'Shell command to run via bash -lc',
        },
        workdir: {
          type: 'string',
          description:
            'Working directory relative to workspace (or absolute when full access). Default: .',
        },
        background: {
          type: 'boolean',
          description: 'If true, start in background and return jobId immediately.',
        },
      },
      required: ['command'],
    },
  },
};

export const PWSH_TOOL = {
  type: 'function' as const,
  function: {
    name: 'pwsh',
    description:
      'Run a PowerShell command in the workspace (or workdir). Default: synchronous. Set background=true for jobs (same job_* tools as bash).',
    parameters: {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          description: 'PowerShell command / script block text',
        },
        workdir: {
          type: 'string',
          description:
            'Working directory relative to workspace (or absolute when full access). Default: .',
        },
        background: {
          type: 'boolean',
          description: 'If true, start in background and return jobId immediately.',
        },
      },
      required: ['command'],
    },
  },
};

export const JOB_TOOLS = [
  {
    type: 'function' as const,
    function: {
      name: 'job_list',
      description: 'List background bash jobs (id, status, command, exitCode).',
      parameters: {
        type: 'object',
        properties: {},
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'job_output',
      description: 'Read captured stdout/stderr for a background job. Optional offset for polling.',
      parameters: {
        type: 'object',
        properties: {
          jobId: { type: 'string', description: 'Job id from bash(background=true) or job_list' },
          offset: {
            type: 'number',
            description: 'Byte/char offset into combined output for incremental reads',
          },
        },
        required: ['jobId'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'job_kill',
      description: 'Terminate a running background job (SIGTERM).',
      parameters: {
        type: 'object',
        properties: {
          jobId: { type: 'string' },
        },
        required: ['jobId'],
      },
    },
  },
];

export async function fetchBashHealth(): Promise<BashHealth | null> {
  try {
    const res = await fetch(`${API_BASH}/health`, { signal: AbortSignal.timeout(1500) });
    if (!res.ok) return null;
    return (await res.json()) as BashHealth;
  } catch {
    return null;
  }
}

export async function fetchPwshHealth(): Promise<PwshHealth | null> {
  try {
    const res = await fetch(`${API_PWSH}/health`, { signal: AbortSignal.timeout(1500) });
    if (!res.ok) return null;
    return (await res.json()) as PwshHealth;
  } catch {
    return null;
  }
}

function formatBashResult(data: {
  ok?: boolean;
  exitCode?: number | null;
  stdout?: string;
  stderr?: string;
  truncated?: boolean;
  timedOut?: boolean;
  error?: string;
  workdir?: string;
  cwd?: string;
  durationMs?: number;
  command?: string;
  background?: boolean;
  jobId?: string;
}): string {
  if (data.background && data.jobId) {
    return [
      'Background job started.',
      `jobId: ${data.jobId}`,
      data.command ? `Command: ${data.command}` : '',
      data.workdir ? `Cwd: ${data.workdir}` : '',
      'Use job_output to read output; job_kill to stop; job_list to list.',
    ]
      .filter(Boolean)
      .join('\n');
  }
  if (data.error && data.exitCode == null && !data.stdout && !data.stderr) {
    return `Bash failed: ${data.error}`;
  }
  const lines = [
    data.command ? `Command: ${data.command}` : '',
    data.workdir || data.cwd ? `Cwd: ${data.workdir || data.cwd}` : '',
    data.exitCode != null ? `Exit: ${data.exitCode}` : '',
    data.timedOut ? 'Timed out: yes' : '',
    data.truncated ? 'Output truncated: yes' : '',
    data.durationMs != null ? `Duration: ${data.durationMs}ms` : '',
    data.error ? `Error: ${data.error}` : '',
  ].filter(Boolean);
  const out = (data.stdout || '').trimEnd();
  const err = (data.stderr || '').trimEnd();
  return [
    lines.join('\n'),
    out ? `--- stdout ---\n${out}` : '--- stdout ---\n(empty)',
    err ? `--- stderr ---\n${err}` : '',
  ]
    .filter(Boolean)
    .join('\n\n');
}

async function runShellTool(
  api: string,
  label: string,
  argsJson: string,
  access: AccessLevel,
): Promise<string> {
  if (access === 'readonly') {
    return JSON.stringify({
      error: `${label} 需要「工作区内修改」或「完全权限」`,
    });
  }
  let args: { command?: string; workdir?: string; background?: boolean } = {};
  try {
    args = JSON.parse(argsJson || '{}') as typeof args;
  } catch {
    return JSON.stringify({ error: 'invalid JSON arguments' });
  }
  const command = String(args.command ?? '').trim();
  if (!command) return JSON.stringify({ error: 'command is required' });
  const background = Boolean(args.background);

  try {
    const res = await fetch(`${api}/exec`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        command,
        workdir: args.workdir,
        access,
        background,
      }),
      signal: AbortSignal.timeout(background ? 15_000 : 130_000),
    });
    const data = (await res.json()) as Record<string, unknown>;
    if (!res.ok && data.error) {
      return formatBashResult({ error: String(data.error), command });
    }
    if (data.background && data.jobId) {
      return formatBashResult({
        background: true,
        jobId: String(data.jobId),
        command: (data.command as string | undefined) || command,
        workdir: data.workdir as string | undefined,
      });
    }
    return formatBashResult({
      ok: Boolean(data.ok),
      exitCode: data.exitCode as number | null | undefined,
      stdout: data.stdout as string | undefined,
      stderr: data.stderr as string | undefined,
      truncated: Boolean(data.truncated),
      timedOut: Boolean(data.timedOut),
      error: data.error ? String(data.error) : undefined,
      workdir: data.workdir as string | undefined,
      cwd: data.cwd as string | undefined,
      durationMs: data.durationMs as number | undefined,
      command: (data.command as string | undefined) || command,
    });
  } catch (e) {
    return `${label} failed: ${e instanceof Error ? e.message : String(e)}`;
  }
}

export async function runBashTool(argsJson: string, access: AccessLevel): Promise<string> {
  return runShellTool(API_BASH, 'Bash', argsJson, access);
}

export async function runPwshTool(argsJson: string, access: AccessLevel): Promise<string> {
  return runShellTool(API_PWSH, 'Pwsh', argsJson, access);
}

export async function runJobTool(name: string, argsJson: string, access: AccessLevel): Promise<string> {
  if (name === 'job_kill' && access === 'readonly') {
    return JSON.stringify({ error: 'job_kill 需要「工作区内修改」或「完全权限」' });
  }
  let args: Record<string, unknown> = {};
  try {
    args = JSON.parse(argsJson || '{}') as Record<string, unknown>;
  } catch {
    return JSON.stringify({ error: 'invalid JSON arguments' });
  }

  try {
    if (name === 'job_list') {
      const res = await fetch(`${API_BASH}/jobs`, { signal: AbortSignal.timeout(5000) });
      const data = await res.json();
      return JSON.stringify(data, null, 2);
    }
    if (name === 'job_output') {
      const jobId = String(args.jobId ?? args.id ?? '').trim();
      if (!jobId) return JSON.stringify({ error: 'jobId is required' });
      const res = await fetch(`${API_BASH}/job_output`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId, offset: args.offset }),
        signal: AbortSignal.timeout(10_000),
      });
      const data = await res.json();
      return JSON.stringify(data, null, 2);
    }
    if (name === 'job_kill') {
      const jobId = String(args.jobId ?? args.id ?? '').trim();
      if (!jobId) return JSON.stringify({ error: 'jobId is required' });
      const res = await fetch(`${API_BASH}/job_kill`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId, access }),
        signal: AbortSignal.timeout(10_000),
      });
      const data = await res.json();
      return JSON.stringify(data, null, 2);
    }
    return JSON.stringify({ error: `unknown tool: ${name}` });
  } catch (e) {
    return JSON.stringify({ error: e instanceof Error ? e.message : String(e) });
  }
}
