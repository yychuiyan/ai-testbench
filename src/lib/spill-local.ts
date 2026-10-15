/**
 * spill-local：过大工具结果落到 `.local/spill/`（经 /__tb_spill）。
 */
import {
  DEFAULT_SPILL_POLICY,
  buildSpillPlaceholder,
  shouldSpill,
  type SpillPolicy,
} from './spill-policy';

const API = '/__tb_spill';

let hostAvailable: boolean | null = null;

export async function probeSpillHost(): Promise<boolean> {
  try {
    const res = await fetch(`${API}/health`, { signal: AbortSignal.timeout(1500) });
    if (!res.ok) {
      hostAvailable = false;
      return false;
    }
    const data = (await res.json()) as { ok?: boolean };
    hostAvailable = Boolean(data.ok);
    return hostAvailable;
  } catch {
    hostAvailable = false;
    return false;
  }
}

export async function writeSpill(
  content: string,
  label = 'tool',
): Promise<{ ok: true; path: string; bytes: number } | { ok: false; error: string }> {
  const useHost = hostAvailable ?? (await probeSpillHost());
  if (!useHost) return { ok: false, error: 'spill host unavailable' };
  try {
    const res = await fetch(`${API}/write`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content, label }),
      signal: AbortSignal.timeout(15_000),
    });
    const data = (await res.json()) as {
      ok?: boolean;
      path?: string;
      bytes?: number;
      error?: string;
    };
    if (!res.ok || !data.ok || !data.path) {
      return { ok: false, error: data.error || `HTTP ${res.status}` };
    }
    return { ok: true, path: data.path, bytes: Number(data.bytes) || 0 };
  } catch (e) {
    hostAvailable = false;
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * 若超阈值则落盘并返回占位文本；否则原样返回。
 * 主机不可用时原样返回（交给 pruner 裁剪）。
 */
export async function maybeSpillToolResult(
  text: string,
  label = 'tool',
  policy: SpillPolicy = DEFAULT_SPILL_POLICY,
): Promise<string> {
  const raw = String(text ?? '');
  if (!shouldSpill(raw, policy)) return raw;
  const written = await writeSpill(raw, label);
  if (!written.ok) return raw;
  const n = Math.max(0, policy.previewChars);
  const head = raw.slice(0, n);
  const tail = raw.slice(-n);
  return buildSpillPlaceholder(
    { path: written.path, bytes: written.bytes, originalChars: raw.length },
    head,
    tail,
  );
}
