import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  PLUGIN_CATALOG,
  loadPluginEnabled,
  onPluginEnabledChanged,
  setPluginEnabled,
  type PluginId,
} from '../../lib/plugins';
import {
  GLOBAL_PLUGIN_CATALOG,
  SESSION_PLUGIN_CATALOG,
  builtinRuntimeKey,
  type BuiltinCatalogEntry,
} from '../../lib/builtin-plugin-catalog';
import { fetchMemoryHealth, type MemoryHealth } from '../../lib/memory';
import { fetchWebHealth, type WebHealth } from '../../lib/web-tools';
import { fetchFsHealth, type FsHealth } from '../../lib/fs-tools';
import { fetchBashHealth, fetchPwshHealth, type BashHealth, type PwshHealth } from '../../lib/bash-tools';
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
type MineTab = 'session' | 'global' | 'extension';

type RuntimeStatus = {
  available: boolean | null;
  detail: string;
};

type BuiltinStatus = {
  label: string;
  tone: 'ready' | 'warn' | 'plan';
};

interface Props {
  /** 由路由页传入：/plugins → mine，/plugins/manage → manage */
  tab?: NavId;
  /** 嵌在 AI 工作台右侧时去掉整页 min-height */
  embedded?: boolean;
}

export default function PluginsPage({ tab = 'mine', embedded = false }: Props) {
  const [view, setView] = useState<NavId>(tab);
  const [mineTab, setMineTab] = useState<MineTab>('extension');
  const [enabled, setEnabled] = useState<Record<PluginId, boolean>>(() => loadPluginEnabled());
  const [memory, setMemory] = useState<MemoryHealth | null>(null);
  const [web, setWeb] = useState<WebHealth | null>(null);
  const [fs, setFs] = useState<FsHealth | null>(null);
  const [bash, setBash] = useState<BashHealth | null>(null);
  const [pwsh, setPwsh] = useState<PwshHealth | null>(null);
  const [probing, setProbing] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [settings, setSettings] = useState<LLMSettings | null>(null);
  const [recMeta, setRecMeta] = useState<RecommendCache | null>(() => loadRecommendCache());
  const [recs, setRecs] = useState<CapabilityRecommendation[]>(
    () => loadRecommendCache()?.items ?? [],
  );
  const [recLoading, setRecLoading] = useState(false);
  const [recError, setRecError] = useState<string | null>(null);
  const [hintDraft, setHintDraft] = useState('');
  const [toast, setToast] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const toastTimerRef = useRef<number | null>(null);

  useEffect(() => {
    setView(tab);
  }, [tab]);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current != null) window.clearTimeout(toastTimerRef.current);
    };
  }, []);

  function showToast(message: string) {
    setToast(message);
    if (toastTimerRef.current != null) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => setToast(null), 2800);
  }

  async function refreshRuntime(opts?: { toast?: boolean }): Promise<void> {
    setProbing(true);
    if (opts?.toast) setRefreshing(true);
    try {
      const [m, w, f, b, p] = await Promise.all([
        fetchMemoryHealth(),
        fetchWebHealth(),
        fetchFsHealth(),
        fetchBashHealth(),
        fetchPwshHealth(),
      ]);
      setMemory(m);
      setWeb(w);
      setFs(f);
      setBash(b);
      setPwsh(p);
      if (opts?.toast) {
        const parts = [
          `记忆 ${m?.ok ? '就绪' : '未就绪'}`,
          `网页 ${w?.ok ? '就绪' : '未就绪'}`,
          `工作区 ${f?.ok ? '就绪' : '未就绪'}`,
          `Bash ${b?.ok ? '就绪' : '未就绪'}`,
          `Pwsh ${p?.ok && p.available ? '就绪' : p?.ok ? '未安装' : '未就绪'}`,
        ];
        showToast(`状态已刷新：${parts.join(' · ')}`);
      }
    } finally {
      setProbing(false);
      setRefreshing(false);
    }
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
      void refreshRuntime();
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

  function builtinStatus(entry: BuiltinCatalogEntry): BuiltinStatus {
    const key = builtinRuntimeKey(entry.id);
    if (key === 'none') return { label: '规划中', tone: 'plan' };
    if (key === 'ready') return { label: '已就绪', tone: 'ready' };
    if (
      probing &&
      ((key === 'web' && web === null) ||
        (key === 'fs' && fs === null) ||
        (key === 'bash' && bash === null) ||
        (key === 'pwsh' && pwsh === null))
    ) {
      return { label: '探测中…', tone: 'plan' };
    }
    if (key === 'web') {
      if (web?.ok) return { label: '已就绪', tone: 'ready' };
      return { label: '需本地服务', tone: 'warn' };
    }
    if (key === 'fs') {
      if (fs?.ok) return { label: '已就绪', tone: 'ready' };
      return { label: '需本地服务', tone: 'warn' };
    }
    if (key === 'bash') {
      if (bash?.ok) return { label: '已就绪', tone: 'ready' };
      return { label: '需本地服务', tone: 'warn' };
    }
    if (key === 'pwsh') {
      if (pwsh?.ok && pwsh.available) return { label: '已就绪', tone: 'ready' };
      if (pwsh?.ok) return { label: '未装 PowerShell', tone: 'warn' };
      return { label: '需本地服务', tone: 'warn' };
    }
    return { label: '规划中', tone: 'plan' };
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
            mineTab={mineTab}
            onMineTab={setMineTab}
            enabled={enabled}
            runtimeFor={runtimeFor}
            builtinStatus={builtinStatus}
            onToggle={toggle}
            refreshing={refreshing}
            onRefresh={() => void refreshRuntime({ toast: true })}
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
      {toast ? (
        <div
          className="tw-plugin-toast pointer-events-none fixed bottom-6 left-1/2 z-50 -translate-x-1/2 max-w-[min(92vw,28rem)] px-4 py-2.5 rounded-full bg-stone-900/92 text-white text-[13px] leading-5 shadow-lg text-center"
          role="status"
        >
          {toast}
        </div>
      ) : null}
    </div>
  );
}

function tbFullName(id: string): string {
  return `@tb-plugins/${id}`;
}

function MinePanel(props: {
  mineTab: MineTab;
  onMineTab: (t: MineTab) => void;
  enabled: Record<PluginId, boolean>;
  runtimeFor: (id: PluginId) => RuntimeStatus;
  builtinStatus: (e: BuiltinCatalogEntry) => BuiltinStatus;
  onToggle: (id: PluginId) => void;
  refreshing: boolean;
  onRefresh: () => void;
  onOpenManage: () => void;
}) {
  const {
    mineTab,
    onMineTab,
    enabled,
    runtimeFor,
    builtinStatus,
    onToggle,
    refreshing,
    onRefresh,
    onOpenManage,
  } = props;
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const tabs: Array<{ id: MineTab; label: string; count: number; hint: string }> = [
    { id: 'extension', label: '扩展插件', count: PLUGIN_CATALOG.length, hint: '可开关' },
    { id: 'session', label: '会话插件', count: SESSION_PLUGIN_CATALOG.length, hint: '默认' },
    { id: 'global', label: '全局插件', count: GLOBAL_PLUGIN_CATALOG.length, hint: '默认' },
  ];

  function toggleExpand(id: string) {
    setExpandedId((cur) => (cur === id ? null : id));
  }

  return (
    <>
      <header className="mb-4 flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <h2 className="text-xl font-bold text-stone-900">我的插件</h2>
          <p className="mt-1.5 text-sm text-stone-500 leading-6">
            扩展可开关；会话 / 全局为平台默认。点击卡片展开详情。
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={onRefresh}
            disabled={refreshing}
            title="重新检查本机服务是否可用（记忆、网页、工作区文件等）"
            className="h-9 px-3 rounded-full border border-stone-200 bg-white text-[12px] text-stone-600 hover:bg-stone-50 transition-colors disabled:opacity-60 inline-flex items-center gap-1.5"
          >
            {refreshing ? (
              <>
                <span className="w-3.5 h-3.5 rounded-full border-2 border-stone-400 border-t-transparent animate-spin" />
                刷新中…
              </>
            ) : (
              '刷新状态'
            )}
          </button>
          <button
            type="button"
            onClick={onOpenManage}
            className="h-9 px-4 rounded-full border border-stone-200 bg-white text-[13px] font-medium text-stone-700 shadow-sm hover:bg-stone-50 transition-colors"
          >
            插件管理
          </button>
        </div>
      </header>

      <div
        className="mb-5 grid grid-cols-3 gap-1 p-1 rounded-2xl bg-stone-100 border border-stone-200/90"
        role="tablist"
        aria-label="插件分类"
      >
        {tabs.map((t) => {
          const active = mineTab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => {
                onMineTab(t.id);
                setExpandedId(null);
              }}
              className={`min-w-0 h-11 px-2 rounded-xl text-left transition-all ${
                active
                  ? 'bg-white text-stone-900 shadow-sm ring-1 ring-stone-200/80'
                  : 'text-stone-500 hover:text-stone-700 hover:bg-white/50'
              }`}
            >
              <div className="flex items-baseline gap-1.5 justify-center sm:justify-start sm:px-1">
                <span className="text-[13px] font-semibold truncate">{t.label}</span>
                <span className="text-[11px] tabular-nums text-stone-400">{t.count}</span>
              </div>
              <div
                className={`hidden sm:block text-[10px] px-1 mt-0.5 ${active ? 'text-stone-400' : 'text-stone-400/80'}`}
              >
                {t.hint}
              </div>
            </button>
          );
        })}
      </div>

      {mineTab === 'extension' ? (
        <>
          <p className="mb-3 text-xs text-stone-500">可开关的产品扩展 · {PLUGIN_CATALOG.length} 个</p>
          <ul className="tw-anim-list grid grid-cols-1 md:grid-cols-2 gap-3 items-start">
              {PLUGIN_CATALOG.map((p) => {
              const on = enabled[p.id];
              const rt = runtimeFor(p.id);
              const open = expandedId === `ext:${p.id}`;
              const configLabel = on ? '已启用' : '未启用';
              const runLabel = on && rt.available === true ? '运行中' : '已停用';
              return (
                <li key={p.id} className="min-w-0">
                  <PluginExpandCard
                    open={open}
                    onToggleOpen={() => toggleExpand(`ext:${p.id}`)}
                    title={p.name}
                    subtitle={p.description}
                    badge={
                      <span className="text-[11px] px-1.5 py-0.5 rounded border border-stone-200 text-stone-500 tabular-nums">
                        v{p.version}
                      </span>
                    }
                    trailing={
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
                    }
                    fullName={tbFullName(p.id)}
                    configLabel={configLabel}
                    runLabel={runLabel}
                    extra={rt.detail}
                  />
                </li>
              );
            })}
          </ul>
          <p className="mt-5 text-xs text-stone-400 leading-5">
            开关保存在本机。网页搜索 / 工作区文件已迁入会话默认能力。
          </p>
        </>
      ) : null}

      {mineTab === 'session' ? (
        <BuiltinCatalogGrid
          title="由平台按会话默认提供"
          entries={SESSION_PLUGIN_CATALOG}
          statusOf={builtinStatus}
          groupByCategory={false}
          expandedId={expandedId}
          onExpand={toggleExpand}
          idPrefix="sess"
        />
      ) : null}
      {mineTab === 'global' ? (
        <BuiltinCatalogGrid
          title="由系统与全部会话共享"
          entries={GLOBAL_PLUGIN_CATALOG}
          statusOf={builtinStatus}
          groupByCategory
          expandedId={expandedId}
          onExpand={toggleExpand}
          idPrefix="glob"
        />
      ) : null}
    </>
  );
}

function BuiltinCatalogGrid(props: {
  title: string;
  entries: BuiltinCatalogEntry[];
  statusOf: (e: BuiltinCatalogEntry) => BuiltinStatus;
  groupByCategory: boolean;
  expandedId: string | null;
  onExpand: (id: string) => void;
  idPrefix: string;
}) {
  const { title, entries, statusOf, groupByCategory, expandedId, onExpand, idPrefix } = props;

  const groups = useMemo(() => {
    if (!groupByCategory) return [{ name: '', items: entries }];
    const map = new Map<string, BuiltinCatalogEntry[]>();
    for (const e of entries) {
      const k = e.category || '其它';
      const list = map.get(k) ?? [];
      list.push(e);
      map.set(k, list);
    }
    return [...map.entries()].map(([name, items]) => ({ name, items }));
  }, [entries, groupByCategory]);

  return (
    <div>
      <p className="mb-3 text-xs text-stone-500">
        {title} · {entries.length} 个
      </p>
      <div className="space-y-5">
        {groups.map((g) => (
          <section key={g.name || 'all'}>
            {g.name ? (
              <h3 className="mb-2 text-[13px] font-medium text-stone-600">{g.name}</h3>
            ) : null}
            <ul className="tw-anim-list grid grid-cols-1 md:grid-cols-2 gap-3 items-start">
              {g.items.map((e) => {
                const st = statusOf(e);
                const key = `${idPrefix}:${e.id}`;
                const open = expandedId === key;
                const configLabel = '已启用';
                const runLabel = st.tone === 'ready' ? '运行中' : '已停用';
                return (
                  <li key={e.id} className="min-w-0">
                    <PluginExpandCard
                      open={open}
                      onToggleOpen={() => onExpand(key)}
                      title={e.id}
                      titleMono
                      subtitle={e.roleZh}
                      status={st}
                      fullName={tbFullName(e.id)}
                      configLabel={configLabel}
                      runLabel={runLabel}
                    />
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}

function PluginExpandCard(props: {
  open: boolean;
  onToggleOpen: () => void;
  title: string;
  titleMono?: boolean;
  subtitle: string;
  badge?: ReactNode;
  /** 右侧与标题行对齐的状态（已就绪 / 规划中 / …） */
  status?: BuiltinStatus;
  trailing?: ReactNode;
  fullName: string;
  configLabel: string;
  runLabel: string;
  extra?: string;
}) {
  const {
    open,
    onToggleOpen,
    title,
    titleMono,
    subtitle,
    badge,
    status,
    trailing,
    fullName,
    configLabel,
    runLabel,
    extra,
  } = props;

  return (
    <div
      className={`tw-plugin-card bg-white border rounded-xl transition-colors self-start w-full ${
        open ? 'border-[#4176e6]/50 shadow-sm' : 'border-stone-200 hover:border-stone-300'
      }`}
    >
      <div className="px-4 py-3 flex gap-3 items-start">
        <button
          type="button"
          onClick={onToggleOpen}
          className="flex-1 min-w-0 text-left outline-none focus:outline-none"
          aria-expanded={open}
        >
          <div className="flex items-center gap-2 min-w-0">
            <h3
              className={`font-medium text-stone-900 truncate min-w-0 ${titleMono ? 'font-mono text-[13px]' : 'text-[14px]'}`}
            >
              {title}
            </h3>
            {badge}
            <Chevron
              className={`w-3.5 h-3.5 text-stone-400 shrink-0 transition-transform duration-300 ease-out ${open ? 'rotate-180' : ''}`}
            />
          </div>
          <p className="mt-1.5 text-[13px] text-stone-500 leading-5 line-clamp-2">{subtitle}</p>
        </button>
        <div className="shrink-0 flex items-center gap-2 pt-0.5 self-start">
          {status ? <StatusPill tone={status.tone} label={status.label} /> : null}
          {trailing}
        </div>
      </div>
      <div className={`tw-collapse ${open ? 'is-open' : ''}`} aria-hidden={!open}>
        <div className="tw-collapse-inner">
          <div className="px-4 pb-3 pt-0 border-t border-stone-100">
            <dl className="mt-2.5 space-y-1.5 text-[13px]">
              <div className="flex gap-2">
                <dt className="shrink-0 w-[4.5rem] text-stone-400">完整名称</dt>
                <dd className="min-w-0 font-mono text-[12px] text-stone-700 break-all">{fullName}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="shrink-0 w-[4.5rem] text-stone-400">配置状态</dt>
                <dd className="text-stone-700">{configLabel}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="shrink-0 w-[4.5rem] text-stone-400">运行状态</dt>
                <dd className={runLabel === '运行中' ? 'text-emerald-600' : 'text-stone-500'}>
                  {runLabel}
                </dd>
              </div>
              {extra ? (
                <div className="flex gap-2">
                  <dt className="shrink-0 w-[4.5rem] text-stone-400">说明</dt>
                  <dd className="text-stone-500 text-[12px] leading-5">{extra}</dd>
                </div>
              ) : null}
            </dl>
          </div>
        </div>
      </div>
    </div>
  );
}

function Chevron({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={className} aria-hidden>
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

function StatusPill(props: { tone: BuiltinStatus['tone']; label: string }) {
  const { tone, label } = props;
  const cls =
    tone === 'ready'
      ? 'bg-emerald-50 text-emerald-700 border-emerald-100'
      : tone === 'warn'
        ? 'bg-amber-50 text-amber-800 border-amber-100'
        : 'bg-stone-100 text-stone-500 border-stone-200';
  return (
    <span className={`text-[11px] px-1.5 py-0.5 rounded border ${cls}`}>{label}</span>
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
  const [expandedId, setExpandedId] = useState<string | null>(null);
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
            按诉求或本项目探测可扩展能力；结果缓存在本机，不能一键安装。
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
              ? '描述想要的插件能力，Enter 或点发送按内容探测；Shift+Enter 换行'
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
            title="按输入内容探测推荐"
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
          {recLoading ? '探测中…' : '重新探测'}
        </button>
        <p className="mt-1.5 text-[11px] text-stone-400">
          按本仓库现有能力与测试场景探测推荐，无需输入
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
            尚无列表。可在输入框按诉求发送，或点击「重新探测」按项目生成。
          </p>
        </div>
      )}

      {recs.length > 0 && (
        <>
          <p className="mt-6 mb-3 text-xs text-stone-500">探测结果 · {recs.length} 个</p>
          <ul className="tw-anim-list grid grid-cols-1 md:grid-cols-2 gap-3 items-start">
            {recs.map((r) => {
              const slug = recSlug(r.name);
              const key = `rec:${slug}`;
              const open = expandedId === key;
              return (
                <li key={r.name} className="min-w-0">
                  <PluginExpandCard
                    open={open}
                    onToggleOpen={() => setExpandedId((cur) => (cur === key ? null : key))}
                    title={r.name}
                    subtitle={r.reason}
                    badge={
                      <span
                        className={`text-[11px] px-1.5 py-0.5 rounded border ${
                          r.priority === 'high'
                            ? 'bg-emerald-50 text-emerald-700 border-emerald-100'
                            : 'bg-stone-100 text-stone-500 border-stone-200'
                        }`}
                      >
                        {r.priority === 'high' ? '优先' : '可排期'}
                      </span>
                    }
                    status={
                      r.priority === 'high'
                        ? { label: '建议接入', tone: 'ready' }
                        : { label: '可排期', tone: 'plan' }
                    }
                    fullName={tbFullName(slug)}
                    configLabel="未启用"
                    runLabel="已停用"
                    extra={r.emulateHint ? `落地提示：${r.emulateHint}` : undefined}
                  />
                </li>
              );
            })}
          </ul>
        </>
      )}

      {recMeta && recs.length > 0 && (
        <p className="mt-6 text-xs text-stone-400">
          {new Date(recMeta.fetchedAt).toLocaleString()}
        </p>
      )}
    </>
  );
}

function recSlug(name: string): string {
  const s = name
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '');
  return s || 'recommend';
}
