import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  decodeFileUrl,
  looksLikeBareFilename,
  resolveNameToPasteDocRef,
  resolvePathToPasteDocRef,
} from './composer-paste';

describe('composer-paste', () => {
  it('decodes file:// urls', () => {
    assert.equal(decodeFileUrl('file:///Users/me/knowledge/a.md'), '/Users/me/knowledge/a.md');
  });

  it('detects bare filename from Finder paste', () => {
    assert.equal(looksLikeBareFilename('操作手册.md'), true);
    assert.equal(looksLikeBareFilename('knowledge/a.md'), false);
    assert.equal(looksLikeBareFilename('hello world.md'), false);
  });

  it('resolves project-relative knowledge path', () => {
    const ref = resolvePathToPasteDocRef('/repo/知识库管理/规范/操作手册.md', {
      projectRoot: '/repo',
    });
    assert.ok(ref);
    assert.equal(ref!.collection, 'knowledge');
    assert.equal(ref!.path, '规范/操作手册.md');
  });

  it('resolves legacy English dir alias', () => {
    const ref = resolvePathToPasteDocRef('/repo/knowledge/规范/操作手册.md', {
      projectRoot: '/repo',
    });
    assert.ok(ref);
    assert.equal(ref!.collection, 'knowledge');
    assert.equal(ref!.path, '规范/操作手册.md');
  });

  it('resolves relative dir path without projectRoot', () => {
    const ref = resolvePathToPasteDocRef('用例管理/功能测试/登录.md', {});
    assert.ok(ref);
    assert.equal(ref!.collection, 'cases');
    assert.equal(ref!.path, '功能测试/登录.md');
  });

  it('resolves unique catalog name', () => {
    const ref = resolveNameToPasteDocRef('操作手册.md', [
      {
        collection: 'knowledge',
        path: '规范/操作手册.md',
        title: '操作手册.md',
        category: '知识库',
        format: 'md',
      },
    ]);
    assert.ok(ref);
    assert.equal(ref!.path, '规范/操作手册.md');
  });
});
