import { useCallback, useEffect, useRef, useState } from 'react';
import { docRootLabelPath } from '../../lib/doc-roots';
import {
  deleteDocs,
  fetchDocsHealth,
  fetchDocsTree,
  listDocs,
  mkdirDocs,
  openDocsFile,
  readDocsText,
  uploadDocsFile,
  type DocsEntry,
  type DocsTreeNode,
} from '../../lib/project-docs';
import ConfirmDialog from './ConfirmDialog';
import NamePromptDialog from './NamePromptDialog';

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      className={`w-3.5 h-3.5 text-stone-400 transition-transform shrink-0 ${open ? 'rotate-90' : ''}`}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
    >
      <path d="M7 5l6 5-6 5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function FolderIcon({ className = 'w-4 h-4', open = false }: { className?: string; open?: boolean }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
    >
      {open ? (
        <path d="M6 14l1.45-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.55 6a2 2 0 0 1-1.94 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2" />
      ) : (
        <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" />
      )}
    </svg>
  );
}

function TreeNode({
  node,
  depth,
  activePath,
  expanded,
  onToggle,
  onSelect,
}: {
  node: DocsTreeNode;
  depth: number;
  activePath: string;
  expanded: Record<string, boolean>;
  onToggle: (p: string) => void;
  onSelect: (p: string) => void;
}) {
  const open = expanded[node.path] ?? depth < 1;
  const active = activePath === node.path;
  return (
    <div>
      <button
        type="button"
        onClick={() => {
          onSelect(node.path);
          if (node.children.length) onToggle(node.path);
        }}
        className={`w-full flex items-center gap-1.5 py-1.5 pr-2 rounded-md text-sm text-left ${
          active ? 'bg-[#e8f0fe] text-[#4176e6]' : 'text-stone-600 hover:bg-stone-100'
        }`}
        style={{ paddingLeft: 8 + depth * 12 }}
      >
        {node.children.length ? (
          <span
            onClick={(e) => {
              e.stopPropagation();
              onToggle(node.path);
            }}
          >
            <Chevron open={open} />
          </span>
        ) : (
          <span className="w-3.5" />
        )}
        <FolderIcon
          open={Boolean(node.children.length && open)}
          className={`w-3.5 h-3.5 shrink-0 ${active ? 'text-[#4176e6]' : 'text-amber-500'}`}
        />
        <span className="truncate">{node.name}</span>
      </button>
      {open
        ? node.children.map((c) => (
            <TreeNode
              key={c.path}
              node={c}
              depth={depth + 1}
              activePath={activePath}
              expanded={expanded}
              onToggle={onToggle}
              onSelect={onSelect}
            />
          ))
        : null}
    </div>
  );
}

function fmtSize(n?: number) {
  if (n == null) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export default function RequirementsLibrary() {
  const [live, setLive] = useState(false);
  const [tree, setTree] = useState<DocsTreeNode[]>([]);
  const [activePath, setActivePath] = useState('.');
  const [entries, setEntries] = useState<DocsEntry[]>([]);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<{ path: string; content: string } | null>(null);
  const [mkdirOpen, setMkdirOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<DocsEntry | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(
    async (dir = activePath) => {
      setError(null);
      try {
        const [t, listed] = await Promise.all([
          fetchDocsTree('requirements'),
          listDocs('requirements', dir),
        ]);
        setTree(t);
        setEntries(listed.entries);
        setActivePath(listed.path);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [activePath],
  );

  useEffect(() => {
    void (async () => {
      const ok = await fetchDocsHealth('requirements');
      setLive(ok);
      if (!ok) return;
      try {
        const [t, listed] = await Promise.all([
          fetchDocsTree('requirements'),
          listDocs('requirements', '.'),
        ]);
        setTree(t);
        setEntries(listed.entries);
        setActivePath(listed.path);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
  }, []);

  async function selectDir(p: string) {
    setActivePath(p);
    setPreview(null);
    setError(null);
    try {
      const listed = await listDocs('requirements', p);
      setEntries(listed.entries);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function onMkdirConfirm(name: string) {
    setMkdirOpen(false);
    setBusy(true);
    setError(null);
    try {
      await mkdirDocs('requirements', activePath, name);
      await refresh(activePath);
      setTree(await fetchDocsTree('requirements'));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function onOpenLocal(entry: DocsEntry) {
    if (entry.type !== 'file') return;
    setBusy(true);
    setError(null);
    try {
      await openDocsFile('requirements', entry.path);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function onUpload(files: FileList | null) {
    if (!files?.length) return;
    setBusy(true);
    setError(null);
    try {
      for (const f of Array.from(files)) {
        await uploadDocsFile('requirements', activePath, f);
      }
      await refresh(activePath);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  function requestDelete(entry: DocsEntry) {
    setDeleteTarget(entry);
  }

  async function confirmDelete() {
    const entry = deleteTarget;
    if (!entry) return;
    setDeleteTarget(null);
    setBusy(true);
    setError(null);
    try {
      await deleteDocs('requirements', entry.path);
      if (preview?.path === entry.path) setPreview(null);
      await refresh(activePath);
      setTree(await fetchDocsTree('requirements'));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const deleteMessage =
    deleteTarget?.type === 'dir'
      ? `删除空文件夹「${deleteTarget.name}」？`
      : deleteTarget
        ? `删除文件「${deleteTarget.name}」？将从需求库中移除。`
        : '';

  async function onPreview(entry: DocsEntry) {
    if (entry.type !== 'file') return;
    const lower = entry.name.toLowerCase();
    if (!lower.endsWith('.md') && !lower.endsWith('.txt')) {
      setError('仅 .md / .txt 支持预览；docx 请用「本地打开」查看。');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const r = await readDocsText('requirements', entry.path);
      setPreview({ path: r.path, content: r.content });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (!live) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 px-5 py-8 text-sm text-amber-900">
        需求文档库需要本地文档服务，当前未就绪。
      </div>
    );
  }

  const files = entries.filter((e) => e.type === 'file');
  const dirs = entries.filter((e) => e.type === 'dir');

  return (
    <div className="flex gap-4 min-h-[560px]">
      <aside className="w-56 shrink-0 rounded-xl border border-stone-200 bg-white flex flex-col overflow-hidden">
        <div className="px-3 py-2.5 border-b border-stone-100 flex items-center justify-between">
          <span className="text-xs font-semibold text-stone-500">文件夹</span>
          <button
            type="button"
            disabled={busy}
            onClick={() => setMkdirOpen(true)}
            className="tw-mkdir-btn disabled:opacity-40"
          >
            + 新建
          </button>
        </div>
        <div className="flex-1 overflow-y-auto py-2 px-1">
          <button
            type="button"
            onClick={() => void selectDir('.')}
            className={`w-full flex items-center gap-1.5 px-2 py-1.5 rounded-md text-sm text-left ${
              activePath === '.'
                ? 'bg-[#e8f0fe] text-[#4176e6]'
                : 'text-stone-600 hover:bg-stone-100'
            }`}
          >
            <FolderIcon className="w-3.5 h-3.5 text-amber-500" />
            <span>全部需求</span>
          </button>
          {tree.map((n) => (
            <TreeNode
              key={n.path}
              node={n}
              depth={0}
              activePath={activePath}
              expanded={expanded}
              onToggle={(p) => setExpanded((m) => ({ ...m, [p]: !(m[p] ?? false) }))}
              onSelect={(p) => void selectDir(p)}
            />
          ))}
        </div>
      </aside>

      <section className="flex-1 min-w-0 rounded-xl border border-stone-200 bg-white flex flex-col overflow-hidden">
        <div className="px-4 py-3 border-b border-stone-100 flex items-center gap-2 flex-wrap">
          <div className="text-sm text-stone-600 flex-1 min-w-0 truncate">
            <span className="text-stone-400">{docRootLabelPath('requirements')}</span>
            {activePath === '.' ? '' : activePath}
          </div>
          <input
            ref={fileRef}
            type="file"
            multiple
            accept=".md,.txt,.docx,text/plain,text/markdown,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            className="hidden"
            onChange={(e) => void onUpload(e.target.files)}
          />
          <button
            type="button"
            disabled={busy}
            onClick={() => fileRef.current?.click()}
            className="h-8 px-3 text-sm font-medium text-white bg-[#4176e6] rounded-lg hover:bg-[#3565c7] disabled:opacity-40"
          >
            上传文件
          </button>
        </div>

        {error ? (
          <div className="mx-4 mt-3 px-3 py-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg">
            {error}
          </div>
        ) : null}

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {dirs.length > 0 && (
            <div>
              <div className="text-xs font-medium text-stone-400 mb-2">子文件夹</div>
              <ul className="space-y-1">
                {dirs.map((d) => (
                  <li
                    key={d.path}
                    className="flex items-center gap-2 px-3 py-2 rounded-lg border border-stone-100 hover:bg-stone-50"
                  >
                    <button
                      type="button"
                      className="flex-1 min-w-0 flex items-center gap-2 text-left text-sm text-stone-700"
                      onClick={() => void selectDir(d.path)}
                    >
                      <FolderIcon className="w-4 h-4 text-amber-500 shrink-0" />
                      <span className="truncate">{d.name}</span>
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => requestDelete(d)}
                      className="text-xs text-red-600 hover:bg-red-50 px-2 py-1 rounded"
                    >
                      删除
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div>
            <div className="text-xs font-medium text-stone-400 mb-2">文件</div>
            {files.length === 0 ? (
              <p className="text-sm text-stone-400 py-6 text-center border border-dashed border-stone-200 rounded-lg">
                当前文件夹为空，点击「上传文件」添加需求文档（.md / .txt / .docx）
              </p>
            ) : (
              <ul className="space-y-1">
                {files.map((f) => (
                  <li
                    key={f.path}
                    className="flex items-center gap-2 px-3 py-2 rounded-lg border border-stone-100 hover:bg-stone-50"
                  >
                    <button
                      type="button"
                      className="flex-1 min-w-0 text-left"
                      title="单击预览，双击本地打开"
                      onClick={() => void onPreview(f)}
                      onDoubleClick={(e) => {
                        e.preventDefault();
                        void onOpenLocal(f);
                      }}
                    >
                      <div className="text-sm text-stone-800 truncate">{f.name}</div>
                      <div className="text-[11px] text-stone-400">{fmtSize(f.size)}</div>
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void onOpenLocal(f)}
                      className="text-xs text-[#4176e6] hover:bg-[#e8f0fe] px-2 py-1 rounded"
                    >
                      本地打开
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => requestDelete(f)}
                      className="text-xs text-red-600 hover:bg-red-50 px-2 py-1 rounded"
                    >
                      删除
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {preview ? (
            <div className="rounded-lg border border-stone-200 overflow-hidden">
              <div className="px-3 py-2 bg-stone-50 border-b border-stone-200 flex items-center justify-between">
                <span className="text-xs text-stone-500 truncate">{preview.path}</span>
                <button
                  type="button"
                  className="text-xs text-stone-500 hover:text-stone-800"
                  onClick={() => setPreview(null)}
                >
                  关闭预览
                </button>
              </div>
              <pre className="max-h-80 overflow-auto p-4 text-xs leading-5 text-stone-700 whitespace-pre-wrap bg-white">
                {preview.content}
              </pre>
            </div>
          ) : null}
        </div>
      </section>

      <NamePromptDialog
        open={mkdirOpen}
        title="新建文件夹"
        onClose={() => setMkdirOpen(false)}
        onConfirm={(name) => void onMkdirConfirm(name)}
      />
      <ConfirmDialog
        open={deleteTarget != null}
        title={deleteTarget?.type === 'dir' ? '删除文件夹' : '删除需求文件'}
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
