/**
 * 知识库管理：平铺列表 + 生成入库。
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { docRootLabelPath } from '../../lib/doc-roots';
import { isPluginEnabled, pluginDisabledMessage } from '../../lib/plugins';
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

async function walkKnowledgeFiles(dir = '.'): Promise<DocsEntry[]> {
  const { entries } = await listDocs('knowledge', dir);
  const files: DocsEntry[] = [];
  for (const e of entries) {
    if (e.type === 'file') {
      if (e.name.endsWith('.md')) files.push(e);
    } else {
      files.push(...(await walkKnowledgeFiles(e.path)));
    }
  }
  files.sort((a, b) => (b.mtime ?? 0) - (a.mtime ?? 0));
  return files;
}

const ROW_HOVER =
  'transition-colors duration-150 hover:bg-stone-50 hover:shadow-[inset_3px_0_0_0_var(--tw-accent)] cursor-pointer';

interface Props {
  staticCount?: number;
  base: string;
}

type DeleteTarget = { kind: 'one'; entry: DocsEntry } | { kind: 'batch'; paths: string[] } | null;

export default function KnowledgeLibrary({ staticCount = 0, base }: Props) {
  const [live, setLive] = useState(false);
  const [files, setFiles] = useState<DocsEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget>(null);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      setFiles(await walkKnowledgeFiles('.'));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void (async () => {
      const ok = await fetchDocsHealth('knowledge');
      setLive(ok);
      if (!ok) return;
      await hydrateSessionStore().catch(() => null);
      await refresh();
    })();
  }, [refresh]);

  const selectedPaths = useMemo(() => Object.keys(selected).filter((p) => selected[p]), [selected]);
  const allChecked = files.length > 0 && selectedPaths.length === files.length;
  const someChecked = selectedPaths.length > 0 && !allChecked;

  function goGenerate() {
    if (!isPluginEnabled('knowledgeGen')) {
      setError(pluginDisabledMessage('knowledgeGen'));
      return;
    }
    window.location.href = `${base}?plugin=knowledgeGen`;
  }

  async function onOpenLocal(entry: DocsEntry) {
    setBusy(true);
    setError(null);
    try {
      await openDocsFile('knowledge', entry.path);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function openInSession(entry: DocsEntry) {
    setBusy(true);
    setError(null);
    try {
      await hydrateSessionStore().catch(() => null);
      const store = loadSessionStore();
      const chat = findChatSessionByDocsPath(store, 'knowledge', entry.path);
      if (chat) {
        const q = new URLSearchParams({
          session: chat.id,
          focusRoot: 'knowledge',
          focusPath: entry.path,
        });
        window.location.href = `${base}?${q.toString()}`;
        return;
      }
      setError(
        '未找到关联的工作台会话。请在「我的工作台」用「生成知识库」插件生成并入库后，再从此处跳转。',
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  function toggleAll() {
    if (allChecked) {
      setSelected({});
      return;
    }
    const next: Record<string, boolean> = {};
    for (const f of files) next[f.path] = true;
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
        await deleteDocs('knowledge', target.entry.path);
      } else {
        for (const p of target.paths) {
          await deleteDocs('knowledge', p);
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

  const deleteMessage =
    deleteTarget?.kind === 'one'
      ? `删除「${deleteTarget.entry.name}」？将从 ${docRootLabelPath('knowledge')} 中移除。`
      : deleteTarget?.kind === 'batch'
        ? `确认删除已选中的 ${deleteTarget.paths.length} 个知识库文件？此操作不可恢复。`
        : '';

  if (!live) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 px-5 py-8 text-sm text-amber-900">
        知识库管理需要本地文档服务，当前未就绪
        {staticCount > 0 ? `（构建期约有 ${staticCount} 份文档可浏览）` : ''}。
      </div>
    );
  }

  return (
    <section className="rounded-xl border border-stone-200 bg-white overflow-hidden">
      <div className="px-4 py-3 border-b border-stone-100 flex items-center gap-2 flex-wrap">
        <div className="text-sm text-stone-600 flex-1 min-w-0">
          共 <span className="font-medium text-stone-800">{files.length}</span> 个知识库文件
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
          onClick={goGenerate}
          className="h-8 px-3 text-sm font-medium text-white bg-[#4176e6] rounded-lg hover:bg-[#3565c7] disabled:opacity-40"
        >
          生成知识库
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
            暂无知识库文件，点击「生成知识库」前往我的工作台。
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
              const cat = f.path.includes('/') ? f.path.split('/')[0] : '';
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
                    disabled={busy}
                    onChange={() => setSelected((m) => ({ ...m, [f.path]: !m[f.path] }))}
                    onDoubleClick={(e) => e.stopPropagation()}
                    onClick={(e) => e.stopPropagation()}
                    className="rounded border-stone-300"
                    aria-label={`选择 ${f.name}`}
                  />
                  <div className="flex-1 min-w-0 text-left">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-sm text-stone-800 truncate">{f.name}</span>
                      {cat ? (
                        <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded bg-amber-50 text-amber-800 border border-amber-100">
                          {cat}
                        </span>
                      ) : null}
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
                      disabled={busy}
                      onClick={() => setDeleteTarget({ kind: 'one', entry: f })}
                      className="text-xs text-red-600 hover:bg-red-50 px-2 py-1 rounded cursor-pointer disabled:opacity-40"
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
        title={deleteTarget?.kind === 'batch' ? '批量删除' : '删除知识库文件'}
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
