/**
 * spill-policy：何时把过大内容溢出到本机。
 */

export interface SpillPolicy {
  /** 超过该字符数则溢出（默认 24_000，高于 tool-result-pruner） */
  spillChars: number;
  /** 溢出后保留的头/尾预览字符数 */
  previewChars: number;
  /** 是否启用 */
  enabled: boolean;
}

export const DEFAULT_SPILL_POLICY: SpillPolicy = {
  spillChars: 24_000,
  previewChars: 800,
  enabled: true,
};

export function shouldSpill(text: string, policy: SpillPolicy = DEFAULT_SPILL_POLICY): boolean {
  if (!policy.enabled) return false;
  return String(text ?? '').length > Math.max(1, policy.spillChars);
}

export function buildSpillPlaceholder(
  meta: { path: string; bytes: number; originalChars: number },
  previewHead: string,
  previewTail: string,
): string {
  const head = previewHead.trimEnd();
  const tail = previewTail.trimStart();
  return (
    `${head}\n\n` +
    `…[spilled ${meta.originalChars} chars → ${meta.path} (${meta.bytes} bytes); ` +
    `use fs_read on that path if you need the full content]…\n\n` +
    `${tail}`
  );
}
