/**
 * workspace-changes：本会话内工作区写操作追踪（fs_write / fs_mkdir）。
 */

export type WorkspaceChangeOp = 'write' | 'mkdir';

export interface WorkspaceChange {
  path: string;
  op: WorkspaceChangeOp;
  at: number;
}

export const MAX_WORKSPACE_CHANGES = 100;

export const WORKSPACE_CHANGES_HINT =
  '你可以使用工作区变更工具：\n' +
  '- workspace_changes_list：查看本会话内已记录的写文件/建目录\n' +
  '- workspace_changes_clear：清空本会话变更记录（不回滚磁盘文件）';

export const WORKSPACE_CHANGES_TOOLS = [
  {
    type: 'function' as const,
    function: {
      name: 'workspace_changes_list',
      description:
        'List workspace file mutations recorded in this chat session (fs_write / fs_mkdir).',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'workspace_changes_clear',
      description: 'Clear the in-session workspace change log (does not delete files on disk).',
      parameters: { type: 'object', properties: {} },
    },
  },
];

export function normalizeChangePath(p: string): string {
  return String(p ?? '')
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\.\//, '');
}

export function recordWorkspaceChange(
  list: WorkspaceChange[] | undefined | null,
  entry: { path: string; op: WorkspaceChangeOp; at?: number },
): WorkspaceChange[] {
  const path = normalizeChangePath(entry.path);
  if (!path) return Array.isArray(list) ? [...list] : [];
  const next: WorkspaceChange = {
    path,
    op: entry.op,
    at: entry.at ?? Date.now(),
  };
  const prev = Array.isArray(list) ? list.filter((c) => normalizeChangePath(c.path) !== path) : [];
  return [...prev, next].slice(-MAX_WORKSPACE_CHANGES);
}

/** 从 fs_write / fs_mkdir 工具 JSON 结果解析成功路径 */
export function parseFsMutationSuccess(
  toolName: string,
  resultJson: string,
): { path: string; op: WorkspaceChangeOp } | null {
  if (toolName !== 'fs_write' && toolName !== 'fs_mkdir') return null;
  try {
    const data = JSON.parse(resultJson || '{}') as { ok?: boolean; path?: string; error?: string };
    if (data.error || data.ok === false) return null;
    const path = normalizeChangePath(String(data.path ?? ''));
    if (!path) return null;
    return { path, op: toolName === 'fs_mkdir' ? 'mkdir' : 'write' };
  } catch {
    return null;
  }
}

export function runWorkspaceChangesTool(
  name: string,
  list: WorkspaceChange[] | undefined | null,
): { text: string; next?: WorkspaceChange[] } {
  if (name === 'workspace_changes_list') {
    const changes = Array.isArray(list) ? list : [];
    return {
      text: JSON.stringify(
        {
          ok: true,
          count: changes.length,
          changes: changes.map((c) => ({
            path: c.path,
            op: c.op,
            at: new Date(c.at).toISOString(),
          })),
        },
        null,
        2,
      ),
    };
  }
  if (name === 'workspace_changes_clear') {
    return {
      text: JSON.stringify({ ok: true, cleared: true, count: 0 }),
      next: [],
    };
  }
  return { text: JSON.stringify({ error: `unknown tool: ${name}` }) };
}
