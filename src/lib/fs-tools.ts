/**
 * 本地工作区文件工具（仅 npm run dev + /__tb_fs）。
 */
import type { AccessLevel } from './settings';

const API = '/__tb_fs';

export interface FsHealth {
  ok: boolean;
  mode?: string;
  projectRoot?: string;
  workspace?: string;
  home?: string;
}

export interface WorkspaceItem {
  id: string;
  path: string;
  name: string;
  addedAt: number;
}

export interface WorkspaceInfo {
  workspace: string;
  projectRoot: string;
  isProject: boolean;
  items: WorkspaceItem[];
}

export const FS_SYSTEM_HINT =
  '你可以使用本地文件工具（侧栏工作区已连接时）：\n' +
  '- 侧栏「工作区」决定当前目录；fs_* 默认相对该工作区\n' +
  '- 「仅可查看」「工作区内修改」：用工作区相对路径\n' +
  '- 「完全权限」：还可用本机绝对路径\n' +
  '- 找文件用 fs_glob（如 **/*.ts）；搜内容用 fs_grep（正则）\n' +
  '- 用户问工作区内路径时直接 fs_list/fs_read，不要拒绝\n' +
  '- 改文件前确认意图；勿动 .git\n' +
  '- 向用户交付已写好的工作区文件时，调用 present（勿只在正文里报路径）';

export const AGENT_INSTRUCTIONS_HINT_PREFIX =
  '【工作区指令 agent-instructions】下列内容来自 AGENTS.md / CLAUDE.md（及 .local 覆盖），供你遵循：';

export interface AgentInstructionsResult {
  text: string;
  files: Array<{ path: string; name: string }>;
}

/** 拉取工作区 AGENTS.md 链；失败或空则返回 null（不打断发送） */
export async function fetchAgentInstructions(): Promise<AgentInstructionsResult | null> {
  try {
    const res = await fetch(`${API}/agent-instructions`, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      text?: string;
      files?: Array<{ path: string; name: string }>;
    };
    const text = typeof data.text === 'string' ? data.text.trim() : '';
    if (!text) return null;
    return { text, files: Array.isArray(data.files) ? data.files : [] };
  } catch {
    return null;
  }
}

export interface PresentFile {
  path: string;
  name: string;
  description?: string;
}

export const PRESENT_TOOL = {
  type: 'function' as const,
  function: {
    name: 'present',
    description:
      'Declare existing workspace files as final deliverables for the user (e.g. Office docs). Prefer this over only mentioning paths in text. At most 4 files per call.',
    parameters: {
      type: 'object',
      properties: {
        files: {
          type: 'array',
          description: 'Usually the 1-2 most important deliverables; at most 4.',
          items: {
            type: 'object',
            properties: {
              path: {
                type: 'string',
                description: 'Path of an existing regular file (relative to workspace or absolute when allowed).',
              },
              description: {
                type: 'string',
                description: 'Brief description for the user.',
              },
            },
            required: ['path'],
          },
        },
      },
      required: ['files'],
    },
  },
};

export async function runPresentTool(argsJson: string, access: AccessLevel): Promise<string> {
  let args: { files?: Array<{ path?: string; description?: string }> } = {};
  try {
    args = JSON.parse(argsJson || '{}') as typeof args;
  } catch {
    return JSON.stringify({ error: 'invalid JSON arguments' });
  }
  const raw = Array.isArray(args.files) ? args.files : [];
  if (!raw.length) return JSON.stringify({ error: 'files is required' });
  if (raw.length > 4) return JSON.stringify({ error: 'at most 4 files per present call' });

  const out: PresentFile[] = [];
  const errors: string[] = [];
  for (const item of raw) {
    const p = String(item?.path ?? '').trim();
    if (!p) {
      errors.push('empty path');
      continue;
    }
    try {
      const data = (await postJson('/stat', { path: p, access })) as {
        ok?: boolean;
        path?: string;
        name?: string;
        error?: string;
      };
      out.push({
        path: data.path || p,
        name: data.name || p.split(/[/\\]/).pop() || p,
        description: item.description?.trim() || undefined,
      });
    } catch (e) {
      errors.push(`${p}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  if (!out.length) {
    return JSON.stringify({ error: errors.join('; ') || 'no valid files' });
  }
  return JSON.stringify({ ok: true, files: out, errors: errors.length ? errors : undefined });
}

/** 用系统默认应用打开工作区文件 */
export async function openFsPath(filePath: string, access: AccessLevel): Promise<void> {
  await postJson('/open', { path: filePath, access });
}

export const FS_TOOLS_READONLY = [
  {
    type: 'function',
    function: {
      name: 'fs_list',
      description: '列出目录（相对当前工作区；完全权限可用绝对路径）。',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '相对工作区或绝对路径，默认 .' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'fs_read',
      description: '读取文本文件。',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string' },
        },
        required: ['path'],
      },
    },
  },
];

export const FS_TOOLS_WRITE = [
  {
    type: 'function',
    function: {
      name: 'fs_write',
      description: '写入或覆盖文本文件（UTF-8）。',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          content: { type: 'string' },
        },
        required: ['path', 'content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'fs_mkdir',
      description: '创建目录（递归）。',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string' },
        },
        required: ['path'],
      },
    },
  },
];

/** 会话 tool-fs-search：glob / grep（只读，任意 access 可用） */
export const FS_TOOLS_SEARCH = [
  {
    type: 'function',
    function: {
      name: 'fs_glob',
      description:
        'Find files (not directories) matching a glob. Pattern without "/" matches basename at any depth (e.g. "*.ts"). Returns up to 100 paths by mtime.',
      parameters: {
        type: 'object',
        properties: {
          pattern: {
            type: 'string',
            description: 'Glob pattern, e.g. "**/*.ts" or "*.md".',
          },
          path: {
            type: 'string',
            description: 'Directory to search (workspace-relative). Default ".".',
          },
        },
        required: ['pattern'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'fs_grep',
      description:
        'Search file contents with a regular expression. Returns matching lines with line numbers (up to 250).',
      parameters: {
        type: 'object',
        properties: {
          pattern: {
            type: 'string',
            description: 'Regular expression to search for.',
          },
          path: {
            type: 'string',
            description: 'File or directory to search. Default ".".',
          },
          include: {
            type: 'string',
            description: 'Optional glob filter for files, e.g. "*.ts".',
          },
        },
        required: ['pattern'],
      },
    },
  },
];

export function fsToolsForAccess(access: AccessLevel) {
  const search = [...FS_TOOLS_SEARCH];
  if (access === 'readonly') return [...FS_TOOLS_READONLY, ...search];
  return [...FS_TOOLS_READONLY, ...FS_TOOLS_WRITE, ...search];
}

export async function fetchFsHealth(): Promise<FsHealth | null> {
  try {
    const res = await fetch(`${API}/health`, { signal: AbortSignal.timeout(1500) });
    if (!res.ok) return null;
    return (await res.json()) as FsHealth;
  } catch {
    return null;
  }
}

export async function fetchWorkspace(): Promise<WorkspaceInfo | null> {
  try {
    const res = await fetch(`${API}/workspace`, { signal: AbortSignal.timeout(1500) });
    if (!res.ok) return null;
    const data = (await res.json()) as WorkspaceInfo;
    return {
      ...data,
      items: Array.isArray(data.items) ? data.items : [],
    };
  } catch {
    return null;
  }
}

export async function selectWorkspace(path: string): Promise<WorkspaceInfo> {
  return mutateWorkspace({ action: 'select', path });
}

export async function addWorkspace(path: string): Promise<WorkspaceInfo> {
  return mutateWorkspace({ action: 'add', path });
}

export async function removeWorkspace(id: string): Promise<WorkspaceInfo> {
  return mutateWorkspace({ action: 'remove', id });
}

export async function renameWorkspace(id: string, name: string): Promise<WorkspaceInfo> {
  return mutateWorkspace({ action: 'rename', id, name });
}

/** 系统原生选文件夹；取消返回 null */
export async function pickDirectory(): Promise<string | null> {
  const res = await fetch(`${API}/pick-directory`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
  const data = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    canceled?: boolean;
    path?: string | null;
    error?: string;
  };
  if (!res.ok) {
    if (res.status === 404) {
      throw new Error('选文件夹接口未加载，请重启本地开发服务后再试');
    }
    throw new Error(data.error || `HTTP ${res.status}`);
  }
  if (data.canceled || !data.path) return null;
  return data.path;
}

/** @deprecated 用 selectWorkspace / addWorkspace */
export async function setWorkspace(path: string): Promise<WorkspaceInfo> {
  return selectWorkspace(path);
}

async function mutateWorkspace(body: Record<string, string>): Promise<WorkspaceInfo> {
  const res = await fetch(`${API}/workspace`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as WorkspaceInfo & { error?: string };
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return {
    ...data,
    items: Array.isArray(data.items) ? data.items : [],
  };
}

async function postJson(path: string, body: unknown): Promise<unknown> {
  const res = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err =
      typeof data === 'object' && data && 'error' in data
        ? String((data as { error: string }).error)
        : `HTTP ${res.status}`;
    throw new Error(err);
  }
  return data;
}

export async function runFsTool(
  name: string,
  argsJson: string,
  access: AccessLevel,
): Promise<string> {
  let args: Record<string, unknown> = {};
  try {
    args = JSON.parse(argsJson || '{}') as Record<string, unknown>;
  } catch {
    return JSON.stringify({ error: 'invalid JSON arguments' });
  }

  try {
    switch (name) {
      case 'fs_list':
        return JSON.stringify(await postJson('/list', { path: args.path ?? '.', access }));
      case 'fs_read':
        return JSON.stringify(await postJson('/read', { path: args.path, access }));
      case 'fs_write':
        return JSON.stringify(
          await postJson('/write', {
            path: args.path,
            content: args.content ?? '',
            access,
          }),
        );
      case 'fs_mkdir':
        return JSON.stringify(await postJson('/mkdir', { path: args.path, access }));
      case 'fs_glob':
        return JSON.stringify(
          await postJson('/glob', {
            pattern: args.pattern,
            path: args.path ?? '.',
            access,
          }),
        );
      case 'fs_grep':
        return JSON.stringify(
          await postJson('/grep', {
            pattern: args.pattern,
            path: args.path ?? '.',
            include: args.include,
            access,
          }),
        );
      default:
        return JSON.stringify({ error: `unknown tool: ${name}` });
    }
  } catch (e) {
    return JSON.stringify({ error: e instanceof Error ? e.message : String(e) });
  }
}

export function shortWorkspaceLabel(
  ws: string | undefined | null,
  projectRoot?: string | null,
): string {
  if (!ws) return '未设置工作区';
  const norm = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '');
  if (projectRoot && norm(ws) === norm(projectRoot)) return '默认工作区';
  const parts = norm(ws).split('/').filter(Boolean);
  const base = parts[parts.length - 1] || ws;
  // 项目根文件夹名常为仓库名 ai-testbench
  if (base === 'ai-testbench') return '默认工作区';
  return base;
}

/** 侧栏 / picker 工作区显示名：项目根固定为「默认工作区」 */
export function workspaceDisplayName(
  item: { id?: string; name: string; path: string },
  projectRoot?: string | null,
): string {
  if (item.id === 'ws_project') return '默认工作区';
  return shortWorkspaceLabel(item.path || item.name, projectRoot);
}

export interface WorkspaceFlatEntry {
  name: string;
  path: string;
  type: 'dir' | 'file';
}

/**
 * 浅层遍历当前工作区，供「@」引用列表（限深度与条数）。
 */
export async function listWorkspaceFlat(
  access: AccessLevel,
  opts?: { maxDepth?: number; maxEntries?: number },
): Promise<WorkspaceFlatEntry[]> {
  const maxDepth = opts?.maxDepth ?? 3;
  const maxEntries = opts?.maxEntries ?? 80;
  const out: WorkspaceFlatEntry[] = [];
  const skip = new Set(['node_modules', '.git', 'dist', '.local', '.astro', '.DS_Store']);

  async function walk(rel: string, depth: number) {
    if (out.length >= maxEntries || depth > maxDepth) return;
    let entries: Array<{ name: string; type: string; path: string }> = [];
    try {
      const data = (await postJson('/list', { path: rel, access })) as {
        entries?: Array<{ name: string; type: string; path: string }>;
      };
      entries = data.entries ?? [];
    } catch {
      return;
    }
    for (const e of entries) {
      if (out.length >= maxEntries) return;
      if (skip.has(e.name) || e.name.startsWith('.')) continue;
      const type: 'dir' | 'file' = e.type === 'dir' ? 'dir' : 'file';
      out.push({ name: e.name, path: e.path, type });
      if (type === 'dir' && depth < maxDepth) {
        await walk(e.path, depth + 1);
      }
    }
  }

  await walk('.', 0);
  return out;
}
