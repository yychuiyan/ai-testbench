import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { offloadStaleImages } from './image-offload';
import type { ChatMessage } from './llm';

describe('image-offload', () => {
  it('keeps only recent image messages', () => {
    const msgs: ChatMessage[] = [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'old' },
          { type: 'image_url', image_url: { url: 'data:image/png;base64,aa' } },
        ],
      },
      { role: 'assistant', content: 'ok' },
      {
        role: 'user',
        content: [
          { type: 'text', text: 'new' },
          { type: 'image_url', image_url: { url: 'data:image/png;base64,bb' } },
        ],
      },
    ];
    const out = offloadStaleImages(msgs, { keepRecentImageMessages: 1 });
    const first = out[0]!.content;
    assert.ok(Array.isArray(first));
    assert.equal(
      first.some((p) => p.type === 'image_url'),
      false,
    );
    assert.match(String((first as { text?: string }[])[0]?.text), /image-offload/);
    const last = out[2]!.content;
    assert.ok(Array.isArray(last));
    assert.equal(
      last.some((p) => p.type === 'image_url'),
      true,
    );
  });
});
