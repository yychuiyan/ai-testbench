/**
 * AI 工作台「生成提示词」插件面板：轻量配置，确认后由主会话发送时使用。
 */
import { useEffect, useState } from 'react';
import type { PromptGenPluginConfig } from '../../lib/prompt-gen-config';
import {
  addPromptKind,
  listPromptKinds,
  promptKindMeta,
  removePromptKind,
  updatePromptKind,
  type PromptGenKind,
  type PromptKindDef,
} from '../../lib/prompt-kinds';
import { fetchDocsHealth } from '../../lib/project-docs';
import SelectDropdown from './SelectDropdown';
import SlideOverDrawer from './SlideOverDrawer';

interface Props {
  open: boolean;
  onClose: () => void;
  initial?: PromptGenPluginConfig | null;
  onConfirm: (cfg: PromptGenPluginConfig) => void;
}

export default function PromptGenPanel({ open, onClose, initial, onConfirm }: Props) {
  const [docsLive, setDocsLive] = useState(false);
  const [titleHint, setTitleHint] = useState('');
  const [kinds, setKinds] = useState<PromptKindDef[]>(() => listPromptKinds());
  const [kind, setKind] = useState<PromptGenKind>(listPromptKinds()[0]?.id ?? 'case');
  const [error, setError] = useState<string | null>(null);
  const [kindEditor, setKindEditor] = useState<'add' | 'edit' | null>(null);
  const [kindDraft, setKindDraft] = useState('');
  /** 行内二次确认删除类型 */
  const [deleteKindPending, setDeleteKindPending] = useState(false);

  const activeKind = kinds.find((k) => k.id === kind) ?? kinds[0] ?? promptKindMeta(kind);

  function refreshKinds(preferId?: string) {
    const list = listPromptKinds();
    setKinds(list);
    setKind((prev) => {
      const want = preferId ?? prev;
      if (list.some((x) => x.id === want)) return want;
      return list[0]?.id ?? prev;
    });
  }

  function saveKindDraft() {
    try {
      if (kindEditor === 'add') {
        const def = addPromptKind(kindDraft);
        refreshKinds(def.id);
      } else if (kindEditor === 'edit') {
        updatePromptKind(kind, kindDraft);
        refreshKinds(kind);
      }
      setKindEditor(null);
      setKindDraft('');
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  useEffect(() => {
    if (!open) return;
    refreshKinds(initial?.kind);
    setTitleHint(initial?.titleHint ?? '');
    setKind(initial?.kind ?? listPromptKinds()[0]?.id ?? 'case');
    setKindEditor(null);
    setKindDraft('');
    setDeleteKindPending(false);
    setError(null);
    void fetchDocsHealth('prompts').then(setDocsLive);
  }, [open, initial]);

  function confirm() {
    setError(null);
    if (!docsLive) {
      setError('本地文档服务未就绪，无法写入提示词库');
      return;
    }
    const cfg: PromptGenPluginConfig = {
      active: true,
      titleHint: titleHint.trim(),
      kind,
      confirmedAt: Date.now(),
      linkedPromptPath: initial?.linkedPromptPath,
    };
    onConfirm(cfg);
    onClose();
  }

  return (
    <SlideOverDrawer
      open={open}
      onClose={onClose}
      title="生成提示词 · 配置"
      closeAriaLabel="关闭生成提示词面板"
      footer={
        <footer className="shrink-0 p-4 border-t border-stone-100 flex items-center gap-2">
          <button
            type="button"
            onClick={onClose}
            className="h-9 px-3 text-sm text-stone-600 rounded-lg hover:bg-stone-100"
          >
            取消
          </button>
          <button
            type="button"
            disabled={!docsLive}
            onClick={confirm}
            className="flex-1 h-9 text-sm font-medium text-white bg-[#4176e6] rounded-lg hover:bg-[#3565c7] disabled:opacity-40"
          >
            确认
          </button>
        </footer>
      }
    >
      {!docsLive ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          本地文档服务未就绪，无法读写提示词库。
        </div>
      ) : null}

      <p className="text-xs text-stone-500 leading-5">
        按所选类型生成可复用提示词：确认后在主输入框描述编写要求并发送，质检通过后写入提示词库，可在「提示词管理」中查看与引用。
      </p>

      {error ? (
        <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          {error}
        </div>
      ) : null}

      <div>
        <div className="flex items-center gap-2 mb-1">
          <div className="text-xs font-medium text-stone-500 flex-1">提示词类型</div>
          <button
            type="button"
            className="text-[11px] text-[#4176e6] hover:underline"
            onClick={() => {
              setKindEditor('add');
              setKindDraft('');
              setError(null);
              setDeleteKindPending(false);
            }}
          >
            新增
          </button>
          <button
            type="button"
            className="text-[11px] text-stone-600 hover:underline"
            onClick={() => {
              setKindEditor('edit');
              setKindDraft(activeKind.label);
              setError(null);
              setDeleteKindPending(false);
            }}
          >
            编辑
          </button>
          {deleteKindPending ? (
            <>
              <span className="text-[11px] text-stone-500 shrink-0">确认删除？</span>
              <button
                type="button"
                className="text-[11px] text-red-600 hover:underline shrink-0"
                onClick={() => {
                  setDeleteKindPending(false);
                  try {
                    const next = removePromptKind(kind);
                    setKinds(next);
                    setKind(next[0]?.id ?? '');
                    setKindEditor(null);
                    setError(null);
                  } catch (e) {
                    setError(e instanceof Error ? e.message : String(e));
                  }
                }}
              >
                确认
              </button>
              <button
                type="button"
                className="text-[11px] text-stone-500 hover:underline shrink-0"
                onClick={() => setDeleteKindPending(false)}
              >
                取消
              </button>
            </>
          ) : (
            <button
              type="button"
              className="text-[11px] text-red-600 hover:underline disabled:opacity-40"
              disabled={kinds.length <= 1}
              onClick={() => {
                setKindEditor(null);
                setDeleteKindPending(true);
                setError(null);
              }}
            >
              删除
            </button>
          )}
        </div>
        <SelectDropdown
          options={kinds.map((o) => ({ value: o.id, label: o.label }))}
          value={kind}
          onChange={(v) => {
            setKind(v);
            setDeleteKindPending(false);
          }}
        />
        <p className="mt-1 text-[11px] text-stone-400 leading-4 break-words">{activeKind.hint}</p>
        {kindEditor ? (
          <div className="mt-2 rounded-lg border border-stone-200 bg-stone-50 p-2 space-y-2">
            <label className="text-[11px] text-stone-500" htmlFor="pg-kind-draft">
              {kindEditor === 'add' ? '新类型名称' : '修改名称'}
            </label>
            <input
              id="pg-kind-draft"
              value={kindDraft}
              onChange={(e) => setKindDraft(e.target.value)}
              placeholder="如：缺陷分析提示词"
              className="w-full h-8 px-2 text-sm rounded-md border border-stone-200 bg-white focus:outline-none focus:ring-2 focus:ring-[#4176e6]/40"
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  saveKindDraft();
                }
              }}
            />
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="h-7 px-2.5 text-xs font-medium text-white bg-[#4176e6] rounded-md hover:bg-[#3565c7]"
                onClick={saveKindDraft}
              >
                保存
              </button>
              <button
                type="button"
                className="h-7 px-2.5 text-xs text-stone-600 rounded-md hover:bg-stone-200/80"
                onClick={() => {
                  setKindEditor(null);
                  setKindDraft('');
                }}
              >
                取消
              </button>
            </div>
          </div>
        ) : null}
      </div>

      <div>
        <label className="text-xs font-medium text-stone-500" htmlFor="pg-title">
          期望名称
        </label>
        <input
          id="pg-title"
          value={titleHint}
          onChange={(e) => setTitleHint(e.target.value)}
          placeholder="如：接口测试用例提示词.md"
          className="mt-1 w-full h-9 px-3 text-sm rounded-lg border border-stone-200 focus:outline-none focus:ring-2 focus:ring-[#4176e6]/40"
        />
        <p className="mt-1.5 text-[11px] text-stone-400 leading-4">
          可填期望文件名；留空则由模型自拟。具体编写要求在主输入框描述。
        </p>
      </div>
    </SlideOverDrawer>
  );
}
