/**
 * DSML 解析回归：防止 DeepSeek 工具标签再泄漏到 UI。
 * 运行：npx tsx --test src/lib/llm-dsml.test.ts
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseDsmlToolCalls, sanitizeAssistantContent, scrubDsmlArtifacts } from './llm';

const DOUBLE = `<|DSML||calls><|DSML||invoke name="fs_list"><|DSML||parameter name="path" string="true">remotion/public/clips</|DSML||parameter></|DSML||invoke><|DSML||invoke name="fs_list"><|DSML||parameter name="path" string="true">remotion/public/music</|DSML||parameter></|DSML||invoke></|DSML||calls>`;

const SINGLE = `<|DSML|calls><|DSML|invoke name="fs_list"><|DSML|parameter name="path" string="true">x</|DSML|parameter></|DSML|invoke></|DSML|calls>`;

const FULLWIDTH = `<｜DSML｜calls><｜DSML｜invoke name="fs_list"><｜DSML｜parameter name="path" string="true">y</｜DSML｜parameter></｜DSML｜invoke></｜DSML｜calls>`;

/** 流式/部分网关会在管道间插入空格 */
const SPACED = `< | | DSML | | calls> < | | DSML | | invoke name="web_fetch"> < | | DSML | | parameter name="url" string="true">https://example.com/events</ | | DSML | | parameter> </ | | DSML | | invoke> </ | | DSML | | calls>`;

describe('parseDsmlToolCalls', () => {
  it('parses double-pipe <|DSML||…> (DeepSeek V4 leak format)', () => {
    const { calls, cleaned } = parseDsmlToolCalls(DOUBLE);
    assert.equal(calls.length, 2);
    assert.equal(calls[0]?.function.name, 'fs_list');
    assert.equal(JSON.parse(calls[0]!.function.arguments).path, 'remotion/public/clips');
    assert.equal(JSON.parse(calls[1]!.function.arguments).path, 'remotion/public/music');
    assert.equal(cleaned, '');
  });

  it('parses single-pipe and fullwidth variants', () => {
    assert.equal(parseDsmlToolCalls(SINGLE).calls.length, 1);
    assert.equal(parseDsmlToolCalls(FULLWIDTH).calls.length, 1);
  });

  it('parses spaced-pipe <| | DSML | |…> leak format', () => {
    const { calls, cleaned } = parseDsmlToolCalls(SPACED);
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.function.name, 'web_fetch');
    assert.equal(JSON.parse(calls[0]!.function.arguments).url, 'https://example.com/events');
    assert.ok(!/DSML/i.test(cleaned));
  });

  it('keeps prose before DSML and strips tags', () => {
    const { calls, cleaned } = parseDsmlToolCalls(`好的，我来看一下。\n${DOUBLE}`);
    assert.equal(calls.length, 2);
    assert.equal(cleaned, '好的，我来看一下。');
  });
});

describe('sanitizeAssistantContent', () => {
  it('never returns raw DSML to the UI', () => {
    assert.equal(sanitizeAssistantContent(DOUBLE), '');
    assert.ok(!/DSML/i.test(sanitizeAssistantContent(`前言 ${DOUBLE}`) || ''));
    assert.equal(scrubDsmlArtifacts(`前文${DOUBLE}`), '前文');
    assert.ok(!/DSML/i.test(sanitizeAssistantContent(SPACED) || ''));
    assert.ok(!/DSML/i.test(scrubDsmlArtifacts(`前文 ${SPACED}`) || ''));
  });

  it('strips DSML leaked into reasoning-style prose', () => {
    const leaked = `Let me retry.\n${DOUBLE}`;
    const safe = sanitizeAssistantContent(leaked);
    assert.ok(!/DSML/i.test(safe));
    assert.match(safe, /Let me retry/);
  });
});
