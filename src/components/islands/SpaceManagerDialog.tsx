import { Dialog, DialogBackdrop, DialogPanel, DialogTitle } from '@headlessui/react';
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';

import { t } from '../../lib/i18n';
import { completeChat } from '../../lib/llm';
import { CHAT_SYSTEM_PROMPT_FILE } from '../../lib/prompts-meta';
import { hydrateAppConfig, loadSettings } from '../../lib/settings';
import { rememberActiveSpaceId } from '../../lib/space-scope';
import { SPACE_PROMPT_GEN_SYSTEM, unwrapGeneratedPrompt } from '../../lib/space-system-prompt';
import {
  copySpace,
  createSpace,
  deleteSpace,
  discoverSpaces,
  displaySpaceName,
  displaySpacePath,
  exportSpaceHref,
  formatBytes,
  importSpace,
  listSpaces,
  renameSpace,
  type SpaceInfo,
  type SpaceList,
} from '../../lib/spaces-client';
import ConfirmDialog from './ConfirmDialog';

interface Props {
  open: boolean;
  onClose: () => void;
  /** 列表变化（新建 / 删除 / 重命名）后同步给上层 */
  onListChanged?: (list: SpaceList) => void;
}

type Busy = null | 'create' | 'rename' | 'copy' | 'delete' | 'import' | 'stats' | 'discover';

function isAbortError(e: unknown): boolean {
  return (
    (e instanceof DOMException && e.name === 'AbortError') ||
    (e instanceof Error && e.name === 'AbortError')
  );
}

/** 禁用按钮本身不派发 hover，把气泡挂在包裹层上才能显示 */
function HintWrap({ hint, children }: { hint?: string; children: ReactNode }) {
  if (!hint) return children;
  return (
    <span className="inline-flex cursor-help" data-hint={hint} data-hint-always="">
      {children}
    </span>
  );
}

export default function SpaceManagerDialog({ open, onClose, onListChanged }: Props) {
  const [list, setList] = useState<SpaceList | null>(null);
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const [newName, setNewName] = useState('');
  const [promptBrief, setPromptBrief] = useState('');
  const [systemPrompt, setSystemPrompt] = useState('');
  const [renameTarget, setRenameTarget] = useState<SpaceInfo | null>(null);
  const [renameName, setRenameName] = useState('');
  const [confirm, setConfirm] = useState<
    null | { kind: 'remove'; space: SpaceInfo } | { kind: 'delete'; space: SpaceInfo }
  >(null);
  const [copyTarget, setCopyTarget] = useState<SpaceInfo | null>(null);
  const [copyName, setCopyName] = useState('');
  /** 扫描到的「不是数据空间」的文件夹：确认后才登记，不改动文件夹内容 */
  const [candidates, setCandidates] = useState<
    Array<{ path: string; name: string; hasContent?: boolean }>
  >([]);
  const [adoptPick, setAdoptPick] = useState<Record<string, boolean>>({});

  const fileRef = useRef<HTMLInputElement>(null);
  const briefRef = useRef<HTMLTextAreaElement>(null);
  const generateAbortRef = useRef<AbortController | null>(null);
  const [generating, setGenerating] = useState(false);

  const load = useCallback(
    async (stats = false) => {
      if (stats) setBusy('stats');
      const data = await listSpaces({ stats });
      if (stats) setBusy(null);
      if (!data) {
        setError('无法读取数据空间列表（本地服务未运行？）');
        return;
      }
      setList(data);
      onListChanged?.(data);
    },
    [onListChanged],
  );

  // load 依赖父组件传进来的 onListChanged：父组件每次渲染都会给新函数，
  // 若把它放进下面 effect 的依赖里，effect 会在每次操作后重跑并把提示清掉。
  // 用 ref 固定住最新实现，effect 只依赖 open。
  const loadRef = useRef(load);
  useEffect(() => {
    loadRef.current = load;
  }, [load]);

  function stopGenerate() {
    generateAbortRef.current?.abort();
  }

  useEffect(() => {
    if (open) {
      setError('');
      setNotice('');
      setSystemPrompt('');
      void loadRef.current(false);
      return;
    }
    stopGenerate();
  }, [open]);

  useLayoutEffect(() => {
    const el = briefRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 96)}px`;
  }, [promptBrief, open]);

  async function doGeneratePrompt() {
    if (generating || busy !== null) return;
    const brief = promptBrief.trim();
    if (!brief) {
      setError(t('space.promptNeedReq'));
      return;
    }
    setError('');
    const ctrl = new AbortController();
    generateAbortRef.current = ctrl;
    setGenerating(true);
    try {
      await hydrateAppConfig();
      const settings = loadSettings();
      if (!settings?.apiKey?.trim() || !settings.model?.trim() || !settings.baseURL?.trim()) {
        setError(t('space.promptNeedModel'));
        return;
      }
      const spaceHint = newName.trim();
      const text = await completeChat(
        settings,
        [
          { role: 'system', content: SPACE_PROMPT_GEN_SYSTEM },
          {
            role: 'user',
            content: (spaceHint ? `空间名称：${spaceHint}\n\n` : '') + `用户要求：\n${brief}`,
          },
        ],
        ctrl.signal,
      );
      if (ctrl.signal.aborted) return;
      const cleaned = unwrapGeneratedPrompt(text);
      if (!cleaned) {
        setError(t('space.promptGenEmpty'));
        return;
      }
      setSystemPrompt(cleaned);
    } catch (e) {
      if (isAbortError(e) || ctrl.signal.aborted) return;
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (generateAbortRef.current === ctrl) generateAbortRef.current = null;
      setGenerating(false);
    }
  }

  async function doCreate(_opts?: { closeAfter?: boolean }): Promise<boolean> {
    if (busy !== null) return false;
    const name = newName.trim();
    if (!name) {
      setError(t('space.needName'));
      return false;
    }
    stopGenerate();
    const prompt = systemPrompt.trim();
    setBusy('create');
    setError('');
    const out = await createSpace(name, {
      switch: true,
      ...(prompt ? { systemPrompt: prompt } : {}),
    });
    setBusy(null);
    if (!out.ok) {
      setError(out.error || t('space.create') + ' 失败');
      return false;
    }
    const createdId = out.space?.id;
    if (createdId) rememberActiveSpaceId(createdId);
    // 切到新空间后重载，提示词 / 知识库页才能读到该空间自己的文件
    window.location.reload();
    return true;
  }

  async function doFinish() {
    if (working) return;
    const name = newName.trim();
    const brief = promptBrief.trim();
    if (!name && !brief) {
      onClose();
      return;
    }
    await doCreate({ closeAfter: true });
  }

  async function doRename() {
    if (!renameTarget) return;
    const name = renameName.trim();
    if (!name) return;
    setBusy('rename');
    setError('');
    const out = await renameSpace(renameTarget.id, name);
    setBusy(null);
    if (!out.ok) {
      setError(out.error || '重命名失败');
      return;
    }
    setRenameTarget(null);
    await load(false);
  }

  async function doCopy() {
    if (!copyTarget) return;
    const name = copyName.trim();
    if (!name) return;
    setBusy('copy');
    setError('');
    const out = await copySpace(copyTarget.id, name);
    setBusy(null);
    if (!out.ok) {
      setError(out.error || '复制失败');
      return;
    }
    setCopyTarget(null);
    setNotice(`已复制为「${out.space?.name}」`);
    await load(false);
  }

  async function doDelete(space: SpaceInfo, purge: boolean) {
    setBusy('delete');
    setError('');
    const out = await deleteSpace(space.id, purge);
    setBusy(null);
    if (!out.ok) {
      setError(out.error || '删除失败');
      return;
    }
    setConfirm(null);
    // 删的是当前空间：服务端已回落公共空间，页面上的会话仍是旧数据，不重载会写进公共空间
    if (space.isActive) {
      rememberActiveSpaceId('public');
      window.location.reload();
      return;
    }
    setNotice(
      out.purged
        ? `已删除「${space.name}」及其数据`
        : `已从列表移除「${space.name}」（数据保留在磁盘）`,
    );
    await load(false);
  }

  async function doDiscover() {
    setBusy('discover');
    setError('');
    setNotice('');
    setCandidates([]);
    const out = await discoverSpaces();
    setBusy(null);
    if (!out.ok) {
      setError(out.error || '扫描失败');
      return;
    }
    const added = out.added?.length ?? 0;
    const backfilled = out.backfilled?.length ?? 0;
    const skipped = out.skipped?.length ?? 0;
    const cands = out.candidates ?? [];
    const parts: string[] = [];
    // 有候选时由下面的确认面板说明，别再提示「没有发现」
    if (added) parts.push(t('space.discoverAdded', { n: added }));
    else if (!cands.length) parts.push(t('space.discoverNone'));
    if (backfilled) parts.push(t('space.discoverBackfilled', { n: backfilled }));
    if (skipped) parts.push(t('space.discoverSkipped', { n: skipped }));
    setNotice(parts.join('；'));
    // 有「不是数据空间」的文件夹：列出来让用户确认是否纳入
    setCandidates(cands);
    setAdoptPick(Object.fromEntries(cands.map((c) => [c.path, c.hasContent === true])));
    await load(false);
  }

  async function doAdoptSelected() {
    const picked = candidates.filter((c) => adoptPick[c.path]).map((c) => c.path);
    if (!picked.length) {
      setCandidates([]);
      setNotice(t('space.candidatesIgnored'));
      return;
    }
    setBusy('discover');
    setError('');
    const out = await discoverSpaces(picked);
    setBusy(null);
    if (!out.ok) {
      setError(out.error || '纳入失败');
      return;
    }
    setCandidates([]);
    const n = out.added?.length ?? 0;
    const skipped = out.skipped ?? [];
    const parts = [n ? t('space.candidatesAdopted', { n }) : t('space.candidatesIgnored')];
    if (skipped.length) {
      parts.push(t('space.candidatesRejected', { names: skipped.map((s) => s.reason).join('、') }));
    }
    setNotice(parts.join('；'));
    await load(false);
  }

  async function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setBusy('import');
    setError('');
    const out = await importSpace(file);
    setBusy(null);
    if (!out.ok) {
      setError(out.error || '导入失败');
      return;
    }
    setNotice(`已导入为「${out.space?.name}」`);
    await load(false);
  }

  const spaces = list?.spaces ?? [];
  /** 空间路径展示要用基准根；列表未加载时退回原路径，避免把相对路径拼到 cwd 上 */
  const spaceBaseRoot = list?.baseRoot;
  const working = busy !== null;
  const canGenerate = Boolean(promptBrief.trim()) && !working && !generating;

  return (
    <>
      <Dialog open={open} onClose={onClose} transition className="relative z-95">
        <DialogBackdrop
          transition
          className="tw-dialog-backdrop-anim fixed inset-0 bg-black/30"
          aria-hidden="true"
        />
        <div className="fixed inset-0 flex items-center justify-center p-4">
          <DialogPanel
            transition
            className="tw-dialog-panel-anim tw-space-dialog w-full max-w-3xl rounded-xl shadow-xl border border-stone-200 bg-white flex flex-col max-h-[86vh]"
          >
            <div className="flex items-start justify-between gap-4 px-5 pt-4 pb-3 border-b border-stone-200">
              <div className="min-w-0">
                <DialogTitle className="tw-confirm-title text-base font-semibold text-stone-900">
                  {t('space.manageTitle')}
                </DialogTitle>
                <p className="mt-1 text-xs text-stone-500 leading-relaxed">
                  {t('space.manageDesc')}
                </p>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="tw-confirm-cancel shrink-0 w-7 h-7 flex items-center justify-center rounded-md text-stone-400 hover:bg-stone-100 hover:text-stone-700 transition-colors"
                aria-label="关闭"
              >
                ✕
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-4">
              {/* 新建 */}
              <div className="mb-5">
                <div className="text-xs font-medium text-stone-500 mb-2">{t('space.newTitle')}</div>
                <div className="flex items-center gap-2">
                  <input
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        void doCreate();
                      }
                    }}
                    placeholder={t('space.namePlaceholder')}
                    className="flex-1 min-w-0 h-9 px-3 text-sm rounded-lg border border-stone-200 text-stone-800 outline-none focus:ring-2 focus:ring-[#4176e6]/30 focus:border-[#4176e6] transition-colors"
                  />
                  <button
                    type="button"
                    disabled={!newName.trim() || working}
                    onClick={() => void doCreate()}
                    className="h-9 px-4 text-sm font-medium text-white bg-[#4176e6] rounded-lg hover:bg-[#3565c7] disabled:opacity-40 transition-colors"
                  >
                    {busy === 'create' ? '…' : t('space.create')}
                  </button>
                  <button
                    type="button"
                    disabled={working}
                    onClick={() => fileRef.current?.click()}
                    className="h-9 px-3 text-sm rounded-lg border border-stone-200 text-stone-600 hover:bg-stone-100 disabled:opacity-40 transition-colors"
                  >
                    {busy === 'import' ? '…' : t('space.import')}
                  </button>
                  <input
                    ref={fileRef}
                    type="file"
                    accept=".zip,application/zip"
                    className="hidden"
                    onChange={(e) => void onPickFile(e)}
                  />
                </div>
                {list ? (
                  <div className="mt-1.5 text-[11px] text-stone-400 truncate">
                    <code>{displaySpacePath(list.dataRoot, list.baseRoot)}</code>
                  </div>
                ) : null}
                <div className="mt-4 pt-3 border-t border-stone-200">
                  <div className="text-xs font-medium text-stone-500 mb-1.5">
                    {t('space.promptBriefLabel')}
                  </div>
                  <div className="tw-space-prompt-composer pt-1 rounded-lg bg-white border border-stone-200 outline-none transition-colors focus-within:ring-2 focus-within:ring-[#4176e6]/30 focus-within:border-[#4176e6]">
                    <textarea
                      ref={briefRef}
                      value={promptBrief}
                      onChange={(e) => setPromptBrief(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                          e.preventDefault();
                          if (generating) {
                            stopGenerate();
                            return;
                          }
                          if (canGenerate) void doGeneratePrompt();
                        }
                      }}
                      placeholder={t('space.promptBriefPlaceholder')}
                      rows={1}
                      disabled={working}
                      className="block w-full min-h-6 pl-3.5 pr-2 pt-0.5 pb-0 text-sm leading-5 text-stone-800 bg-transparent resize-none focus:outline-none placeholder:text-stone-400 disabled:opacity-60"
                    />
                    <div className="flex flex-wrap items-center gap-x-1.5 gap-y-2 px-3 pb-2 pt-1">
                      <span className="flex-1" />
                      <button
                        type="button"
                        onClick={() => {
                          if (generating) {
                            stopGenerate();
                            return;
                          }
                          void doGeneratePrompt();
                        }}
                        disabled={!generating && !canGenerate}
                        aria-label={generating ? t('space.promptStop') : t('space.promptGenerate')}
                        className={`w-7 h-7 shrink-0 rounded-full flex items-center justify-center outline-none transition-colors ${
                          generating
                            ? 'bg-stone-200 text-stone-700 hover:bg-stone-300'
                            : 'bg-[#4176e6] text-white hover:bg-[#3565c7] disabled:bg-[#a9c3ef] disabled:cursor-not-allowed'
                        }`}
                      >
                        {generating ? (
                          <span className="w-2.5 h-2.5 bg-current rounded-xs" />
                        ) : (
                          <svg
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            className="w-4 h-4"
                            aria-hidden
                          >
                            <path d="m5 12 7-7 7 7" />
                            <path d="M12 19V5" />
                          </svg>
                        )}
                      </button>
                    </div>
                  </div>
                  <div className="mt-1.5 flex items-start gap-3">
                    <p className="flex-1 min-w-0 text-[11px] text-stone-400 leading-snug">
                      {t('space.promptHint')}
                    </p>
                    {generating ? (
                      <p className="tw-busy-status shrink-0" aria-live="polite">
                        {t('space.promptGeneratingStatus')}
                        <span className="tw-busy-ellipsis" aria-hidden />
                      </p>
                    ) : null}
                  </div>
                  <div className="mt-3 flex items-center justify-between gap-2 mb-1.5">
                    <label className="text-xs font-medium text-stone-500">
                      {t('space.promptBodyLabel')}
                    </label>
                    <span className="text-[11px] text-stone-400 font-mono truncate">
                      {CHAT_SYSTEM_PROMPT_FILE}
                    </span>
                  </div>
                  <textarea
                    value={systemPrompt}
                    onChange={(e) => setSystemPrompt(e.target.value)}
                    placeholder={t('space.promptBodyPlaceholder')}
                    rows={6}
                    disabled={working}
                    className="w-full min-h-30 px-3 py-2 text-sm leading-relaxed rounded-lg border border-stone-200 text-stone-800 outline-none focus:ring-2 focus:ring-[#4176e6]/30 focus:border-[#4176e6] transition-colors resize-y font-[inherit]"
                  />
                </div>
              </div>

              {error ? (
                <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 flex items-start gap-2">
                  <span className="flex-1 min-w-0">{error}</span>
                  <button
                    type="button"
                    onClick={() => setError('')}
                    className="shrink-0 w-5 h-5 -mr-0.5 flex items-center justify-center rounded text-red-700/70 hover:bg-red-100 hover:text-red-900"
                    aria-label="关闭"
                  >
                    ✕
                  </button>
                </div>
              ) : null}
              {notice ? (
                <div className="mb-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700 flex items-start gap-2">
                  <span className="flex-1 min-w-0">{notice}</span>
                  <button
                    type="button"
                    onClick={() => setNotice('')}
                    className="shrink-0 w-5 h-5 -mr-0.5 flex items-center justify-center rounded text-emerald-700/70 hover:bg-emerald-100 hover:text-emerald-900"
                    aria-label="关闭"
                  >
                    ✕
                  </button>
                </div>
              ) : null}

              {candidates.length ? (
                <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5">
                  <div className="text-xs font-medium text-amber-800">
                    {t('space.candidatesTitle', { n: candidates.length })}
                  </div>
                  <p className="mt-1 text-[11px] leading-snug text-amber-700/90">
                    {t('space.candidatesHint')}
                  </p>
                  <div className="mt-2 max-h-44 overflow-auto rounded-md border border-amber-200/70 bg-white divide-y divide-stone-100">
                    {candidates.map((c) => (
                      <label
                        key={c.path}
                        className="flex items-start gap-2 px-2.5 py-1.5 cursor-pointer hover:bg-stone-50"
                      >
                        <input
                          type="checkbox"
                          checked={adoptPick[c.path] === true}
                          onChange={(e) =>
                            setAdoptPick((prev) => ({ ...prev, [c.path]: e.target.checked }))
                          }
                          className="mt-0.5 accent-[#4176e6]"
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block text-xs text-stone-800 truncate">{c.name}</span>
                          <span className="block text-[10px] text-stone-400 truncate font-mono">
                            {spaceBaseRoot ? displaySpacePath(c.path, spaceBaseRoot) : c.path}
                          </span>
                        </span>
                      </label>
                    ))}
                  </div>
                  <div className="mt-2 flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() =>
                        setAdoptPick(Object.fromEntries(candidates.map((c) => [c.path, true])))
                      }
                      className="text-[11px] text-[#4176e6] hover:underline"
                    >
                      {t('space.candidatesSelectAll')}
                    </button>
                    <button
                      type="button"
                      onClick={() => setAdoptPick({})}
                      className="text-[11px] text-stone-500 hover:underline"
                    >
                      {t('space.candidatesClear')}
                    </button>
                    <span className="flex-1" />
                    <button
                      type="button"
                      onClick={() => {
                        setCandidates([]);
                        setAdoptPick({});
                        setNotice(t('space.candidatesIgnored'));
                      }}
                      className="px-2.5 py-1 text-[11px] rounded-md border border-stone-200 text-stone-600 hover:bg-stone-50"
                    >
                      {t('space.candidatesIgnore')}
                    </button>
                    <button
                      type="button"
                      disabled={working}
                      onClick={() => void doAdoptSelected()}
                      className="px-2.5 py-1 text-[11px] rounded-md bg-[#4176e6] text-white hover:bg-[#3565c7] disabled:opacity-40"
                    >
                      {t('space.candidatesAdopt')}
                    </button>
                  </div>
                </div>
              ) : null}

              {/* 列表 */}
              <div className="flex items-center justify-between mb-2">
                <div className="text-xs font-medium text-stone-500">{t('space.listTitle')}</div>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    disabled={working}
                    onClick={() => void doDiscover()}
                    data-hint={t('space.discoverTitle')}
                    data-hint-always=""
                    className="text-xs text-[#4176e6] hover:underline disabled:opacity-40"
                  >
                    {busy === 'discover' ? t('space.discovering') : t('space.discover')}
                  </button>
                  <button
                    type="button"
                    disabled={working}
                    onClick={() => void load(true)}
                    data-hint={t('space.sizeTitle')}
                    data-hint-always=""
                    className="text-xs text-[#4176e6] hover:underline disabled:opacity-40"
                  >
                    {busy === 'stats' ? t('space.sizing') : t('space.size')}
                  </button>
                </div>
              </div>

              <div className="rounded-lg border border-stone-200 divide-y divide-stone-100 overflow-hidden">
                {spaces.length === 0 ? (
                  <div className="px-3 py-6 text-center text-xs text-stone-400">
                    {t('space.empty')}
                  </div>
                ) : (
                  spaces.map((s) => (
                    <div key={s.id} className="flex items-center gap-3 px-3 py-2.5">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="text-sm font-medium text-stone-800 truncate">
                            {displaySpaceName(s)}
                          </span>
                          {s.isPublic ? (
                            <span className="shrink-0 rounded px-1.5 py-px text-[10px] bg-stone-100 text-stone-500">
                              {t('space.builtin')}
                            </span>
                          ) : null}
                          {s.isActive ? (
                            <span className="shrink-0 rounded px-1.5 py-px text-[10px] bg-[#4176e6]/10 text-[#3565c7]">
                              {t('space.activeTag')}
                            </span>
                          ) : null}
                          {!s.exists ? (
                            <span className="shrink-0 rounded px-1.5 py-px text-[10px] bg-amber-50 text-amber-600">
                              {t('space.missing')}
                            </span>
                          ) : null}
                          {s.bytes != null ? (
                            <span className="shrink-0 rounded px-1.5 py-px text-[10px] bg-stone-100 text-stone-500 tabular-nums">
                              {formatBytes(s.bytes)}
                            </span>
                          ) : null}
                        </div>
                        <div
                          className="mt-0.5 text-[11px] text-stone-400 truncate cursor-help hover:text-stone-500"
                          data-hint={
                            spaceBaseRoot ? displaySpacePath(s.path, spaceBaseRoot) : s.path
                          }
                          data-hint-always=""
                        >
                          {spaceBaseRoot ? displaySpacePath(s.path, spaceBaseRoot) : s.path}
                        </div>
                      </div>

                      <div className="shrink-0 flex flex-wrap justify-end items-center gap-1">
                        <HintWrap hint={s.removable ? undefined : t('space.publicLocked')}>
                          <button
                            type="button"
                            disabled={!s.removable || working}
                            onClick={() => {
                              setRenameTarget(s);
                              setRenameName(s.name);
                            }}
                            className="h-7 px-2 text-xs rounded-md border border-stone-200 text-stone-600 hover:bg-stone-100 disabled:opacity-30 disabled:cursor-not-allowed disabled:pointer-events-none transition-colors"
                          >
                            {t('space.rename')}
                          </button>
                        </HintWrap>
                        <button
                          type="button"
                          disabled={working}
                          onClick={() => {
                            setCopyTarget(s);
                            setCopyName(`${s.name}-copy`);
                          }}
                          className="h-7 px-2 text-xs rounded-md border border-stone-200 text-stone-600 hover:bg-stone-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                        >
                          {t('space.copy')}
                        </button>
                        <a
                          href={exportSpaceHref(s.id, 'content')}
                          data-hint={t('space.exportContentTitle')}
                          data-hint-always=""
                          className="h-7 px-2 text-xs rounded-md border border-stone-200 text-stone-600 hover:bg-stone-100 inline-flex items-center transition-colors"
                        >
                          {t('space.exportContent')}
                        </a>
                        <a
                          href={exportSpaceHref(s.id, 'full')}
                          data-hint={t('space.exportFullTitle')}
                          data-hint-always=""
                          className="h-7 px-2 text-xs rounded-md border border-stone-200 text-stone-600 hover:bg-stone-100 inline-flex items-center transition-colors"
                        >
                          {t('space.exportFull')}
                        </a>
                        <HintWrap hint={s.removable ? undefined : t('space.publicLocked')}>
                          <button
                            type="button"
                            disabled={!s.removable || working}
                            onClick={() => setConfirm({ kind: 'remove', space: s })}
                            className="h-7 px-2 text-xs rounded-md border border-stone-200 text-stone-600 hover:bg-stone-100 disabled:opacity-30 disabled:cursor-not-allowed disabled:pointer-events-none transition-colors"
                          >
                            {t('space.removeList')}
                          </button>
                        </HintWrap>
                        <HintWrap hint={s.removable ? undefined : t('space.publicLocked')}>
                          <button
                            type="button"
                            disabled={!s.removable || working}
                            onClick={() => setConfirm({ kind: 'delete', space: s })}
                            className="h-7 px-2 text-xs rounded-md border border-red-200 text-red-600 hover:bg-red-50 disabled:opacity-30 disabled:cursor-not-allowed disabled:pointer-events-none transition-colors"
                          >
                            {t('space.deleteDisk')}
                          </button>
                        </HintWrap>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="flex justify-end gap-2 px-5 py-3 border-t border-stone-200">
              <button
                type="button"
                disabled={working}
                onClick={() => void doFinish()}
                className="h-8 px-4 text-sm font-medium text-white bg-[#4176e6] rounded-lg hover:bg-[#3565c7] disabled:opacity-40 transition-colors"
              >
                {busy === 'create' ? '…' : t('space.done')}
              </button>
            </div>
          </DialogPanel>
        </div>
      </Dialog>

      {/* 重命名 */}
      <Dialog
        open={renameTarget !== null}
        onClose={() => setRenameTarget(null)}
        transition
        className="relative z-96"
      >
        <DialogBackdrop
          transition
          className="tw-dialog-backdrop-anim fixed inset-0 bg-black/30"
          aria-hidden="true"
        />
        <div className="fixed inset-0 flex items-center justify-center p-4">
          <DialogPanel
            transition
            className="tw-confirm-dialog tw-dialog-panel-anim w-full max-w-sm rounded-xl shadow-xl border border-stone-200 p-5 bg-white"
          >
            <DialogTitle className="tw-confirm-title text-base font-semibold text-stone-900">
              {t('space.rename')}
            </DialogTitle>
            <input
              autoFocus
              value={renameName}
              onChange={(e) => setRenameName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void doRename();
                }
              }}
              className="mt-4 w-full h-9 px-3 text-sm rounded-lg border border-stone-200 text-stone-800 outline-none focus:ring-2 focus:ring-[#4176e6]/30 focus:border-[#4176e6] transition-colors"
            />
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setRenameTarget(null)}
                className="tw-confirm-cancel h-8 px-3 text-sm rounded-lg border border-stone-200 text-stone-600 hover:bg-stone-100 transition-colors"
              >
                取消
              </button>
              <button
                type="button"
                disabled={!renameName.trim() || working}
                onClick={() => void doRename()}
                className="h-8 px-4 text-sm font-medium text-white bg-[#4176e6] rounded-lg hover:bg-[#3565c7] disabled:opacity-40 transition-colors"
              >
                {busy === 'rename' ? '…' : '确定'}
              </button>
            </div>
          </DialogPanel>
        </div>
      </Dialog>

      {/* 复制 */}
      <Dialog
        open={copyTarget !== null}
        onClose={() => setCopyTarget(null)}
        transition
        className="relative z-96"
      >
        <DialogBackdrop
          transition
          className="tw-dialog-backdrop-anim fixed inset-0 bg-black/30"
          aria-hidden="true"
        />
        <div className="fixed inset-0 flex items-center justify-center p-4">
          <DialogPanel
            transition
            className="tw-confirm-dialog tw-dialog-panel-anim w-full max-w-sm rounded-xl shadow-xl border border-stone-200 p-5 bg-white"
          >
            <DialogTitle className="tw-confirm-title text-base font-semibold text-stone-900">
              {t('space.confirmCopyTitle')}
            </DialogTitle>
            <p className="tw-confirm-msg mt-3 text-sm text-stone-600 leading-relaxed">
              {t('space.confirmCopyMsg', { name: copyTarget?.name ?? '' })}
            </p>
            <label className="mt-3 block text-xs font-medium text-stone-500">
              {t('space.copyName')}
              <input
                autoFocus
                value={copyName}
                onChange={(e) => setCopyName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    void doCopy();
                  }
                }}
                className="mt-1.5 w-full h-9 px-3 text-sm rounded-lg border border-stone-200 text-stone-800 outline-none focus:ring-2 focus:ring-[#4176e6]/30 focus:border-[#4176e6] transition-colors"
              />
            </label>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setCopyTarget(null)}
                className="tw-confirm-cancel h-8 px-3 text-sm rounded-lg border border-stone-200 text-stone-600 hover:bg-stone-100 transition-colors"
              >
                取消
              </button>
              <button
                type="button"
                disabled={!copyName.trim() || working}
                onClick={() => void doCopy()}
                className="h-8 px-4 text-sm font-medium text-white bg-[#4176e6] rounded-lg hover:bg-[#3565c7] disabled:opacity-40 transition-colors"
              >
                {busy === 'copy' ? '…' : t('space.copy')}
              </button>
            </div>
          </DialogPanel>
        </div>
      </Dialog>

      <ConfirmDialog
        open={confirm?.kind === 'remove'}
        title={t('space.confirmRemoveTitle')}
        message={
          confirm?.kind === 'remove'
            ? t('space.confirmRemoveMsg', { name: confirm.space.name, path: confirm.space.path })
            : ''
        }
        confirmLabel={t('space.removeList')}
        onClose={() => setConfirm(null)}
        onConfirm={() => {
          if (confirm?.kind === 'remove') void doDelete(confirm.space, false);
        }}
      />

      <ConfirmDialog
        open={confirm?.kind === 'delete'}
        title={t('space.confirmDeleteTitle')}
        message={
          confirm?.kind === 'delete'
            ? t('space.confirmDeleteMsg', { name: confirm.space.name, path: confirm.space.path })
            : ''
        }
        confirmLabel={t('space.deleteDisk')}
        danger="solid"
        onClose={() => setConfirm(null)}
        onConfirm={() => {
          if (confirm?.kind === 'delete') void doDelete(confirm.space, true);
        }}
      />
    </>
  );
}
