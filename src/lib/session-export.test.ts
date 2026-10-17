import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildSessionExportObject,
  exportableMessage,
  sessionToJson,
  sessionToJsonl,
} from './session-export';
import type { ChatSession } from './sessions';

const sample: ChatSession = {
  id: 's1',
  title: '测试/会话',
  createdAt: 1,
  updatedAt: 2,
  archived: false,
  messages: [
    { role: 'user', content: '你好', time: 1 },
    {
      role: 'assistant',
      content: '嗨',
      time: 2,
      images: [{ id: 'i1', name: 'a.png', dataUrl: 'data:image/png;base64,xxx' }],
    },
  ],
};

describe('session-export', () => {
  it('omits image dataUrl', () => {
    const row = exportableMessage(sample.messages[1]);
    assert.equal(Array.isArray(row.images), true);
    const img = (row.images as Array<Record<string, unknown>>)[0]!;
    assert.equal(img.omittedDataUrl, true);
    assert.equal(img.dataUrl, undefined);
  });

  it('builds json and jsonl', () => {
    const obj = buildSessionExportObject(sample);
    assert.equal(obj.session.id, 's1');
    assert.match(sessionToJson(sample), /"format": "lantern-harness-session-v1"/);
    const jl = sessionToJsonl(sample);
    const lines = jl.trim().split('\n');
    assert.equal(lines.length, 3);
    assert.match(lines[0]!, /"type":"session"/);
  });
});
