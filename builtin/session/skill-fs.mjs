/**
 * 工作区 SKILL.md 发现与加载（tool-skill / skill 子集）。
 */
import fs from 'node:fs';
import path from 'node:path';

export const SKILL_LIST_MAX = 40;
export const SKILL_LOAD_MAX_BYTES = 65_536;

const SKILL_SUBDIRS = ['.cursor/skills', '.agents/skills', 'skills'];

/**
 * @param {string} workspaceRoot
 * @param {string} abs
 */
function toWorkspaceRel(workspaceRoot, abs) {
  const ws = path.resolve(workspaceRoot);
  const a = path.resolve(abs);
  if (a === ws) return '.';
  if (a.startsWith(ws + path.sep)) {
    return path.relative(ws, a).split(path.sep).join('/');
  }
  return a;
}

/**
 * @param {string} baseAbs
 * @returns {Array<{ id: string, name: string, abs: string }>}
 */
function collectSkillsUnderBase(baseAbs) {
  /** @type {Array<{ id: string, name: string, abs: string }>} */
  const out = [];
  if (!baseAbs || !fs.existsSync(baseAbs)) return out;

  for (const sub of SKILL_SUBDIRS) {
    const dir = path.join(baseAbs, ...sub.split('/'));
    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) continue;
    let names;
    try {
      names = fs.readdirSync(dir);
    } catch {
      continue;
    }
    for (const name of names) {
      const skillMd = path.join(dir, name, 'SKILL.md');
      if (!fs.existsSync(skillMd) || !fs.statSync(skillMd).isFile()) continue;
      const id = name.toLowerCase().replace(/\s+/g, '-');
      out.push({ id, name, abs: skillMd });
    }
  }

  // 一层：base/*/SKILL.md
  try {
    for (const name of fs.readdirSync(baseAbs)) {
      const skillMd = path.join(baseAbs, name, 'SKILL.md');
      if (!fs.existsSync(skillMd) || !fs.statSync(skillMd).isFile()) continue;
      const id = name.toLowerCase().replace(/\s+/g, '-');
      out.push({ id, name, abs: skillMd });
    }
  } catch {
    // ignore
  }
  return out;
}

/**
 * @param {string} workspace
 * @param {string} [projectRoot]
 * @returns {Array<{ id: string, name: string, path: string }>}
 */
export function listWorkspaceSkills(workspace, projectRoot) {
  const ws = path.resolve(workspace || process.cwd());
  const root = projectRoot ? path.resolve(projectRoot) : ws;
  const bases = [ws];
  if (root && root !== ws) bases.push(root);

  /** @type {Map<string, { id: string, name: string, path: string }>} */
  const byId = new Map();
  for (const base of bases) {
    for (const hit of collectSkillsUnderBase(base)) {
      if (byId.has(hit.id)) continue;
      byId.set(hit.id, {
        id: hit.id,
        name: hit.name,
        path: toWorkspaceRel(ws, hit.abs),
      });
      if (byId.size >= SKILL_LIST_MAX) break;
    }
    if (byId.size >= SKILL_LIST_MAX) break;
  }
  return [...byId.values()];
}

/**
 * @param {string} workspace
 * @param {string} idOrPath
 * @param {string} [projectRoot]
 */
export function loadWorkspaceSkill(workspace, idOrPath, projectRoot) {
  const key = String(idOrPath ?? '').trim();
  if (!key) return { ok: false, error: 'name or path is required' };
  const ws = path.resolve(workspace || process.cwd());
  const root = projectRoot ? path.resolve(projectRoot) : ws;
  let abs = '';

  if (key.includes('/') || key.includes('\\') || key.toLowerCase().endsWith('.md')) {
    abs = path.isAbsolute(key) ? path.resolve(key) : path.resolve(ws, key);
    if (!fs.existsSync(abs) && root !== ws) {
      const alt = path.resolve(root, key);
      if (fs.existsSync(alt)) abs = alt;
    }
  } else {
    const bases = root !== ws ? [ws, root] : [ws];
    for (const base of bases) {
      const candidates = [
        path.join(base, '.cursor', 'skills', key, 'SKILL.md'),
        path.join(base, '.agents', 'skills', key, 'SKILL.md'),
        path.join(base, 'skills', key, 'SKILL.md'),
        path.join(base, key, 'SKILL.md'),
      ];
      abs = candidates.find((p) => fs.existsSync(p)) || '';
      if (abs) break;
    }
  }

  if (!abs || !fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
    return { ok: false, error: `skill not found: ${key}` };
  }

  let buf = fs.readFileSync(abs);
  let truncated = false;
  if (buf.length > SKILL_LOAD_MAX_BYTES) {
    buf = buf.subarray(0, SKILL_LOAD_MAX_BYTES);
    truncated = true;
  }
  const text = buf.toString('utf8');
  const name = path.basename(path.dirname(abs)) || 'skill';
  return {
    ok: true,
    id: name.toLowerCase().replace(/\s+/g, '-'),
    name,
    path: toWorkspaceRel(ws, abs),
    text,
    truncated,
    bytes: buf.length,
  };
}
