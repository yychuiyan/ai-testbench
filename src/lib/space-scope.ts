/**
 * 浏览器缓存按数据空间分键。
 *
 * localStorage / sessionStorage 同源共用，不带空间 id 时，
 * 切换空间会把上一个空间的会话、配置、文档列表首帧画进新空间。
 * 切换成功后必须先记住 id 再 reload，首帧才能读到正确的键。
 */

const ACTIVE_ID_KEY = 'tw.space.active-id';
const LIST_CACHE_KEY = 'tw.spaces.list.v1';

function readStorage(store: 'local' | 'session', key: string): string {
  try {
    const s = store === 'local' ? localStorage : sessionStorage;
    return s.getItem(key)?.trim() || '';
  } catch {
    return '';
  }
}

function writeStorage(store: 'local' | 'session', key: string, value: string): void {
  try {
    const s = store === 'local' ? localStorage : sessionStorage;
    s.setItem(key, value);
  } catch {
    // 隐私模式等忽略
  }
}

/** 当前空间 id：切换前写入，reload 后首帧就能用 */
export function rememberActiveSpaceId(id: string): void {
  const v = String(id || '').trim();
  if (!v) return;
  writeStorage('session', ACTIVE_ID_KEY, v);
  writeStorage('local', ACTIVE_ID_KEY, v);
}

export function readActiveSpaceId(): string {
  const fromSession = readStorage('session', ACTIVE_ID_KEY);
  if (fromSession) return fromSession;
  const fromLocal = readStorage('local', ACTIVE_ID_KEY);
  if (fromLocal) return fromLocal;
  try {
    const raw = sessionStorage.getItem(LIST_CACHE_KEY);
    if (!raw) return '';
    const data = JSON.parse(raw) as { activeId?: unknown };
    return String(data?.activeId || '').trim();
  } catch {
    return '';
  }
}

/** 把缓存键绑到当前空间；尚不知空间 id 时退回原键（静态部署 / 首次打开） */
export function spaceScopedKey(base: string): string {
  const id = readActiveSpaceId();
  return id ? `${base}::${id}` : base;
}
