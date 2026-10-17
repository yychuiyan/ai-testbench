/**
 * 本机配置目录命名：与 GitHub 仓库一致用 lantern-harness，
 * 旧安装的 ai-testbench 目录只读兼容（首次访问复制过来，原目录保留）。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';

describe('user-config 配置目录', () => {
  it('旧目录 ai-testbench 首次访问复制到 lantern-harness，原目录保留', async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'tb-user-config-'));
    const legacy = path.join(home, 'ai-testbench');
    fs.mkdirSync(legacy, { recursive: true });
    fs.writeFileSync(path.join(legacy, 'spaces.json'), '{"activeId":"public"}', 'utf8');
    fs.writeFileSync(path.join(legacy, 'models.json'), '{"providers":[]}', 'utf8');
    process.env.XDG_CONFIG_HOME = home;

    const { USER_CONFIG_DIR_NAME, getConfigPath, getUserConfigDir } =
      await import('../../cli/user-config.mjs');

    const dir = getUserConfigDir();
    assert.equal(USER_CONFIG_DIR_NAME, 'lantern-harness');
    assert.equal(path.basename(dir), 'lantern-harness');
    assert.equal(fs.existsSync(dir), true);
    assert.equal(fs.readFileSync(path.join(dir, 'spaces.json'), 'utf8'), '{"activeId":"public"}');
    assert.equal(fs.readFileSync(path.join(dir, 'models.json'), 'utf8'), '{"providers":[]}');
    assert.equal(getConfigPath(), path.join(dir, 'config.json'));
    assert.equal(fs.existsSync(path.join(legacy, 'spaces.json')), true, '旧目录保留作备份，不删除');
  });
});
