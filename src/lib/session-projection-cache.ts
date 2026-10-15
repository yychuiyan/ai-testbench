/**
 * session-projection-cache：会话投影（大纲 / 统计）轻量内存缓存。
 */

interface CacheEntry<T> {
  stamp: string;
  value: T;
}

const outlineCache = new Map<string, CacheEntry<unknown>>();
const statsCache = new Map<string, CacheEntry<unknown>>();
const MAX_ENTRIES = 40;

function stampOf(sessionId: string, updatedAt: number, extra = ''): string {
  return `${sessionId}:${updatedAt}:${extra}`;
}

function trimMap(map: Map<string, CacheEntry<unknown>>) {
  while (map.size > MAX_ENTRIES) {
    const first = map.keys().next().value;
    if (first === undefined) break;
    map.delete(first);
  }
}

export function getCachedProjection<T>(
  kind: 'outline' | 'stats',
  sessionId: string,
  updatedAt: number,
  build: () => T,
  extra = '',
): T {
  const map = kind === 'outline' ? outlineCache : statsCache;
  const stamp = stampOf(sessionId, updatedAt, extra);
  const hit = map.get(sessionId);
  if (hit && hit.stamp === stamp) {
    return hit.value as T;
  }
  const value = build();
  map.set(sessionId, { stamp, value });
  trimMap(map);
  return value;
}

/** 测试用 */
export function clearProjectionCacheForTests() {
  outlineCache.clear();
  statsCache.clear();
}
