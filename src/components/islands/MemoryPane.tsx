/**
 * 对话区「记忆」Tab：五轨浏览、待确认、便签、设置。
 */
import { useCallback, useEffect, useState } from 'react';
import {
  approveSuggestion,
  archiveEntry,
  deleteArchiveEntry,
  deleteMemoryEntry,
  fetchArchives,
  fetchMemoryConfig,
  fetchMemoryHealth,
  fetchMemoryTracks,
  fetchScratch,
  fetchSuggestions,
  manualAddMemory,
  promoteArchive,
  rejectSuggestion,
  saveMemoryConfig,
  saveScratch,
  type MemoryConfig,
  type MemoryEntry,
  type MemoryHealth,
  type MemorySuggestion,
  type MemoryTrack,
} from '../../lib/memory';
import ConfirmDialog from './ConfirmDialog';

type TabId = MemoryTrack | 'suggestions' | 'scratch' | 'archive' | 'settings';

const TRACK_TABS: Array<{ id: TabId; label: string }> = [
  { id: 'suggestions', label: '待确认' },
  { id: 'user', label: '用户档案' },
  { id: 'memory', label: '全局事实' },
  { id: 'key', label: '项目关键' },
  { id: 'project', label: '项目日志' },
  { id: 'daily', label: '每日' },
  { id: 'scratch', label: '便签' },
  { id: 'archive', label: '归档' },
  { id: 'settings', label: '设置' },
];

interface Props {
  live: boolean;
  pluginOn: boolean;
  workspacePath?: string;
}

export default function MemoryPane({ live, pluginOn, workspacePath = '' }: Props) {
  const [tab, setTab] = useState<TabId>('suggestions');
  const [health, setHealth] = useState<MemoryHealth | null>(null);
  const [tracks, setTracks] = useState<Record<string, { entries: MemoryEntry[] }>>({});
  const [suggestions, setSuggestions] = useState<MemorySuggestion[]>([]);
  const [archives, setArchives] = useState<MemoryEntry[]>([]);
  const [archiveTarget, setArchiveTarget] = useState<'user' | 'memory' | 'key'>('memory');
  const [scratch, setScratch] = useState('');
  const [config, setConfig] = useState<MemoryConfig | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [deleteIndex, setDeleteIndex] = useState<number | null>(null);
  const [archiveIndex, setArchiveIndex] = useState<number | null>(null);
  const [purgeArchiveIndex, setPurgeArchiveIndex] = useState<number | null>(null);

  const cwd = workspacePath.trim();

  const refresh = useCallback(async () => {
    if (!live) {
      setHealth(null);
      setTracks({});
      setSuggestions([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [h, t, s, cfg, sc] = await Promise.all([
        fetchMemoryHealth(),
        fetchMemoryTracks(cwd, 'all'),
        fetchSuggestions(),
        fetchMemoryConfig(),
        fetchScratch(),
      ]);
      setHealth(h);
      setTracks(t);
      setSuggestions(s);
      setConfig(cfg);
      setScratch(sc);
      if (tab === 'archive') {
        setArchives(await fetchArchives(archiveTarget, cwd));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [live, cwd, tab, archiveTarget]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (!pluginOn) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-center px-6">
        <p className="text-sm text-stone-600">会话记忆未启用</p>
        <p className="mt-1 text-xs text-stone-400">
          在「我的插件」中打开「会话记忆」后，可在此管理五轨记忆与待确认队列
        </p>
      </div>
    );
  }

  if (!live) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-center px-6">
        <p className="text-sm text-stone-600">会话记忆中间件未就绪</p>
        <p className="mt-1 text-xs text-stone-400">本地记忆服务未就绪</p>
      </div>
    );
  }

  const curated = tab === 'user' || tab === 'memory' || tab === 'key';
  const entries =
    curated || tab === 'project' || tab === 'daily' ? (tracks[tab]?.entries ?? []) : [];

  async function onApprove(id: string) {
    setBusy(true);
    try {
      await approveSuggestion(id);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function onReject(id: string) {
    setBusy(true);
    try {
      await rejectSuggestion(id);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  function onArchive(index: number) {
    if (!curated) return;
    setArchiveIndex(index);
  }

  async function confirmArchive() {
    if (archiveIndex == null || !curated) return;
    const index = archiveIndex;
    setArchiveIndex(null);
    setBusy(true);
    try {
      await archiveEntry(tab as MemoryTrack, index, cwd);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function confirmPurgeArchive() {
    if (purgeArchiveIndex == null) return;
    const index = purgeArchiveIndex;
    setPurgeArchiveIndex(null);
    setBusy(true);
    try {
      await deleteArchiveEntry(archiveTarget, index, cwd);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  function onDelete(index: number) {
    setDeleteIndex(index);
  }

  async function confirmDelete() {
    if (deleteIndex == null) return;
    const index = deleteIndex;
    setDeleteIndex(null);
    setBusy(true);
    try {
      await deleteMemoryEntry(tab as MemoryTrack, index, cwd);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function onManualAdd() {
    if (!curated || !draft.trim()) return;
    setBusy(true);
    try {
      await manualAddMemory(tab as 'user' | 'memory' | 'key', draft.trim(), cwd);
      setDraft('');
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function onSaveScratch() {
    setBusy(true);
    try {
      await saveScratch(scratch);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function onSaveConfig(patch: Partial<MemoryConfig>) {
    setBusy(true);
    try {
      const next = await saveMemoryConfig(patch);
      setConfig(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="h-full flex flex-col min-h-0">
      <div className="shrink-0 flex items-center gap-2 px-4 py-2 border-b border-stone-200/80 overflow-x-auto">
        {TRACK_TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`shrink-0 h-7 px-2.5 text-xs rounded-md ${
              tab === t.id ? 'bg-stone-900 text-white' : 'text-stone-600 hover:bg-stone-100'
            }`}
          >
            {t.label}
            {t.id === 'suggestions' && suggestions.length > 0 ? (
              <span className="ml-1 tabular-nums">({suggestions.length})</span>
            ) : null}
          </button>
        ))}
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={loading}
          className="ml-auto shrink-0 h-7 px-2.5 text-xs text-stone-600 border border-stone-200 rounded-md hover:bg-stone-50 disabled:opacity-50"
        >
          {loading ? '刷新中…' : '刷新'}
        </button>
        <span className="shrink-0 text-[11px] text-stone-400 tabular-nums">
          {health?.entryCount ?? 0} 条 · 待确认 {health?.suggestionCount ?? suggestions.length}
        </span>
      </div>

      {error ? (
        <div className="mx-4 mt-3 px-3 py-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg">
          {error}
        </div>
      ) : null}

      <div className="flex-1 min-h-0 overflow-y-auto p-4">
        {tab === 'suggestions' ? (
          suggestions.length === 0 ? (
            <p className="text-sm text-stone-400 text-center py-12">暂无待确认建议</p>
          ) : (
            <ul className="space-y-3">
              {suggestions.map((s) => (
                <li key={s.id} className="rounded-lg border border-stone-200 bg-white p-3">
                  <div className="flex items-center gap-2 text-[11px] text-stone-400 mb-1">
                    <span className="px-1.5 py-0.5 rounded bg-amber-50 text-amber-800 border border-amber-100">
                      {s.target}
                    </span>
                    <span>{s.time}</span>
                    {s.hits && s.hits > 1 ? <span>×{s.hits}</span> : null}
                  </div>
                  <p className="text-sm text-stone-800 whitespace-pre-wrap">{s.content}</p>
                  {s.reason ? (
                    <p className="mt-1 text-xs text-stone-500">原因：{s.reason}</p>
                  ) : null}
                  <div className="mt-2 flex gap-2">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void onApprove(s.id)}
                      className="h-7 px-2.5 text-xs text-white bg-emerald-600 rounded-md hover:bg-emerald-700 disabled:opacity-40"
                    >
                      采纳
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void onReject(s.id)}
                      className="h-7 px-2.5 text-xs text-stone-600 border border-stone-200 rounded-md hover:bg-stone-50 disabled:opacity-40"
                    >
                      拒绝
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )
        ) : null}

        {(tab === 'user' ||
          tab === 'memory' ||
          tab === 'key' ||
          tab === 'project' ||
          tab === 'daily') && (
          <div className="space-y-3">
            {curated ? (
              <div className="flex gap-2">
                <input
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder="手动添加一条记忆…"
                  className="flex-1 h-8 px-3 text-sm rounded-lg border border-stone-200 focus:outline-none focus:border-[#4176e6]"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      void onManualAdd();
                    }
                  }}
                />
                <button
                  type="button"
                  disabled={busy || !draft.trim()}
                  onClick={() => void onManualAdd()}
                  className="h-8 px-3 text-xs text-white bg-[#4176e6] rounded-lg disabled:opacity-40"
                >
                  添加
                </button>
              </div>
            ) : (
              <p className="text-xs text-stone-400">
                本轨由对话中 memory_append 自动追加，一般不注入上下文。
              </p>
            )}
            {entries.length === 0 ? (
              <p className="text-sm text-stone-400 text-center py-10">暂无条目</p>
            ) : (
              <ul className="space-y-2">
                {entries.map((e) => (
                  <li
                    key={`${tab}-${e.index}`}
                    className="rounded-lg border border-stone-200 bg-white px-3 py-2.5 flex gap-2"
                  >
                    <p className="flex-1 text-sm text-stone-800 whitespace-pre-wrap">{e.text}</p>
                    <div className="shrink-0 self-start flex flex-col gap-0.5">
                      {curated ? (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void onArchive(e.index)}
                          className="h-7 px-2 text-[11px] text-stone-500 hover:bg-stone-50 rounded-md"
                        >
                          归档
                        </button>
                      ) : null}
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void onDelete(e.index)}
                        className="h-7 px-2 text-[11px] text-red-600 hover:bg-red-50 rounded-md"
                      >
                        删除
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {tab === 'scratch' ? (
          <div className="space-y-2 h-full flex flex-col">
            <p className="text-xs text-stone-400">临时便签，自由编辑，不注入模型上下文。</p>
            <textarea
              value={scratch}
              onChange={(e) => setScratch(e.target.value)}
              className="flex-1 min-h-[240px] w-full text-sm rounded-lg border border-stone-200 p-3 focus:outline-none focus:border-[#4176e6]"
              placeholder="临时想法、链接、草稿…"
            />
            <button
              type="button"
              disabled={busy}
              onClick={() => void onSaveScratch()}
              className="self-end h-8 px-3 text-xs text-white bg-[#4176e6] rounded-lg disabled:opacity-40"
            >
              保存便签
            </button>
          </div>
        ) : null}

        {tab === 'archive' ? (
          <div className="space-y-3">
            <div className="flex gap-2">
              {(['user', 'memory', 'key'] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => {
                    setArchiveTarget(t);
                  }}
                  className={`h-7 px-2.5 text-xs rounded-md ${
                    archiveTarget === t ? 'bg-stone-800 text-white' : 'border border-stone-200'
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
            {archives.length === 0 ? (
              <p className="text-sm text-stone-400 text-center py-10">暂无归档</p>
            ) : (
              <ul className="space-y-2">
                {archives.map((e) => (
                  <li
                    key={`a-${e.index}`}
                    className="rounded-lg border border-stone-200 bg-white px-3 py-2.5 flex gap-2"
                  >
                    <p className="flex-1 text-sm text-stone-800 whitespace-pre-wrap">{e.text}</p>
                    <div className="shrink-0 self-start flex flex-col gap-0.5">
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          void (async () => {
                            setBusy(true);
                            try {
                              await promoteArchive(archiveTarget, e.index, cwd);
                              await refresh();
                            } catch (err) {
                              setError(err instanceof Error ? err.message : String(err));
                            } finally {
                              setBusy(false);
                            }
                          })()
                        }
                        className="h-7 px-2 text-[11px] text-emerald-700 hover:bg-emerald-50 rounded-md"
                      >
                        转正
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => setPurgeArchiveIndex(e.index)}
                        className="h-7 px-2 text-[11px] text-red-600 hover:bg-red-50 rounded-md"
                      >
                        删除
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : null}

        {tab === 'settings' && config ? (
          <div className="space-y-4 max-w-md">
            <label className="flex items-center justify-between gap-3 text-sm text-stone-700">
              <span>每回合注入 USER / MEMORY / KEY</span>
              <input
                type="checkbox"
                checked={config.injectMemory}
                onChange={(e) => void onSaveConfig({ injectMemory: e.target.checked })}
              />
            </label>
            <label className="flex items-center justify-between gap-3 text-sm text-stone-700">
              <span>收尾提示写 project</span>
              <input
                type="checkbox"
                checked={config.perTurnProjectWrites}
                onChange={(e) => void onSaveConfig({ perTurnProjectWrites: e.target.checked })}
              />
            </label>
            <label className="flex items-center justify-between gap-3 text-sm text-stone-700">
              <span>收尾提示写 daily</span>
              <input
                type="checkbox"
                checked={config.perTurnDailyWrites}
                onChange={(e) => void onSaveConfig({ perTurnDailyWrites: e.target.checked })}
              />
            </label>
            <label className="flex items-center justify-between gap-3 text-sm text-stone-700">
              <span>重要事实用 suggest（KEY）</span>
              <input
                type="checkbox"
                checked={config.perTurnKeyWrites}
                onChange={(e) => void onSaveConfig({ perTurnKeyWrites: e.target.checked })}
              />
            </label>
            <p className="text-xs text-stone-400 leading-5">
              存储目录：<code className="font-mono">{health?.path ?? '.local/memories'}</code>
              。user/memory/key 经待确认后注入；project/daily 不注入。
            </p>
          </div>
        ) : null}
      </div>

      <ConfirmDialog
        open={deleteIndex != null}
        title="删除记忆"
        message="永久删除该条目？此操作不可恢复。"
        confirmLabel="删除"
        cancelLabel="取消"
        danger
        onClose={() => setDeleteIndex(null)}
        onConfirm={() => void confirmDelete()}
      />
      <ConfirmDialog
        open={archiveIndex != null}
        title="归档记忆"
        message="归档该条目？归档后不再注入上下文。"
        confirmLabel="归档"
        cancelLabel="取消"
        onClose={() => setArchiveIndex(null)}
        onConfirm={() => void confirmArchive()}
      />
      <ConfirmDialog
        open={purgeArchiveIndex != null}
        title="删除归档"
        message="永久删除该归档？此操作不可恢复。"
        confirmLabel="删除"
        cancelLabel="取消"
        danger
        onClose={() => setPurgeArchiveIndex(null)}
        onConfirm={() => void confirmPurgeArchive()}
      />
    </div>
  );
}
