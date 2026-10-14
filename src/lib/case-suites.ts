/**
 * 本机用例套件（生成结果入库）：
 * - 本地 dev：`.local/case-suites.json`
 * - 静态站：localStorage
 */
import type { TestCaseRow } from './export';

export interface CaseSuite {
  id: string;
  title: string;
  module?: string;
  source: 'generated' | 'knowledge';
  createdAt: number;
  cases: TestCaseRow[];
}

export interface CaseSuiteStore {
  suites: CaseSuite[];
}

const API = '/__local_case_suites';
const LS_KEY = 'tw.case.suites.v1';
const CHANGED = 'tw-case-suites-changed';

let fileMode = false;

function uid(): string {
  return `cs_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

function normalizeStore(raw: Partial<CaseSuiteStore> | null | undefined): CaseSuiteStore {
  if (!raw || !Array.isArray(raw.suites)) return { suites: [] };
  const suites = raw.suites
    .filter((s) => s && typeof s === 'object' && Array.isArray(s.cases))
    .map((s) => ({
      id: String(s.id || uid()),
      title: String(s.title || '未命名套件').trim() || '未命名套件',
      module: typeof s.module === 'string' ? s.module : undefined,
      source: s.source === 'knowledge' ? ('knowledge' as const) : ('generated' as const),
      createdAt: typeof s.createdAt === 'number' ? s.createdAt : Date.now(),
      cases: s.cases,
    }));
  return { suites };
}

function readLs(): CaseSuiteStore {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return { suites: [] };
    return normalizeStore(JSON.parse(raw) as Partial<CaseSuiteStore>);
  } catch {
    return { suites: [] };
  }
}

function writeLs(store: CaseSuiteStore) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(store));
  } catch {
    // ignore
  }
}

function emitChanged() {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(CHANGED));
  }
}

export async function hydrateCaseSuites(): Promise<CaseSuiteStore> {
  try {
    const res = await fetch(API, { signal: AbortSignal.timeout(2000) });
    if (res.ok) {
      const data = (await res.json()) as { store?: Partial<CaseSuiteStore> | null };
      fileMode = true;
      const store = normalizeStore(data.store ?? null);
      writeLs(store);
      return store;
    }
  } catch {
    // fall through
  }
  fileMode = false;
  return readLs();
}

export function loadCaseSuites(): CaseSuiteStore {
  return readLs();
}

async function persistNow(store: CaseSuiteStore): Promise<void> {
  writeLs(store);
  if (!fileMode) return;
  try {
    await fetch(API, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ store }),
    });
  } catch {
    // keep LS
  }
}

export function saveCaseSuite(input: {
  title: string;
  module?: string;
  cases: TestCaseRow[];
}): CaseSuite {
  const suite: CaseSuite = {
    id: uid(),
    title: input.title.trim() || '未命名套件',
    module: input.module?.trim() || undefined,
    source: 'generated',
    createdAt: Date.now(),
    cases: input.cases,
  };
  const store = readLs();
  const next = { suites: [suite, ...store.suites] };
  writeLs(next);
  void persistNow(next);
  emitChanged();
  return suite;
}

export function deleteCaseSuite(id: string): CaseSuiteStore {
  const next = { suites: readLs().suites.filter((s) => s.id !== id) };
  writeLs(next);
  void persistNow(next);
  emitChanged();
  return next;
}

export function onCaseSuitesChanged(cb: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  window.addEventListener(CHANGED, cb);
  return () => window.removeEventListener(CHANGED, cb);
}

export function isCaseSuitesFileMode(): boolean {
  return fileMode;
}
