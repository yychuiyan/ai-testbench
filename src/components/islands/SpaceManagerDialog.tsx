import { Dialog, DialogBackdrop, DialogPanel, DialogTitle } from '@headlessui/react';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

import { t } from '../../lib/i18n';
import { rememberActiveSpaceId } from '../../lib/space-scope';
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
  const [renameTarget, setRenameTarget] = useState<SpaceInfo | null>(null);
  const [renameName, setRenameName] = useState('');
  const [confirm, setConfirm] = useState<
    null | { kind: 'remove'; space: SpaceInfo } | { kind: 'delete'; space: SpaceInfo }
  >(null);
  const [copyTarget, setCopyTarget] = useState<SpaceInfo | null>(null);
  const [copyName, setCopyName] = useState('');

  const fileRef = useRef<HTMLInputElement>(null);

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

  useEffect(() => {
    if (!open) return;
    setError('');
    setNotice('');
    void loadRef.current(false);
  }, [open]);

  async function doCreate() {
    const name = newName.trim();
    if (!name) return;
    setBusy('create');
    setError('');
    const out = await createSpace(name);
    setBusy(null);
    if (!out.ok) {
      setError(out.error || t('space.create') + ' 失败');
      return;
    }
    setNewName('');
    setNotice(`已创建「${out.space?.name}」`);
    await load(false);
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
    const out = await discoverSpaces();
    setBusy(null);
    if (!out.ok) {
      setError(out.error || '扫描失败');
      return;
    }
    const added = out.added?.length ?? 0;
    const backfilled = out.backfilled?.length ?? 0;
    const skipped = out.skipped?.length ?? 0;
    const parts: string[] = [];
    parts.push(added ? t('space.discoverAdded', { n: added }) : t('space.discoverNone'));
    if (backfilled) parts.push(t('space.discoverBackfilled', { n: backfilled }));
    if (skipped) parts.push(t('space.discoverSkipped', { n: skipped }));
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
  const working = busy !== null;

  return (
    <>
      <Dialog open={open} onClose={onClose} transition className="relative z-[95]">
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
                  <HintWrap hint={t('space.importPick')}>
                    <button
                      type="button"
                      disabled={working}
                      onClick={() => fileRef.current?.click()}
                      className="h-9 px-3 text-sm rounded-lg border border-stone-200 text-stone-600 hover:bg-stone-100 disabled:opacity-40 transition-colors"
                    >
                      {busy === 'import' ? '…' : t('space.import')}
                    </button>
                  </HintWrap>
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
                          data-hint={displaySpacePath(s.path, list.baseRoot)}
                          data-hint-always=""
                        >
                          {displaySpacePath(s.path, list.baseRoot)}
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
                onClick={onClose}
                className="tw-confirm-cancel h-8 px-3 text-sm rounded-lg border border-stone-200 text-stone-600 hover:bg-stone-100 transition-colors"
              >
                {t('space.done')}
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
        className="relative z-[96]"
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
        className="relative z-[96]"
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
