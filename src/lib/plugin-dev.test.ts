import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { PLUGIN_DEV_SYSTEM_PROMPT, buildPluginDevSystemPrompt } from './plugin-dev';

describe('插件开发固定提示词', () => {
  const cfg = { active: true as const, requirement: '做一个接口用例评审插件', confirmedAt: 1 };

  it('要求先评估并用选项确认后才改代码', () => {
    assert.match(PLUGIN_DEV_SYSTEM_PROMPT, /ask_user_question/);
    assert.match(PLUGIN_DEV_SYSTEM_PROMPT, /用户回答之前，禁止 fs_write/);
    assert.match(PLUGIN_DEV_SYSTEM_PROMPT, /git commit/);
  });

  it('跳过或未作答不算确认，必须等「开始实施」', () => {
    assert.match(PLUGIN_DEV_SYSTEM_PROMPT, /跳过/);
    assert.match(PLUGIN_DEV_SYSTEM_PROMPT, /都不算确认/);
    assert.match(PLUGIN_DEV_SYSTEM_PROMPT, /开始实施/);
  });

  it('拼上项目根与本次需求', () => {
    const text = buildPluginDevSystemPrompt(cfg, '/repo/lantern');
    assert.ok(text.startsWith(PLUGIN_DEV_SYSTEM_PROMPT));
    assert.match(text, /项目根.*\/repo\/lantern/);
    assert.match(text, /做一个接口用例评审插件/);
  });

  it('需求为空时给出占位说明', () => {
    const text = buildPluginDevSystemPrompt({ ...cfg, requirement: '  ' });
    assert.match(text, /未填写，按用户后续消息执行/);
  });
});
