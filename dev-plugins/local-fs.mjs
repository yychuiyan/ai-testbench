/**
 * 本地文件 Runner（仅 `astro dev`）：
 * - 工作区根可配置（默认 = 项目根），存 `.local/workspace.json`
 * - readonly / readwrite：相对「当前工作区」
 * - full：另允许本机绝对路径
 */
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/** 系统原生选文件夹（对齐 dsh directoryPicker.pick / Electron showOpenDialog） */
export async function nativePickDirectory() {
  if (process.platform === 'darwin') {
    try {
      const { stdout } = await execFileAsync(
        'osascript',
        [
          '-e',
          'try\nPOSIX path of (choose folder with prompt "选择工作区文件夹")\non error number -128\nreturn ""\nend try',
        ],
        { timeout: 180_000, maxBuffer: 1024 * 1024 },
      );
      const p = String(stdout || '')
        .trim()
        .replace(/\/$/, '');
      return p || null;
    } catch {
      return null;
    }
  }
  if (process.platform === 'linux') {
    for (const cmd of [
      ['zenity', ['--file-selection', '--directory', '--title=选择工作区文件夹']],
      ['kdialog', ['--getexistingdirectory', os.homedir()]],
    ]) {
      try {
        const { stdout } = await execFileAsync(cmd[0], cmd[1], {
          timeout: 180_000,
          maxBuffer: 1024 * 1024,
        });
        const p = String(stdout || '').trim();
        if (p) return p;
      } catch {
        // try next
      }
    }
    return null;
  }
  if (process.platform === 'win32') {
    try {
      const script =
        'Add-Type -AssemblyName System.Windows.Forms; ' +
        '$d = New-Object System.Windows.Forms.FolderBrowserDialog; ' +
        "$d.Description = '选择工作区文件夹'; " +
        "if ($d.ShowDialog() -eq 'OK') { Write-Output $d.SelectedPath }";
      const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-Command', script], {
        timeout: 180_000,
        maxBuffer: 1024 * 1024,
      });
      const p = String(stdout || '').trim();
      return p || null;
    } catch {
      return null;
    }
  }
  return null;
}

const PREFIX = '/__local_fs';
const MAX_READ = 2 * 1024 * 1024;
const MAX_WRITE = 10 * 1024 * 1024;
const MAX_LIST = 500;

function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function normalizeAccess(raw) {
  const v = String(raw ?? 'readonly');
  if (v === 'readwrite' || v === 'full') return v;
  return 'readonly';
}

function expandHome(p) {
  if (p === '~') return os.homedir();
  if (p.startsWith('~/') || p.startsWith('~\\')) return path.join(os.homedir(), p.slice(2));
  return p;
}

function workspaceFile(projectRoot) {
  return path.join(projectRoot, '.local', 'workspaces.json');
}

function legacyWorkspaceFile(projectRoot) {
  return path.join(projectRoot, '.local', 'workspace.json');
}

function folderName(abs) {
  const parts = abs.replace(/\\/g, '/').split('/').filter(Boolean);
  return parts[parts.length - 1] || abs;
}

function ensureWorkspaceRegistry(projectRoot) {
  const rootAbs = path.resolve(projectRoot);
  const fp = workspaceFile(projectRoot);
  let items = [];
  let active = rootAbs;

  try {
    if (fs.existsSync(fp)) {
      const raw = JSON.parse(fs.readFileSync(fp, 'utf8'));
      if (Array.isArray(raw.items)) {
        items = raw.items
          .map((it) => ({
            id: String(it.id || ''),
            path: path.resolve(String(it.path || '')),
            name: String(it.name || folderName(String(it.path || ''))),
            addedAt: Number(it.addedAt) || Date.now(),
          }))
          .filter(
            (it) =>
              it.id && it.path && fs.existsSync(it.path) && fs.statSync(it.path).isDirectory(),
          );
      }
      if (raw.active) active = path.resolve(String(raw.active));
    } else if (fs.existsSync(legacyWorkspaceFile(projectRoot))) {
      const legacy = JSON.parse(fs.readFileSync(legacyWorkspaceFile(projectRoot), 'utf8'));
      const p = String(legacy.path || '').trim();
      if (p && fs.existsSync(p) && fs.statSync(p).isDirectory()) {
        active = path.resolve(p);
        items = [
          {
            id: `ws_${Date.now().toString(36)}`,
            path: active,
            name: folderName(active),
            addedAt: Date.now(),
          },
        ];
      }
    }
  } catch {
    // ignore
  }

  if (!items.some((it) => it.path === rootAbs)) {
    items.unshift({
      id: 'ws_project',
      path: rootAbs,
      name: folderName(rootAbs),
      addedAt: 0,
    });
  }
  if (!items.some((it) => it.path === active)) {
    active = rootAbs;
  }
  return { active, items, projectRoot: rootAbs };
}

function saveWorkspaceRegistry(projectRoot, reg) {
  const fp = workspaceFile(projectRoot);
  fs.mkdirSync(path.dirname(fp), { recursive: true });
  fs.writeFileSync(
    fp,
    JSON.stringify(
      {
        active: reg.active,
        items: reg.items,
        updatedAt: Date.now(),
      },
      null,
      2,
    ),
    'utf8',
  );
}

function readWorkspace(projectRoot) {
  return ensureWorkspaceRegistry(projectRoot).active;
}

function isSystemSensitive(abs) {
  const n = abs.replace(/\\/g, '/').toLowerCase();
  const home = os.homedir().replace(/\\/g, '/').toLowerCase();
  const prefixes = [
    '/system',
    '/usr',
    '/bin',
    '/sbin',
    '/etc',
    '/private/etc',
    '/library/extensions',
    '/dev',
    '/proc',
    '/windows',
    '/program files',
  ];
  if (prefixes.some((p) => n === p || n.startsWith(`${p}/`))) return true;
  if (n.startsWith(`${home}/`) || n === home) return false;
  return false;
}

/**
 * @returns {{ abs: string, display: string, inWorkspace: boolean }}
 */
function resolvePath(workspaceRoot, input, access) {
  let raw = String(input ?? '').trim() || '.';
  if (raw.includes('\0')) throw new Error('invalid path');
  raw = expandHome(raw);
  const ws = path.resolve(workspaceRoot);

  if (path.isAbsolute(raw)) {
    const abs = path.resolve(raw);
    if (isSystemSensitive(abs)) throw new Error('禁止访问系统敏感目录');
    // 绝对路径落在工作区内：任何档位都可（按工作区相对展示）
    if (abs === ws || abs.startsWith(ws + path.sep)) {
      const display = path.relative(ws, abs).split(path.sep).join('/') || '.';
      return { abs, display, inWorkspace: true };
    }
    if (access !== 'full') {
      throw new Error('该路径不在当前工作区内。请先设置工作区，或切换到「完全权限」使用绝对路径。');
    }
    return { abs, display: abs, inWorkspace: false };
  }

  const cleaned = raw.replace(/\\/g, '/').replace(/^\/+/, '');
  const abs = path.resolve(ws, cleaned);
  if (abs !== ws && !abs.startsWith(ws + path.sep)) {
    throw new Error('路径超出当前工作区');
  }
  const display = path.relative(ws, abs).split(path.sep).join('/') || '.';
  return { abs, display, inWorkspace: true };
}

function isBlockedWrite(display, access, inWorkspace) {
  const p = display.replace(/\\/g, '/').toLowerCase();
  if (p === '.git' || p.includes('/.git/') || p.endsWith('/.git')) return true;
  if (access === 'full') return false;
  if (!inWorkspace) return true;
  if (p === 'node_modules' || p.startsWith('node_modules/')) return true;
  if (p === 'dist' || p.startsWith('dist/')) return true;
  return false;
}

function looksBinary(buf) {
  const n = Math.min(buf.length, 8000);
  for (let i = 0; i < n; i++) {
    if (buf[i] === 0) return true;
  }
  return false;
}

/**
 * @returns {import('vite').Plugin}
 */
export function localFsPlugin() {
  return {
    name: 'local-fs',
    configureServer(server) {
      const projectRoot = server.config.root;
      server.middlewares.use(async (req, res, next) => {
        const url = req.url?.split('?')[0] ?? '';
        if (!url.startsWith(PREFIX)) return next();

        try {
          const workspace = readWorkspace(projectRoot);

          if (url === `${PREFIX}/health` && req.method === 'GET') {
            return sendJson(res, 200, {
              ok: true,
              mode: 'workspace',
              projectRoot,
              workspace,
              home: os.homedir(),
              maxReadBytes: MAX_READ,
              maxWriteBytes: MAX_WRITE,
            });
          }

          if (url === `${PREFIX}/workspace` && req.method === 'GET') {
            const reg = ensureWorkspaceRegistry(projectRoot);
            return sendJson(res, 200, {
              workspace: reg.active,
              projectRoot: reg.projectRoot,
              isProject: reg.active === reg.projectRoot,
              items: reg.items,
            });
          }

          if (url === `${PREFIX}/pick-directory` && req.method === 'POST') {
            const picked = await nativePickDirectory();
            if (!picked) {
              return sendJson(res, 200, { ok: true, canceled: true, path: null });
            }
            const abs = path.resolve(picked);
            if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) {
              return sendJson(res, 400, { error: '所选路径不是文件夹', path: abs });
            }
            if (isSystemSensitive(abs)) {
              return sendJson(res, 403, { error: '禁止将该目录设为工作区' });
            }
            return sendJson(res, 200, { ok: true, canceled: false, path: abs });
          }

          const body = req.method === 'POST' ? JSON.parse((await readBody(req)) || '{}') : {};
          const access = normalizeAccess(body.access);

          if (url === `${PREFIX}/workspace` && req.method === 'POST') {
            const reg = ensureWorkspaceRegistry(projectRoot);
            const action = String(body.action || 'select');

            if (action === 'add' || action === 'select') {
              let raw = String(body.path ?? '').trim();
              if (!raw && action === 'select') {
                reg.active = reg.projectRoot;
                saveWorkspaceRegistry(projectRoot, reg);
                return sendJson(res, 200, {
                  ok: true,
                  workspace: reg.active,
                  projectRoot: reg.projectRoot,
                  isProject: true,
                  items: reg.items,
                });
              }
              raw = expandHome(raw);
              const abs = path.resolve(raw);
              if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) {
                return sendJson(res, 400, { error: '目录不存在或不是文件夹', path: abs });
              }
              if (isSystemSensitive(abs)) {
                return sendJson(res, 403, { error: '禁止将该目录设为工作区' });
              }
              let item = reg.items.find((it) => it.path === abs);
              if (!item) {
                item = {
                  id: `ws_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
                  path: abs,
                  name: folderName(abs),
                  addedAt: Date.now(),
                };
                reg.items.push(item);
              }
              if (action === 'select' || action === 'add') reg.active = abs;
              saveWorkspaceRegistry(projectRoot, reg);
              return sendJson(res, 200, {
                ok: true,
                workspace: reg.active,
                projectRoot: reg.projectRoot,
                isProject: reg.active === reg.projectRoot,
                items: reg.items,
              });
            }

            if (action === 'remove') {
              const id = String(body.id || '');
              const target = reg.items.find((it) => it.id === id || it.path === body.path);
              if (!target) return sendJson(res, 404, { error: '工作区不存在' });
              if (target.path === reg.projectRoot) {
                return sendJson(res, 400, { error: '不能移除项目根工作区' });
              }
              reg.items = reg.items.filter((it) => it.id !== target.id);
              if (reg.active === target.path) reg.active = reg.projectRoot;
              saveWorkspaceRegistry(projectRoot, reg);
              return sendJson(res, 200, {
                ok: true,
                workspace: reg.active,
                projectRoot: reg.projectRoot,
                isProject: reg.active === reg.projectRoot,
                items: reg.items,
              });
            }

            if (action === 'rename') {
              const id = String(body.id || '');
              const name = String(body.name || '').trim();
              if (!name) return sendJson(res, 400, { error: '名称不能为空' });
              const target = reg.items.find((it) => it.id === id || it.path === body.path);
              if (!target) return sendJson(res, 404, { error: '工作区不存在' });
              target.name = name.slice(0, 80);
              saveWorkspaceRegistry(projectRoot, reg);
              return sendJson(res, 200, {
                ok: true,
                workspace: reg.active,
                projectRoot: reg.projectRoot,
                isProject: reg.active === reg.projectRoot,
                items: reg.items,
              });
            }

            return sendJson(res, 400, { error: 'unknown action' });
          }

          if (url === `${PREFIX}/list` && req.method === 'POST') {
            const { abs, display } = resolvePath(workspace, body.path || '.', access);
            if (!fs.existsSync(abs))
              return sendJson(res, 404, { error: 'not found', path: display });
            const st = fs.statSync(abs);
            if (!st.isDirectory()) {
              return sendJson(res, 400, { error: 'not a directory', path: display });
            }
            const names = fs.readdirSync(abs);
            const entries = [];
            for (const name of names.slice(0, MAX_LIST)) {
              try {
                const child = path.join(abs, name);
                const cst = fs.statSync(child);
                const childDisplay =
                  display === '.' ? name : `${display.replace(/\/$/, '')}/${name}`;
                entries.push({
                  name,
                  type: cst.isDirectory() ? 'dir' : 'file',
                  path: childDisplay,
                  size: cst.isFile() ? cst.size : undefined,
                });
              } catch {
                // skip
              }
            }
            entries.sort((a, b) => {
              if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
              return a.name.localeCompare(b.name, 'zh');
            });
            return sendJson(res, 200, {
              path: display,
              workspace,
              entries,
              truncated: names.length > MAX_LIST,
              total: names.length,
            });
          }

          if (url === `${PREFIX}/read` && req.method === 'POST') {
            const { abs, display } = resolvePath(workspace, body.path, access);
            if (!fs.existsSync(abs))
              return sendJson(res, 404, { error: 'not found', path: display });
            const st = fs.statSync(abs);
            if (!st.isFile()) return sendJson(res, 400, { error: 'not a file', path: display });
            if (st.size > MAX_READ) {
              return sendJson(res, 413, {
                error: `文件过大（>${MAX_READ} bytes）`,
                path: display,
                size: st.size,
              });
            }
            const buf = fs.readFileSync(abs);
            if (looksBinary(buf)) {
              return sendJson(res, 200, {
                path: display,
                size: st.size,
                encoding: 'binary',
                note: '二进制文件未返回正文；可用「+ → 文件」上传解析',
              });
            }
            return sendJson(res, 200, {
              path: display,
              size: st.size,
              encoding: 'utf-8',
              content: buf.toString('utf8'),
            });
          }

          if (url === `${PREFIX}/write` && req.method === 'POST') {
            if (access === 'readonly') {
              return sendJson(res, 403, { error: '当前为「仅可查看」，禁止写入。' });
            }
            const { abs, display, inWorkspace } = resolvePath(workspace, body.path, access);
            if (isBlockedWrite(display, access, inWorkspace)) {
              return sendJson(res, 403, { error: `权限「${access}」禁止写入：${display}` });
            }
            const content = String(body.content ?? '');
            const bytes = Buffer.byteLength(content, 'utf8');
            if (bytes > MAX_WRITE) {
              return sendJson(res, 413, { error: `写入内容过大（>${MAX_WRITE} bytes）` });
            }
            fs.mkdirSync(path.dirname(abs), { recursive: true });
            fs.writeFileSync(abs, content, 'utf8');
            return sendJson(res, 200, { ok: true, path: display, size: bytes });
          }

          if (url === `${PREFIX}/mkdir` && req.method === 'POST') {
            if (access === 'readonly') {
              return sendJson(res, 403, { error: '当前为「仅可查看」，禁止创建目录。' });
            }
            const { abs, display, inWorkspace } = resolvePath(workspace, body.path, access);
            if (isBlockedWrite(display, access, inWorkspace)) {
              return sendJson(res, 403, { error: `权限禁止创建：${display}` });
            }
            fs.mkdirSync(abs, { recursive: true });
            return sendJson(res, 200, { ok: true, path: display });
          }

          return sendJson(res, 404, { error: 'not found' });
        } catch (e) {
          return sendJson(res, 500, { error: e instanceof Error ? e.message : String(e) });
        }
      });
    },
  };
}
