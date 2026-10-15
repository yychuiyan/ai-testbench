import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { listWorkspaceSkills, loadWorkspaceSkill } from '../../builtin/session/skill-fs.mjs';

describe('skill-fs', () => {
  let tmp = '';

  before(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tb-skill-'));
    fs.mkdirSync(path.join(tmp, '.cursor', 'skills', 'demo-skill'), { recursive: true });
    fs.writeFileSync(
      path.join(tmp, '.cursor', 'skills', 'demo-skill', 'SKILL.md'),
      '# Demo Skill\n\nDo the thing.\n',
      'utf8',
    );
    fs.mkdirSync(path.join(tmp, 'skills', 'other'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'skills', 'other', 'SKILL.md'), '# Other\n', 'utf8');
  });

  after(() => {
    try {
      fs.rmSync(tmp, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it('listWorkspaceSkills finds .cursor/skills and skills/', () => {
    const list = listWorkspaceSkills(tmp, tmp);
    const ids = list.map((s) => s.id).sort();
    assert.deepEqual(ids, ['demo-skill', 'other']);
    assert.ok(list.every((s) => s.path.includes('SKILL.md')));
  });

  it('loadWorkspaceSkill by id and by path', () => {
    const byId = loadWorkspaceSkill(tmp, 'demo-skill', tmp);
    assert.equal(byId.ok, true);
    if (!byId.ok) return;
    assert.match(byId.text, /Demo Skill/);
    assert.equal(byId.id, 'demo-skill');

    const byPath = loadWorkspaceSkill(tmp, 'skills/other/SKILL.md', tmp);
    assert.equal(byPath.ok, true);
    if (!byPath.ok) return;
    assert.match(byPath.text, /Other/);
  });

  it('loadWorkspaceSkill missing returns error', () => {
    const miss = loadWorkspaceSkill(tmp, 'no-such-skill', tmp);
    assert.equal(miss.ok, false);
    if (miss.ok) return;
    assert.match(miss.error, /not found/);
  });
});
