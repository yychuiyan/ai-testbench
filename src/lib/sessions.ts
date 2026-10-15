/**
 * 多会话存档：
 * - 本地 dev：`.local/sessions.json`（换浏览器打开同一项目仍可见）
 * - 静态站：回退 localStorage
 * 兼容旧版单列表键 `tw-chat-history`：首次加载时自动迁入「默认会话」。
 */
import type { CaseGenPluginConfig } from './case-gen-config';
import type { KnowledgeGenPluginConfig } from './knowledge-gen-config';
import type { PromptGenPluginConfig } from './prompt-gen-config';
import type { TodoItem } from './session-interact';
import type { SessionGoal } from './session-goal';

const SESS_API = '/__tb_sessions';
const STORE_KEY = 'tw-chat-sessions';
const ACTIVE_KEY = 'tw-chat-active-id';
const LEGACY_HISTORY_KEY = 'tw-chat-history';
const RAIL_KEY = 'tw-session-rail-open';

let sessionsFileMode = false;
let persistSessTimer: ReturnType<typeof setTimeout> | null = null;

export interface ChatSession {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  archived: boolean;
  /** 软删除：进入「已删除」分类，与归档并列 */
  deleted?: boolean;
  /** 置顶（dsh pinSession） */
  pinned?: boolean;
  /** 所属工作区绝对路径；缺省 / 无效 → 归入项目根工作区展示 */
  workspacePath?: string;
  /** 消息结构由 ChatApp 的 LocalMessage 序列化而来 */
  messages: unknown[];
  /** AI 工作台「用例生成」插件：确认后挂到当前会话 */
  caseGen?: CaseGenPluginConfig;
  /** AI 工作台「生成提示词」插件：确认后挂到当前会话 */
  promptGen?: PromptGenPluginConfig;
  /** AI 工作台「生成知识库」插件：确认后挂到当前会话 */
  knowledgeGen?: KnowledgeGenPluginConfig;
  /** 会话待办（todo_write） */
  todos?: TodoItem[];
  /** 会话目标（tool-goal / command-goal） */
  goal?: SessionGoal;
}

export interface SessionStore {
  sessions: ChatSession[];
  activeId: string;
}

function uid(): string {
  return `s_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function emptySession(partial?: Partial<ChatSession>): ChatSession {
  const now = Date.now();
  return {
    id: uid(),
    title: '新对话',
    createdAt: now,
    updatedAt: now,
    archived: false,
    pinned: false,
    messages: [],
    ...partial,
  };
}

/** 从首条用户消息生成标题（截断） */
export function titleFromMessages(messages: Array<{ role?: string; content?: string }>): string {
  const first = messages.find((m) => m.role === 'user' && (m.content ?? '').trim());
  const text = (first?.content ?? '').trim().replace(/\s+/g, ' ');
  if (!text) return '新对话';
  return text.length > 24 ? `${text.slice(0, 24)}…` : text;
}

function readLegacyMessages(): unknown[] {
  try {
    const raw = localStorage.getItem(LEGACY_HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function normalizeStore(parsed: Partial<SessionStore> | null | undefined): SessionStore | null {
  if (!parsed) return null;
  // 已取消「已删除」回收站：加载时清掉历史软删除，仅保留真实会话
  const sessions = (
    Array.isArray(parsed.sessions) ? (parsed.sessions as ChatSession[]) : []
  ).filter((s) => !s.deleted);
  if (!sessions.length) return null;
  const activeId =
    typeof parsed.activeId === 'string' && sessions.some((s) => s.id === parsed.activeId)
      ? parsed.activeId
      : (sessions.find((s) => !s.archived)?.id ?? sessions[0].id);
  return { sessions, activeId };
}

function loadSessionStoreFromLs(): SessionStore | null {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return null;
    return normalizeStore(JSON.parse(raw) as Partial<SessionStore>);
  } catch {
    return null;
  }
}

function writeSessionStoreLs(store: SessionStore) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(store));
    localStorage.setItem(ACTIVE_KEY, store.activeId);
  } catch {
    // 存储满时静默失败
  }
}

function bootstrapEmptyStore(): SessionStore {
  const legacy = readLegacyMessages();
  const first = emptySession({
    title: legacy.length
      ? titleFromMessages(legacy as Array<{ role?: string; content?: string }>)
      : '新对话',
    messages: legacy,
  });
  const store = { sessions: [first], activeId: first.id };
  try {
    localStorage.removeItem(LEGACY_HISTORY_KEY);
  } catch {
    // ignore
  }
  return store;
}

/**
 * 启动时优先拉文件会话；失败则用 localStorage。
 * ChatApp 应 await 此函数后再 setStore。
 */
export async function hydrateSessionStore(): Promise<SessionStore> {
  try {
    const res = await fetch(SESS_API, { signal: AbortSignal.timeout(2000) });
    if (res.ok) {
      const data = (await res.json()) as { store?: Partial<SessionStore> | null };
      sessionsFileMode = true;
      let store = normalizeStore(data.store ?? null);
      if (!store) {
        store = loadSessionStoreFromLs() ?? bootstrapEmptyStore();
        await persistSessionStoreNow(store);
      } else {
        writeSessionStoreLs(store);
      }
      return store;
    }
  } catch {
    // fall through
  }
  sessionsFileMode = false;
  return loadSessionStoreFromLs() ?? bootstrapEmptyStore();
}

/** 同步读取（hydrate 前可能为空壳）；优先内存镜像 localStorage */
export function loadSessionStore(): SessionStore {
  return loadSessionStoreFromLs() ?? bootstrapEmptyStore();
}

async function persistSessionStoreNow(store: SessionStore): Promise<void> {
  writeSessionStoreLs(store);
  if (!sessionsFileMode) return;
  try {
    await fetch(SESS_API, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ store }),
    });
  } catch {
    // 写盘失败时仍保留 localStorage
  }
}

export function saveSessionStore(store: SessionStore): void {
  writeSessionStoreLs(store);
  if (persistSessTimer) clearTimeout(persistSessTimer);
  persistSessTimer = setTimeout(() => {
    persistSessTimer = null;
    void persistSessionStoreNow(store);
  }, 320);
}

export function isSessionsFileMode(): boolean {
  return sessionsFileMode;
}

export function createSession(
  store: SessionStore,
  opts?: { workspacePath?: string },
): SessionStore {
  const s = emptySession({
    workspacePath: opts?.workspacePath,
  });
  return {
    sessions: [s, ...store.sessions],
    activeId: s.id,
  };
}

/** 会话归属工作区；path 为空则解除归属（侧栏归入项目根） */
export function bindSessionWorkspace(
  store: SessionStore,
  sessionId: string,
  workspacePath: string | undefined,
): SessionStore {
  return {
    ...store,
    sessions: store.sessions.map((s) =>
      s.id === sessionId
        ? {
            ...s,
            workspacePath: workspacePath || undefined,
            updatedAt: Date.now(),
          }
        : s,
    ),
  };
}

export function renameSession(store: SessionStore, id: string, title: string): SessionStore {
  const next = title.trim() || '未命名';
  return {
    ...store,
    sessions: store.sessions.map((s) =>
      s.id === id ? { ...s, title: next, updatedAt: Date.now() } : s,
    ),
  };
}

export function pinSession(store: SessionStore, id: string, pinned = true): SessionStore {
  return {
    ...store,
    sessions: store.sessions.map((s) => {
      if (s.id !== id) return s;
      // 归档与置顶互斥（对齐 dsh）
      if (pinned && s.archived)
        return { ...s, pinned: true, archived: false, updatedAt: Date.now() };
      return { ...s, pinned, updatedAt: Date.now() };
    }),
  };
}

/** 硬删除（空会话丢弃 / 已删除中永久清除） */
export function deleteSession(store: SessionStore, id: string): SessionStore {
  const sessions = store.sessions.filter((s) => s.id !== id);
  if (!sessions.length) {
    const s = emptySession();
    return { sessions: [s], activeId: s.id };
  }
  const activeId =
    store.activeId === id
      ? (sessions.find((s) => !s.archived && !s.deleted)?.id ?? sessions[0].id)
      : store.activeId;
  return { sessions, activeId };
}

/** 软删除 →「已删除」；可从回收站再硬删 */
export function softDeleteSession(store: SessionStore, id: string): SessionStore {
  const sessions = store.sessions.map((s) =>
    s.id === id
      ? {
          ...s,
          deleted: true,
          archived: false,
          pinned: false,
          updatedAt: Date.now(),
        }
      : s,
  );
  let activeId = store.activeId;
  if (activeId === id) {
    activeId = sessions.find((x) => !x.archived && !x.deleted)?.id ?? sessions[0].id;
  }
  return { sessions, activeId };
}

export function restoreDeletedSession(store: SessionStore, id: string): SessionStore {
  return {
    ...store,
    sessions: store.sessions.map((s) =>
      s.id === id ? { ...s, deleted: false, updatedAt: Date.now() } : s,
    ),
  };
}

export function archiveSession(store: SessionStore, id: string, archived = true): SessionStore {
  const sessions = store.sessions.map((s) =>
    s.id === id
      ? {
          ...s,
          archived,
          deleted: archived ? false : s.deleted,
          pinned: archived ? false : s.pinned,
          updatedAt: Date.now(),
        }
      : s,
  );
  let activeId = store.activeId;
  if (archived && activeId === id) {
    activeId = sessions.find((s) => !s.archived && !s.deleted)?.id ?? sessions[0].id;
  }
  return { sessions, activeId };
}

/** 工作区从列表移除时，解除其下会话归属（侧栏归入项目根） */
export function unbindSessionsFromWorkspace(
  store: SessionStore,
  workspacePath: string,
): SessionStore {
  return {
    ...store,
    sessions: store.sessions.map((s) =>
      s.workspacePath === workspacePath
        ? { ...s, workspacePath: undefined, updatedAt: Date.now() }
        : s,
    ),
  };
}

/** 无消息、无插件任务的空「新对话」，切换时丢弃 */
export function isEphemeralEmptySession(s: ChatSession): boolean {
  if (s.archived || s.deleted || s.pinned) return false;
  if (s.caseGen?.active || s.promptGen?.active || s.knowledgeGen?.active) return false;
  if (Array.isArray(s.messages) && s.messages.length > 0) return false;
  const title = (s.title || '').trim();
  return !title || title === '新对话';
}

export function updateActiveMessages(
  store: SessionStore,
  messages: unknown[],
  opts?: {
    touchTitle?: boolean;
    /** 默认 true；切会话仅回写时传 false，避免侧栏重排 */ touchUpdatedAt?: boolean;
  },
): SessionStore {
  const touchUpdatedAt = opts?.touchUpdatedAt !== false;
  return {
    ...store,
    sessions: store.sessions.map((s) => {
      if (s.id !== store.activeId) return s;
      const title =
        opts?.touchTitle && (s.title === '新对话' || !s.title)
          ? titleFromMessages(messages as Array<{ role?: string; content?: string }>)
          : s.title === '新对话'
            ? titleFromMessages(messages as Array<{ role?: string; content?: string }>)
            : s.title;
      return {
        ...s,
        messages: messages.slice(-80),
        title,
        updatedAt: touchUpdatedAt ? Date.now() : s.updatedAt,
      };
    }),
  };
}

/** 向任意会话追加一条消息（定时提醒投递等） */
export function appendSessionMessage(
  store: SessionStore,
  sessionId: string,
  message: unknown,
): SessionStore {
  return {
    ...store,
    sessions: store.sessions.map((s) => {
      if (s.id !== sessionId) return s;
      const messages = [...(Array.isArray(s.messages) ? s.messages : []), message].slice(-80);
      return { ...s, messages, updatedAt: Date.now() };
    }),
  };
}

export function updateActiveSessionMeta(
  store: SessionStore,
  patch: Partial<
    Pick<
      ChatSession,
      'caseGen' | 'promptGen' | 'knowledgeGen' | 'title' | 'workspacePath' | 'todos' | 'goal'
    >
  >,
): SessionStore {
  return {
    ...store,
    sessions: store.sessions.map((s) =>
      s.id === store.activeId ? { ...s, ...patch, updatedAt: Date.now() } : s,
    ),
  };
}

function normalizeCasePath(p: string): string {
  return p.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '');
}

function pathMatches(linked: string, target: string): boolean {
  const n = normalizeCasePath(linked);
  const t = normalizeCasePath(target);
  if (n === t) return true;
  if (n.endsWith(`/${t}`) || t.endsWith(`/${n}`)) return true;
  return (n.split('/').pop() ?? n) === (t.split('/').pop() ?? t);
}

/** 按用例文件路径查找工作台会话（插件生成入库后） */
export function findChatSessionByCasePath(
  store: SessionStore,
  linkedCasePath: string,
): ChatSession | undefined {
  const byMeta = store.sessions.find((s) => {
    const lp = s.caseGen?.linkedCasePath;
    return Boolean(lp && pathMatches(lp, linkedCasePath));
  });
  if (byMeta) return byMeta;
  return store.sessions.find((s) =>
    (s.messages as Array<{ caseFile?: { path?: string } }>).some(
      (m) => m?.caseFile?.path && pathMatches(m.caseFile.path, linkedCasePath),
    ),
  );
}

/** 按提示词 / 知识库入库路径查找工作台会话 */
export function findChatSessionByDocsPath(
  store: SessionStore,
  root: 'prompts' | 'knowledge',
  filePath: string,
): ChatSession | undefined {
  const byMeta = store.sessions.find((s) => {
    const lp =
      root === 'prompts' ? s.promptGen?.linkedPromptPath : s.knowledgeGen?.linkedKnowledgePath;
    return Boolean(lp && pathMatches(lp, filePath));
  });
  if (byMeta) return byMeta;
  return store.sessions.find((s) =>
    (s.messages as Array<{ docsFile?: { root?: string; path?: string } }>).some(
      (m) =>
        m?.docsFile?.root === root && m.docsFile.path && pathMatches(m.docsFile.path, filePath),
    ),
  );
}

export function switchSession(store: SessionStore, id: string): SessionStore {
  if (!store.sessions.some((s) => s.id === id)) return store;
  return { ...store, activeId: id };
}

/** 组内排序：置顶优先，再按更新时间 */
export function sortSessionsInGroup(list: ChatSession[]): ChatSession[] {
  return [...list].sort((a, b) => {
    const ap = a.pinned ? 1 : 0;
    const bp = b.pinned ? 1 : 0;
    if (ap !== bp) return bp - ap;
    return b.updatedAt - a.updatedAt;
  });
}

export function loadRailOpen(): boolean {
  try {
    return localStorage.getItem(RAIL_KEY) !== '0';
  } catch {
    return true;
  }
}

export function saveRailOpen(open: boolean): void {
  try {
    localStorage.setItem(RAIL_KEY, open ? '1' : '0');
  } catch {
    // ignore
  }
}
