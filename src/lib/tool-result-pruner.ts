/**
 * 工具返回裁剪（对齐 dsh compaction-tool-result-pruner 子集）：
 * 过长时保留头 + 尾，中间以标记省略，降低后续轮次 token。
 */

export interface PruneToolResultOptions {
  /** 超过该长度才裁剪，默认 12_000 */
  maxChars?: number;
  /** 保留头部字符数，默认 4_000 */
  headChars?: number;
  /** 保留尾部字符数，默认 4_000 */
  tailChars?: number;
}

const DEFAULT_MAX = 12_000;
const DEFAULT_HEAD = 4_000;
const DEFAULT_TAIL = 4_000;

function buildMarker(originalLen: number, head: number, tail: number): string {
  return `\n\n…[tool result pruned: kept head ${head} + tail ${tail} of ${originalLen} chars]…\n\n`;
}

/** 裁剪过长工具结果；未超限原样返回 */
export function pruneToolResult(text: string, opts: PruneToolResultOptions = {}): string {
  const raw = String(text ?? '');
  const maxChars = Math.max(1, opts.maxChars ?? DEFAULT_MAX);
  if (raw.length <= maxChars) return raw;

  let head = Math.max(0, opts.headChars ?? DEFAULT_HEAD);
  let tail = Math.max(0, opts.tailChars ?? DEFAULT_TAIL);

  // 保证头+尾+标记不超过 max，且不超过原文
  let marker = buildMarker(raw.length, head, tail);
  const budget = maxChars - marker.length;
  if (budget <= 0) {
    return raw.slice(0, maxChars);
  }
  if (head + tail > budget) {
    const ratio = budget / (head + tail || 1);
    head = Math.floor(head * ratio);
    tail = Math.max(0, budget - head);
    marker = buildMarker(raw.length, head, tail);
  }

  if (head + tail >= raw.length) return raw;
  return `${raw.slice(0, head)}${marker}${raw.slice(-tail)}`;
}
