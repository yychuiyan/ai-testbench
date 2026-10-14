import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  PLUGIN_CATALOG,
  loadPluginEnabled,
  onPluginEnabledChanged,
  setPluginEnabled,
  type PluginId,
} from '../../lib/plugins';
import { fetchMemoryHealth, type MemoryHealth } from '../../lib/memory';
import {
  generateCapabilityRecommendations,
  loadRecommendCache,
  type CapabilityRecommendation,
  type RecommendCache,
} from '../../lib/plugin-recommend';
import {
  hydrateAppConfig,
  loadSettings,
  openSettings,
  onSettingsChanged,
  type LLMSettings,
} from '../../lib/settings';

type NavId = 'mine' | 'manage';

type RuntimeStatus = {
  available: boolean | null;
  detail: string;
};

interface Props {
  /** 由路由页传入：/plugins → mine，/plugins/manage → manage */
  tab?: NavId;
  /** 嵌在 AI 工作台右侧时去掉整页 min-height */
  embedded?: boolean;
}

export default function PluginsPage({ tab = 'mine', embedded = false }: Props) {
  const [view, setView] = useState<NavId>(tab);
  const [enabled, setEnabled] = useState<Record<PluginId, boolean>>(() => loadPluginEnabled());
  const [memory, setMemory] = useState<MemoryHealth | null>(null);
  const [probing, setProbing] = useState(true);

  const [settings, setSettings] = useState<LLMSettings | null>(null);
  const [recMeta, setRecMeta] = useState<RecommendCache | null>(() => loadRecommendCache());
  const [recs, setRecs] = useState<CapabilityRecommendation[]>(
    () => loadRecommendCache()?.items ?? [],
  );
  const [recLoading, setRecLoading] = useState(false);
  const [recError, setRecError] = useState<string | null>(null);
  const [hintDraft, setHintDraft] = useState('');
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    setView(tab);
  }, [tab]);

  function refreshRuntime() {
    setProbing(true);
    void fetchMemoryHealth().then((m) => {
      setMemory(m);
      setProbing(false);
    });
  }

  useEffect(() => {
    const offP = onPluginEnabledChanged((mapNext) => setEnabled(mapNext));
    const offS = onSettingsChanged(() => setSettings(loadSettings()));
    void hydrateAppConfig().then(() => {
      setEnabled(loadPluginEnabled());
      setSettings(loadSettings());
      const cached = loadRecommendCache();
      if (cached?.items?.length) {
        setRecMeta(cached);
        setRecs(cached.items);
      }
      refreshRuntime();
    });
    return () => {
      offP();
      offS();
      abortRef.current?.abort();
    };
  }, []);

  function runtimeFor(id: PluginId): RuntimeStatus {
    if (id === 'caseGen') {
      return {
        available: true,
        detail: '对话输入 / 打开配置面板，生成用例并写入用例库',
      };
    }
    if (id === 'promptGen') {
      return {
        available: true,
        detail: '对话输入 / 打开配置面板，生成提示词并写入提示词库',
      };
    }
    if (id === 'knowledgeGen') {
      return {
        available: true,
        detail: '对话输入 / 打开配置面板，生成文档并写入知识库',
      };
    }
    if (id === 'memory') {
      if (probing && memory === null) return { available: null, detail: '探测中…' };
      if (memory?.ok) {
        return {
          available: true,
          detail: `已连接 · ${memory.entryCount ?? memory.entityCount ?? 0} 条记忆 / 待确认 ${memory.suggestionCount ?? 0}`,
        };
      }
      return { available: false, detail: '本地记忆服务未就绪' };
    }
    if (id === 'knowledge') {
      return {
        available: true,
        detail: '对话输入 @ 可引用知识库与模板文档',
      };
    }
    return { available: false, detail: '未知' };
  }

  function toggle(id: PluginId) {
    setEnabled(setPluginEnabled(id, !enabled[id]));
  }

  async function submitRecommend(mode: 'hint' | 'project', hint = '') {
    const s = loadSettings();
    if (!s) {
      openSettings('model');
      setRecError('请先配置模型（BYOK）');
      return;
    }
    if (mode === 'hint' && !hint.trim()) {
      setRecError('请先输入内容，再回车或点击发送');
      return;
    }

    setRecLoading(true);
    setRecError(null);
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      const cache = await generateCapabilityRecommendations(
        s,
        enabled,
        mode === 'hint' ? hint : '',
        ctrl.signal,
        mode,
      );
      setRecMeta(cache);
      setRecs(cache.items);
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return;
      setRecError(e instanceof Error ? e.message : String(e));
    } finally {
      setRecLoading(false);
    }
  }

  return (
    <div
      className={`tw-plugins-page overflow-y-auto ${embedded ? 'h-full min-h-0' : 'min-h-[calc(100vh-0px)]'}`}
    >
      <div className="w-full px-6 py-6">
        {view === 'mine' ? (
          <MinePanel
            enabled={enabled}
            runtimeFor={runtimeFor}
            onToggle={toggle}
            onRefresh={refreshRuntime}
            onOpenManage={() => setView('manage')}
          />
        ) : (
          <ManagePanel
            settings={settings}
            recs={recs}
            recMeta={recMeta}
            recLoading={recLoading}
            recError={recError}
            hintDraft={hintDraft}
            onHintChange={setHintDraft}
            onSubmitByHint={() => void submitRecommend('hint', hintDraft)}
            onSubmitByProject={() => void submitRecommend('project')}
            onOpenSettings={() => openSettings('model')}
            onBack={() => setView('mine')}
          />
        )}
      </div>
    </div>
  );
}

function MinePanel(props: {
  enabled: Record<PluginId, boolean>;
  runtimeFor: (id: PluginId) => RuntimeStatus;
  onToggle: (id: PluginId) => void;
  onRefresh: () => void;
  onOpenManage: () => void;
}) {
  const { enabled, runtimeFor, onToggle, onRefresh, onOpenManage } = props;
  return (
    <>
      <header className="mb-6 flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <h2 className="text-xl font-bold text-stone-900">我的插件</h2>
          <p className="mt-2 text-sm text-stone-500 leading-6">
            内置能力开关，随本仓库发布。打开后在「我的工作台」对话中挂载对应工具。
          </p>
          <button
            type="button"
            onClick={onRefresh}
            className="mt-3 text-xs text-stone-500 hover:text-amber-700 transition-colors"
          >
            重新探测本地服务
          </button>
        </div>
        <button
          type="button"
          onClick={onOpenManage}
          className="shrink-0 h-9 px-4 rounded-full border border-stone-200 bg-white text-[13px] font-medium text-stone-700 shadow-sm hover:bg-stone-50 transition-colors"
        >
          插件管理
        </button>
      </header>

      <ul className="space-y-4">
        {PLUGIN_CATALOG.map((p) => {
          const on = enabled[p.id];
          const rt = runtimeFor(p.id);
          return (
            <li
              key={p.id}
              className="tw-plugin-card bg-white border border-stone-200 rounded-lg p-5 flex gap-4 items-start"
            >
              <div className="flex-1 min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="font-medium text-stone-900">{p.name}</h3>
                  <span className="text-[11px] px-1.5 py-0.5 rounded border border-stone-200 text-stone-500 tabular-nums">
                    v{p.version}
                  </span>
                  {p.requiresDev && (
                    <span className="text-[11px] px-1.5 py-0.5 rounded bg-stone-100 text-stone-500">
                      仅本地 dev
                    </span>
                  )}
                </div>
                <p className="mt-2 text-sm text-stone-500 leading-6">{p.description}</p>
                <p
                  className={`mt-2 text-xs ${
                    rt.available === true ? 'text-emerald-600' : 'text-stone-400'
                  }`}
                >
                  {rt.detail}
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={on}
                aria-label={`${on ? '关闭' : '打开'} ${p.name}`}
                onClick={() => onToggle(p.id)}
                className="tw-toggle"
              >
                <span className="tw-toggle-knob" />
              </button>
            </li>
          );
        })}
      </ul>

      <p className="mt-8 text-xs text-stone-400 leading-5">
        开关保存在本机浏览器。新增插件需改仓库代码后发布。
      </p>
    </>
  );
}

function ManagePanel(props: {
  settings: LLMSettings | null;
  recs: CapabilityRecommendation[];
  recMeta: RecommendCache | null;
  recLoading: boolean;
  recError: string | null;
  hintDraft: string;
  onHintChange: (v: string) => void;
  onSubmitByHint: () => void;
  onSubmitByProject: () => void;
  onOpenSettings: () => void;
  onBack: () => void;
}) {
  const {
    settings,
    recs,
    recMeta,
    recLoading,
    recError,
    hintDraft,
    onHintChange,
    onSubmitByHint,
    onSubmitByProject,
    onOpenSettings,
    onBack,
  } = props;
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const canSendHint = Boolean(hintDraft.trim()) && !recLoading;

  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [hintDraft]);

  return (
    <>
      <header className="mb-5 flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <h2 className="text-xl font-bold text-stone-900">插件管理</h2>
          <p className="mt-2 text-sm text-stone-500 leading-6">
            输入框按你的诉求生成推荐；下方「推荐插件」按本项目现状推荐。结果缓存在本机；不能一键安装。
          </p>
        </div>
        <button
          type="button"
          onClick={onBack}
          className="shrink-0 h-9 px-4 rounded-full border border-stone-200 bg-white text-[13px] font-medium text-stone-700 shadow-sm hover:bg-stone-50 transition-colors"
        >
          返回我的插件
        </button>
      </header>

      <div className="pt-2 rounded-[20px] bg-white border border-stone-200 shadow-[0_4px_20px_rgba(15,23,42,0.06)] transition-shadow focus-within:shadow-[0_4px_24px_rgba(65,118,230,0.14)]">
        <textarea
          ref={textareaRef}
          value={hintDraft}
          onChange={(e) => onHintChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              if (canSendHint) onSubmitByHint();
            }
          }}
          disabled={recLoading}
          rows={1}
          placeholder={
            settings
              ? '描述想要的插件能力，Enter 或点发送按内容推荐；Shift+Enter 换行'
              : '请先配置模型（左下角「设置」→ 模型）'
          }
          className="block w-full min-h-[36px] pl-[14px] pr-2 pt-1 pb-0 text-sm leading-6 text-stone-800 bg-transparent resize-none focus:outline-none placeholder:text-stone-400 disabled:opacity-60"
        />
        <div className="flex items-center gap-1.5 px-3 pb-3 pt-3">
          {!settings && (
            <button
              type="button"
              onClick={onOpenSettings}
              className="text-[13px] text-amber-800 hover:underline"
            >
              配置模型
            </button>
          )}
          <span className="flex-1" />
          <button
            type="button"
            onClick={onSubmitByHint}
            disabled={!canSendHint}
            title="按输入内容推荐"
            className="w-8 h-8 shrink-0 rounded-full bg-[#4176e6] text-white flex items-center justify-center hover:bg-[#3565c7] disabled:bg-[#a9c3ef] disabled:cursor-not-allowed transition-colors"
          >
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
          </button>
        </div>
      </div>

      <div className="mt-3">
        <button
          type="button"
          onClick={onSubmitByProject}
          disabled={recLoading}
          className="h-9 px-4 rounded-full border border-stone-300 bg-white text-stone-700 text-[13px] font-medium hover:bg-stone-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {recLoading ? '生成中…' : '推荐插件'}
        </button>
        <p className="mt-1.5 text-[11px] text-stone-400">
          按本仓库现有能力与测试场景推荐，无需输入
        </p>
      </div>

      {recError && (
        <p className="mt-4 text-sm text-red-600 bg-red-50 border border-red-100 rounded-md px-3 py-2">
          {recError}
        </p>
      )}

      {recs.length === 0 && !recLoading && (
        <div className="mt-6 rounded-lg border border-dashed border-stone-200 bg-stone-50/80 px-5 py-10 text-center">
          <p className="text-sm text-stone-500">
            尚无列表。可在输入框按诉求发送，或点击下方「推荐插件」按项目生成。
          </p>
        </div>
      )}

      {recs.length > 0 && (
        <ul className="mt-6 space-y-3">
          {recs.map((r) => (
            <li key={r.name} className="tw-plugin-card bg-white border border-stone-200 rounded-lg p-4">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="font-medium text-stone-900">{r.name}</h3>
                <span
                  className={`text-[11px] px-1.5 py-0.5 rounded ${
                    r.priority === 'high'
                      ? 'bg-emerald-50 text-emerald-700'
                      : 'bg-stone-100 text-stone-500'
                  }`}
                >
                  {r.priority === 'high' ? '优先' : '可排期'}
                </span>
              </div>
              <p className="mt-2 text-sm text-stone-600 leading-6">{r.reason}</p>
              <p className="mt-1.5 text-xs text-stone-400 leading-5">落地提示：{r.emulateHint}</p>
            </li>
          ))}
        </ul>
      )}

      {recMeta && recs.length > 0 && (
        <p className="mt-6 text-xs text-stone-400">
          {new Date(recMeta.fetchedAt).toLocaleString()} · 模型 {recMeta.model}
        </p>
      )}
    </>
  );
}
