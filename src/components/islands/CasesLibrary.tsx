import { useCallback, useEffect, useMemo, useState } from 'react';
import { docRootLabelPath } from '../../lib/doc-roots';
import {
  deleteDocs,
  fetchDocsHealth,
  listDocs,
  openDocsFile,
  type DocsEntry,
} from '../../lib/project-docs';
import { openDocsInChatSession } from '../../lib/open-docs-in-session';
import { hydrateSessionStore } from '../../lib/sessions';
import ConfirmDialog from './ConfirmDialog';

function fmtSize(n?: number) {
  if (n == null) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function fmtTime(ts?: number) {
  if (!ts) return '—';
  try {
    return new Date(ts).toLocaleString('zh-CN', {
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '—';
  }
}

/** Excel/Office 打开文件时留下的临时锁文件（如 ~$xxx.xlsx） */
function isOfficeLockCache(path: string): boolean {
  const base = path.split('/').pop() ?? path;
  return base.startsWith('~$') || base.startsWith('.~');
}

async function walkCaseFiles(dir = '.'): Promise<DocsEntry[]> {
  const { entries } = await listDocs('cases', dir);
  const files: DocsEntry[] = [];
  for (const e of entries) {
    if (e.type === 'file') {
      if (!isOfficeLockCache(e.path) && !isOfficeLockCache(e.name)) files.push(e);
    } else {
      files.push(...(await walkCaseFiles(e.path)));
    }
  }
  files.sort((a, b) => (b.mtime ?? 0) - (a.mtime ?? 0));
  return files;
}

export default function CasesLibrary() {
  const [live, setLive] = useState(false);
  const [files, setFiles] = useState<DocsEntry[]>([]);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<
    { kind: 'one'; entry: DocsEntry } | { kind: 'batch'; paths: string[] } | null
  >(null);

  const refresh = useCallback(async () => {
    setError(null);
    const listed = await walkCaseFiles('.');
    setFiles(listed);
    setSelected((prev) => {
      const next: Record<string, boolean> = {};
      for (const f of listed) {
        if (prev[f.path]) next[f.path] = true;
      }
      return next;
    });
  }, []);

  useEffect(() => {
    void (async () => {
      const ok = await fetchDocsHealth('cases');
      setLive(ok);
      if (!ok) return;
      try {
        await hydrateSessionStore().catch(() => null);
        await refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
  }, [refresh]);

  const selectedPaths = useMemo(() => Object.keys(selected).filter((p) => selected[p]), [selected]);
  const allChecked = files.length > 0 && selectedPaths.length === files.length;
  const someChecked = selectedPaths.length > 0 && !allChecked;

  async function confirmDelete() {
    const target = deleteTarget;
    if (!target) return;
    setDeleteTarget(null);
    setBusy(true);
    setError(null);
    try {
      if (target.kind === 'one') {
        await deleteDocs('cases', target.entry.path);
      } else {
        for (const p of target.paths) {
          await deleteDocs('cases', p);
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
      ? `删除「${deleteTarget.entry.name}」？将从 ${docRootLabelPath('cases')} 中移除。`
      : deleteTarget?.kind === 'batch'
        ? `确认删除已选中的 ${deleteTarget.paths.length} 个用例文件？此操作不可恢复。`
        : '';

  async function openInSession(entry: DocsEntry) {
    setBusy(true);
    setError(null);
    try {
      await openDocsInChatSession('cases', entry);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  async function openLocal(entry: DocsEntry | string) {
    const p = typeof entry === 'string' ? entry : entry.path;
    setError(null);
    try {
      await openDocsFile('cases', p);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
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

  if (!live) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 px-5 py-8 text-sm text-amber-900">
        用例管理需要本地文档服务，当前未就绪。
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-stone-200 bg-white min-h-[520px] flex flex-col overflow-hidden">
      <div className="px-4 py-3 border-b border-stone-100 flex items-center gap-2 flex-wrap">
        <div className="text-sm text-stone-600 flex-1 min-w-0">
          共 <span className="font-medium text-stone-800">{files.length}</span> 个文件
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
      </div>

      {error ? (
        <div className="mx-4 mt-3 px-3 py-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg">
          {error}
        </div>
      ) : null}

      <div className="flex-1 overflow-y-auto p-4">
        {files.length === 0 ? (
          <p className="text-sm text-stone-400 py-10 text-center border border-dashed border-stone-200 rounded-lg">
            暂无用例文件。请在「我的工作台」通过「生成测试用例」插件生成并自动入库。
          </p>
        ) : (
          <ul className="tw-anim-list divide-y divide-stone-100 border border-stone-200 rounded-lg overflow-hidden">
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
              <span className="flex-1 min-w-0">文件名</span>
              <span className="w-[9.5rem] shrink-0">创建时间</span>
              <span className="w-[9.5rem] shrink-0">修改时间</span>
              <span className="w-16 text-right shrink-0">大小</span>
              <span className="w-52 shrink-0 text-right">操作</span>
            </li>
            {files.map((f) => (
              <li
                key={f.path}
                className="flex items-center gap-2 px-3 py-2.5 transition-colors duration-150 hover:bg-[color:var(--tw-accent-soft)] cursor-default"
                title="双击本地打开"
                onDoubleClick={(e) => {
                  e.preventDefault();
                  void openLocal(f);
                }}
              >
                <input
                  type="checkbox"
                  checked={Boolean(selected[f.path])}
                  disabled={busy}
                  onChange={() => setSelected((m) => ({ ...m, [f.path]: !m[f.path] }))}
                  onDoubleClick={(e) => e.stopPropagation()}
                  className="rounded border-stone-300"
                  aria-label={`选择 ${f.name}`}
                />
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-stone-800 truncate">{f.name}</div>
                  <div className="text-[11px] text-stone-400 truncate">{f.path}</div>
                </div>
                <span className="w-[9.5rem] text-[11px] text-stone-500 shrink-0 tabular-nums">
                  {fmtTime(f.ctime ?? f.mtime)}
                </span>
                <span className="w-[9.5rem] text-[11px] text-stone-500 shrink-0 tabular-nums">
                  {fmtTime(f.mtime)}
                </span>
                <span className="w-16 text-right text-[11px] text-stone-400 shrink-0">
                  {fmtSize(f.size)}
                </span>
                <div
                  className="w-52 shrink-0 flex justify-end gap-1 flex-wrap"
                  onDoubleClick={(e) => e.stopPropagation()}
                >
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void openLocal(f)}
                    className="text-xs text-[#4176e6] px-2 py-1 rounded hover:bg-[#e8f0fe]"
                  >
                    本地打开
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void openInSession(f)}
                    className="text-xs text-white bg-[#4176e6] px-2 py-1 rounded hover:bg-[#3565c7]"
                  >
                    在会话中打开
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => setDeleteTarget({ kind: 'one', entry: f })}
                    className="text-xs text-red-600 px-2 py-1 rounded hover:bg-red-50"
                  >
                    删除
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <ConfirmDialog
        open={deleteTarget != null}
        title={deleteTarget?.kind === 'batch' ? '批量删除' : '删除用例文件'}
        message={deleteMessage}
        confirmLabel="删除"
        cancelLabel="取消"
        danger
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => void confirmDelete()}
      />
    </div>
  );
}
