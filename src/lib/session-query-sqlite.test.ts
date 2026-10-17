import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import {
  querySessionIndex,
  syncSessionQueryIndex,
} from '../../lh-plugins/session-query-sqlite.mjs';

describe('session-query-sqlite', () => {
  let tmp = '';

  before(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tb-sq-'));
  });

  after(() => {
    try {
      fs.rmSync(tmp, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it('sync + query finds message body', async () => {
    const store = {
      activeId: 's1',
      sessions: [
        {
          id: 's1',
          title: '登录流程',
          archived: false,
          deleted: false,
          updatedAt: Date.now(),
          messages: [
            { role: 'user', content: '如何测试支付回调' },
            { role: 'assistant', content: '先造签名再验单' },
          ],
        },
        {
          id: 's2',
          title: '其它',
          archived: false,
          deleted: false,
          updatedAt: Date.now(),
          messages: [{ role: 'user', content: '无关内容' }],
        },
      ],
    };
    const sync = await syncSessionQueryIndex(tmp, store);
    if (!sync.ok && sync.backend === 'unavailable') {
      // Node 无 sqlite 时跳过
      return;
    }
    assert.equal(sync.ok, true);
    assert.equal(sync.backend, 'sqlite');

    const hit = await querySessionIndex(tmp, '支付', { includeArchived: true });
    assert.equal(hit.ok, true);
    assert.ok(hit.hits.some((h) => h.sessionId === 's1'));
  });
});
