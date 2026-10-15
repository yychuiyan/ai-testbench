/**
 * AI 工作台「生成知识库」插件面板：选分类后确认，对话输入素材生成入库。
 */
import { useEffect, useState } from 'react';
import type { KnowledgeGenPluginConfig } from '../../lib/knowledge-gen-config';
import {
  addKnowledgeCategory,
  listKnowledgeCategories,
  removeKnowledgeCategory,
  updateKnowledgeCategory,
  type KnowledgeCategory,
} from '../../lib/knowledge-categories';
import { fetchDocsHealth } from '../../lib/project-docs';
import SelectDropdown from './SelectDropdown';
import SlideOverDrawer from './SlideOverDrawer';

interface Props {
  open: boolean;
  onClose: () => void;
  initial?: KnowledgeGenPluginConfig | null;
  onConfirm: (cfg: KnowledgeGenPluginConfig) => void;
}

export default function KnowledgeGenPanel({ open, onClose, initial, onConfirm }: Props) {
  const [docsLive, setDocsLive] = useState(false);
  const [titleHint, setTitleHint] = useState('');
  const [categories, setCategories] = useState<KnowledgeCategory[]>(() =>
    listKnowledgeCategories(),
  );
  const [category, setCategory] = useState<KnowledgeCategory>(
    listKnowledgeCategories()[0] ?? '测试规范',
  );
  const [error, setError] = useState<string | null>(null);
  const [catEditor, setCatEditor] = useState<'add' | 'edit' | null>(null);
  const [catDraft, setCatDraft] = useState('');
  const [deleteCatPending, setDeleteCatPending] = useState(false);

  function refreshCats(prefer?: string) {
    const list = listKnowledgeCategories();
    setCategories(list);
    setCategory((prev) => {
      const want = prefer ?? prev;
      if (list.includes(want)) return want;
      return list[0] ?? prev;
    });
  }

  function saveCatDraft() {
    try {
      if (catEditor === 'add') {
        const name = addKnowledgeCategory(catDraft);
        refreshCats(name);
      } else if (catEditor === 'edit') {
        const name = updateKnowledgeCategory(category, catDraft);
        refreshCats(name);
      }
      setCatEditor(null);
      setCatDraft('');
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  useEffect(() => {
    if (!open) return;
    refreshCats(initial?.category);
    setTitleHint(initial?.titleHint ?? '');
    setCategory(initial?.category ?? listKnowledgeCategories()[0] ?? '测试规范');
    setCatEditor(null);
    setCatDraft('');
    setDeleteCatPending(false);
    setError(null);
    void fetchDocsHealth('knowledge').then(setDocsLive);
  }, [open, initial]);

  function confirm() {
    setError(null);
    if (!docsLive) {
      setError('本地文档服务未就绪，无法写入知识库');
      return;
    }
    const cfg: KnowledgeGenPluginConfig = {
      active: true,
      titleHint: titleHint.trim(),
      category,
      confirmedAt: Date.now(),
      linkedKnowledgePath: initial?.linkedKnowledgePath,
    };
    onConfirm(cfg);
    onClose();
  }

  return (
    <SlideOverDrawer
      open={open}
      onClose={onClose}
      title="生成知识库 · 配置"
      closeAriaLabel="关闭生成知识库面板"
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
          本地文档服务未就绪，无法读写知识库。
        </div>
      ) : null}

      <p className="text-xs text-stone-500 leading-5">
        按所选分类沉淀测试规范、方法论或环境约定：确认后在主输入框粘贴/描述素材并发送，质检通过后写入知识库，可在「知识库管理」中查看与
        @ 引用。
      </p>

      {error ? (
        <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          {error}
        </div>
      ) : null}

      <div>
        <div className="flex items-center gap-2 mb-1">
          <div className="text-xs font-medium text-stone-500 flex-1">分类</div>
          <button
            type="button"
            className="text-[11px] text-[#4176e6] hover:underline"
            onClick={() => {
              setCatEditor('add');
              setCatDraft('');
              setError(null);
              setDeleteCatPending(false);
            }}
          >
            新增
          </button>
          <button
            type="button"
            className="text-[11px] text-stone-600 hover:underline"
            onClick={() => {
              setCatEditor('edit');
              setCatDraft(category);
              setError(null);
              setDeleteCatPending(false);
            }}
          >
            编辑
          </button>
          {deleteCatPending ? (
            <>
              <span className="text-[11px] text-stone-500 shrink-0">确认删除？</span>
              <button
                type="button"
                className="text-[11px] text-red-600 hover:underline shrink-0"
                onClick={() => {
                  setDeleteCatPending(false);
                  try {
                    const next = removeKnowledgeCategory(category);
                    setCategories(next);
                    setCategory(next[0] ?? '');
                    setCatEditor(null);
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
                onClick={() => setDeleteCatPending(false)}
              >
                取消
              </button>
            </>
          ) : (
            <button
              type="button"
              className="text-[11px] text-red-600 hover:underline disabled:opacity-40"
              disabled={categories.length <= 1}
              onClick={() => {
                setCatEditor(null);
                setDeleteCatPending(true);
                setError(null);
              }}
            >
              删除
            </button>
          )}
        </div>
        <SelectDropdown
          options={categories.map((c) => ({ value: c, label: c }))}
          value={category}
          onChange={(v) => {
            setCategory(v);
            setDeleteCatPending(false);
          }}
        />
        {catEditor ? (
          <div className="mt-2 rounded-lg border border-stone-200 bg-stone-50 p-2 space-y-2">
            <label className="text-[11px] text-stone-500" htmlFor="kg-cat-draft">
              {catEditor === 'add' ? '新分类名称' : '修改名称'}
            </label>
            <input
              id="kg-cat-draft"
              value={catDraft}
              onChange={(e) => setCatDraft(e.target.value)}
              placeholder="如：安全基线"
              className="w-full h-8 px-2 text-sm rounded-md border border-stone-200 bg-white focus:outline-none focus:ring-2 focus:ring-[#4176e6]/40"
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  saveCatDraft();
                }
              }}
            />
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="h-7 px-2.5 text-xs font-medium text-white bg-[#4176e6] rounded-md hover:bg-[#3565c7]"
                onClick={saveCatDraft}
              >
                保存
              </button>
              <button
                type="button"
                className="h-7 px-2.5 text-xs text-stone-600 rounded-md hover:bg-stone-200/80"
                onClick={() => {
                  setCatEditor(null);
                  setCatDraft('');
                }}
              >
                取消
              </button>
            </div>
            <p className="text-[10px] text-stone-400 leading-4">
              分类写入文档 frontmatter，文件平铺存放于 知识库管理/；改名不会自动迁移已有文件。
            </p>
          </div>
        ) : null}
      </div>

      <div>
        <label className="text-xs font-medium text-stone-500" htmlFor="kg-title">
          期望名称
        </label>
        <input
          id="kg-title"
          value={titleHint}
          onChange={(e) => setTitleHint(e.target.value)}
          placeholder="如：接口自动化环境约定.md"
          className="mt-1 w-full h-9 px-3 text-sm rounded-lg border border-stone-200 focus:outline-none focus:ring-2 focus:ring-[#4176e6]/40"
        />
        <p className="mt-1.5 text-[11px] text-stone-400 leading-4">
          可填期望文件名；留空则由模型自拟。素材与编写要求在主输入框描述。
        </p>
      </div>
    </SlideOverDrawer>
  );
}
