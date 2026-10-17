import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';

import { readPageSize, writePageSize } from './docs-page-size';

/** 最小 localStorage / sessionStorage 垫片，用来验证偏好键按空间分键 */
class MemoryStorage {
  private map = new Map<string, string>();
  get length(): number {
    return this.map.size;
  }
  getItem(k: string): string | null {
    return this.map.has(k) ? this.map.get(k)! : null;
  }
  setItem(k: string, v: string): void {
    this.map.set(k, String(v));
  }
  removeItem(k: string): void {
    this.map.delete(k);
  }
  clear(): void {
    this.map.clear();
  }
  key(i: number): string | null {
    return [...this.map.keys()][i] ?? null;
  }
}

const local = new MemoryStorage();
const session = new MemoryStorage();

(globalThis as unknown as { localStorage: MemoryStorage }).localStorage = local;
(globalThis as unknown as { sessionStorage: MemoryStorage }).sessionStorage = session;

function activate(spaceId: string) {
  session.setItem('tw.space.active-id', spaceId);
  local.setItem('tw.space.active-id', spaceId);
}

describe('每页条数偏好按空间隔离', () => {
  beforeEach(() => {
    local.clear();
    session.clear();
  });

  it('写入的键带空间 id 后缀', () => {
    activate('sp_a');
    writePageSize(20);
    assert.equal(local.getItem('tw.docs.page-size.v1::sp_a'), '20');
    assert.equal(local.getItem('tw.docs.page-size.v1'), null);
  });

  it('切换空间读不到另一个空间的值', () => {
    activate('sp_a');
    writePageSize(20);
    assert.equal(readPageSize(10), 20);

    activate('sp_b');
    assert.equal(readPageSize(10), 10, '空间 B 应回落到默认值');
    writePageSize(50);

    activate('sp_a');
    assert.equal(readPageSize(10), 20, '回到空间 A 仍读回自己的值');
    activate('sp_b');
    assert.equal(readPageSize(10), 50);
  });

  it('尚无空间 id 时退回未加前缀的键（静态部署首帧）', () => {
    writePageSize(5);
    assert.equal(local.getItem('tw.docs.page-size.v1'), '5');
    assert.equal(readPageSize(10), 5);
  });
});
