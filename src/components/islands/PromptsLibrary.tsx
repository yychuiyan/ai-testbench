import { useCallback, useEffect, useMemo, useState } from 'react';
import { docRootLabelPath } from '../../lib/doc-roots';
import { isPluginEnabled, pluginDisabledMessage } from '../../lib/plugins';
import { isProtectedPrompt } from '../../lib/prompts-meta';
import {
  deleteDocs,
  fetchDocsHealth,
  listDocs,
  openDocsFile,
  type DocsEntry,
} from '../../lib/project-docs';
import {
  findChatSessionByDocsPath,
  hydrateSessionStore,
  loadSessionStore,
} from '../../lib/sessions';
import ConfirmDialog from './ConfirmDialog';

function fmtSize(n?: number) {
  if (n == null) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

async function walkPromptFiles(dir = '.'): Promise<DocsEntry[]> {
  const { entries } = await listDocs('prompts', dir);
  const files: DocsEntry[] = [];
  for (const e of entries) {
    if (e.type === 'file') files.push(e);
    else files.push(...(await walkPromptFiles(e.path)));
  }
  files.sort((a, b) => (b.mtime ?? 0) - (a.mtime ?? 0));
  return files;
}

const ROW_HOVER =
  'transition-colors duration-150 hover:bg-stone-50 hover:shadow-[inset_3px_0_0_0_var(--tw-accent)] cursor-pointer';

type DeleteTarget = { kind: 'one'; entry: DocsEntry } | { kind: 'batch'; paths: string[] } | null;

export default function PromptsLibrary() {
  const [live, setLive] = useState(false);
  const [files, setFiles] = useState<DocsEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget>(null);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      setFiles(await walkPromptFiles('.'));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void (async () => {
      const ok = await fetchDocsHealth('prompts');
      setLive(ok);
      if (!ok) return;
      await hydrateSessionStore().catch(() => null);
      await refresh();
    })();
  }, [refresh]);

  const selectedPaths = useMemo(() => Object.keys(selected).filter((p) => selected[p]), [selected]);
  const allChecked = files.length > 0 && selectedPaths.length === files.length;
  const someChecked = selectedPaths.length > 0 && !allChecked;

  async function onOpenLocal(entry: DocsEntry) {
    setBusy(true);
    setError(null);
    try {
      await openDocsFile('prompts', entry.path);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function openInSession(entry: DocsEntry) {
    const base = import.meta.env.BASE_URL || '/';
    setBusy(true);
    setError(null);
    try {
      await hydrateSessionStore().catch(() => null);
      const store = loadSessionStore();
      const chat = findChatSessionByDocsPath(store, 'prompts', entry.path);
      if (chat) {
        const q = new URLSearchParams({
          session: chat.id,
          focusRoot: 'prompts',
          focusPath: entry.path,
        });
        window.location.href = `${base}?${q.toString()}`;
        return;
      }
      setError(
        '未找到关联的工作台会话。请在「我的工作台」用「生成提示词」插件生成并入库后，再从此处跳转。',
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  function onDelete(entry: DocsEntry) {
    if (isProtectedPrompt(entry.path)) {
      setError('系统提示词不可删除');
      return;
    }
    setDeleteTarget({ kind: 'one', entry });
  }

  function toggleAll() {
    if (allChecked) {
      setSelected({});
      return;
    }
    const next: Record<string, boolean> = {};
    for (const f of files) {
      if (!isProtectedPrompt(f.path)) next[f.path] = true;
    }
    setSelected(next);
  }

  async function confirmDelete() {
    const target = deleteTarget;
    if (!target) return;
    setDeleteTarget(null);
    setBusy(true);
    setError(null);
    try {
      if (target.kind === 'one') {
        await deleteDocs('prompts', target.entry.path);
      } else {
        for (const p of target.paths) {
          if (isProtectedPrompt(p)) continue;
          await deleteDocs('prompts', p);
        }
        setSelected({});
      }
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  function goGeneratePrompt() {
    if (!isPluginEnabled('promptGen')) {
      setError(pluginDisabledMessage('promptGen'));
      return;
    }
    const base = import.meta.env.BASE_URL || '/';
    window.location.href = `${base}?plugin=promptGen`;
  }

  const deleteMessage =
    deleteTarget?.kind === 'one'
      ? `删除「${deleteTarget.entry.name}」？将从 ${docRootLabelPath('prompts')} 中移除。`
      : deleteTarget?.kind === 'batch'
        ? `确认删除已选中的 ${deleteTarget.paths.length} 个提示词？此操作不可恢复。`
        : '';

  if (!live) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 px-5 py-8 text-sm text-amber-900">
        提示词管理需要本地文档服务，当前未就绪。
      </div>
    );
  }

  return (
    <section className="rounded-xl border border-stone-200 bg-white overflow-hidden">
      <div className="px-4 py-3 border-b border-stone-100 flex items-center gap-2 flex-wrap">
        <div className="text-sm text-stone-600 flex-1 min-w-0">
          共 <span className="font-medium text-stone-800">{files.length}</span> 个提示词
          {selectedPaths.length > 0 ? (
            <span className="text-stone-400"> · 已选 {selectedPaths.length}</span>
          ) : null}
        </div>
        <button
          type="button"
          disabled={busy || selectedPaths.length === 0}
          onClick={() => setDeleteTarget({ kind: 'batch', paths: selectedPaths })}
          className="h-8 px-3 text-sm font-medium text-red-600 border border-red-200 rounded-lg hover:bg-red-50 disabled:opacity-40"
        >
          批量删除
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={goGeneratePrompt}
          className="h-8 px-3 text-sm font-medium text-white bg-[#4176e6] rounded-lg hover:bg-[#3565c7] disabled:opacity-40"
        >
          生成提示词
        </button>
      </div>

      {error ? (
        <div className="mx-4 mt-3 px-3 py-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg">
          {error}
        </div>
      ) : null}

      <div className="p-4">
        {files.length === 0 ? (
          <p className="text-sm text-stone-400 py-10 text-center border border-dashed border-stone-200 rounded-lg">
            暂无提示词，点击「生成提示词」前往我的工作台；
          </p>
        ) : (
          <ul className="divide-y divide-stone-100 border border-stone-200 rounded-lg overflow-hidden">
            <li className="flex items-center gap-2 px-3 py-2 bg-stone-50 text-xs text-stone-500">
              <input
                type="checkbox"
                checked={allChecked}
                ref={(el) => {
                  if (el) el.indeterminate = someChecked;
                }}
                onChange={toggleAll}
                disabled={busy}
                className="rounded border-stone-300"
                aria-label="全选"
              />
              <span className="flex-1 min-w-0">文件</span>
              <span className="w-56 shrink-0 text-right">操作</span>
            </li>
            {files.map((f) => {
              const locked = isProtectedPrompt(f.path);
              return (
                <li
                  key={f.path}
                  className={`flex items-center gap-2 px-3 py-2.5 ${ROW_HOVER}`}
                  title="双击本地打开"
                  onDoubleClick={() => void onOpenLocal(f)}
                >
                  <input
                    type="checkbox"
                    checked={Boolean(selected[f.path])}
                    disabled={busy || locked}
                    onChange={() => setSelected((m) => ({ ...m, [f.path]: !m[f.path] }))}
                    onDoubleClick={(e) => e.stopPropagation()}
                    onClick={(e) => e.stopPropagation()}
                    className="rounded border-stone-300"
                    aria-label={`选择 ${f.name}`}
                  />
                  <div className="flex-1 min-w-0 text-left">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-sm text-stone-800 truncate">{f.name}</span>
                    </div>
                    <div className="text-[11px] text-stone-400 truncate">
                      {f.path}
                      {f.size != null ? ` · ${fmtSize(f.size)}` : ''}
                    </div>
                  </div>
                  <div
                    className="w-56 shrink-0 flex justify-end gap-1 flex-wrap"
                    onDoubleClick={(e) => e.stopPropagation()}
                  >
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void onOpenLocal(f)}
                      className="text-xs text-[#4176e6] hover:bg-[#e8f0fe] px-2 py-1 rounded cursor-pointer"
                    >
                      本地打开
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void openInSession(f)}
                      className="text-xs text-white bg-[#4176e6] px-2 py-1 rounded hover:bg-[#3565c7] cursor-pointer disabled:opacity-40"
                    >
                      在会话中打开
                    </button>
                    <button
                      type="button"
                      disabled={busy || locked}
                      title={locked ? '系统提示词不可删除' : undefined}
                      onClick={() => onDelete(f)}
                      className="text-xs text-red-600 hover:bg-red-50 px-2 py-1 rounded cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent"
                    >
                      删除
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <ConfirmDialog
        open={deleteTarget != null}
        title={deleteTarget?.kind === 'batch' ? '批量删除' : '删除提示词'}
        message={deleteMessage}
        confirmLabel="删除"
        cancelLabel="取消"
        danger
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => void confirmDelete()}
      />
    </section>
  );
}
