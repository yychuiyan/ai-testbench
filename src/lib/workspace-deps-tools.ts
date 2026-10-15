/**
 * workspace-dependencies：模型可加载本机 Node/Python 等工具绝对路径。
 */

const API = '/__tb_fs';

export const WORKSPACE_DEPS_HINT =
  '你可以使用 load_workspace_dependencies：查询本机 node / npm / pnpm / python 等可执行文件绝对路径（需本地 fs 服务）。';

export const WORKSPACE_DEPS_TOOL = {
  type: 'function' as const,
  function: {
    name: 'load_workspace_dependencies',
    description:
      'Resolve absolute paths of common runtimes/package managers on this machine (node, npm, pnpm, python, …).',
    parameters: { type: 'object', properties: {} },
  },
};

export async function runWorkspaceDepsTool(name: string): Promise<string> {
  if (name !== 'load_workspace_dependencies') {
    return JSON.stringify({ error: `unknown tool: ${name}` });
  }
  try {
    const res = await fetch(`${API}/workspace-dependencies`, {
      signal: AbortSignal.timeout(8000),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err =
        typeof data === 'object' && data && 'error' in data
          ? String((data as { error: string }).error)
          : `HTTP ${res.status}`;
      return JSON.stringify({ ok: false, error: err });
    }
    return JSON.stringify(data, null, 2);
  } catch (e) {
    return JSON.stringify({
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    });
  }
}
