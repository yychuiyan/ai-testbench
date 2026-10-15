/**
 * image-offload：超预算时把历史消息里的图片换成占位符，减轻多模态上下文。
 */
import type { ContentPart, MessageContent } from './llm';

export interface ImageOffloadOptions {
  /** 从最近往前，最多保留含图的用户消息条数，默认 1 */
  keepRecentImageMessages?: number;
}

function isMultimodal(content: MessageContent): content is ContentPart[] {
  return Array.isArray(content);
}

function hasImage(content: MessageContent): boolean {
  if (!isMultimodal(content)) return false;
  return content.some((p) => p.type === 'image_url');
}

function stripImages(content: ContentPart[]): ContentPart[] {
  const texts = content
    .filter((p): p is Extract<ContentPart, { type: 'text' }> => p.type === 'text')
    .map((p) => p.text);
  const n = content.filter((p) => p.type === 'image_url').length;
  const note = n > 0 ? `[image-offload] 已卸载 ${n} 张图片（超预算，仅保留最近附图）。` : '';
  const body = [...texts, note].filter(Boolean).join('\n');
  return [{ type: 'text', text: body || note || '（图片已卸载）' }];
}

/**
 * 保留最近 keepRecentImageMessages 条带图消息，更早的图片改为文本占位。
 * 不修改入参数组元素以外的引用时可返回原 messages。
 */
export function offloadStaleImages<T extends { role: string; content: MessageContent }>(
  messages: T[],
  opts: ImageOffloadOptions = {},
): T[] {
  const keep = Math.max(0, Math.floor(opts.keepRecentImageMessages ?? 1));
  const imageIdx: number[] = [];
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i]!;
    if (m.role === 'user' && hasImage(m.content)) imageIdx.push(i);
  }
  if (imageIdx.length <= keep) return messages;
  const keepSet = new Set(imageIdx.slice(-keep));
  let changed = false;
  const next = messages.map((m, i) => {
    if (m.role !== 'user' || !hasImage(m.content) || keepSet.has(i)) return m;
    if (!isMultimodal(m.content)) return m;
    changed = true;
    return { ...m, content: stripImages(m.content) };
  });
  return changed ? next : messages;
}
