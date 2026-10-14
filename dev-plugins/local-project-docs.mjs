/**
 * 项目内固定根目录文档库（仅 `astro dev`）：
 * - requirements/ → `/__local_requirements`（界面：需求文档库）
 * - cases/        → `/__local_cases`（界面：用例管理）
 * - templates/    → `/__local_templates`（界面：测试模板库）
 * - prompts/      → `/__local_prompts`（界面：提示词管理）
 * - knowledge/    → `/__local_knowledge`（界面：知识库管理）
 * 支持 list / mkdir / upload / read / delete / open；路径不得逃出根目录。
 */
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/** 用系统默认程序打开本地文件 */
async function openLocalPath(absPath) {
  if (process.platform === 'darwin') {
    await execFileAsync('open', [absPath]);
    return;
  }
  if (process.platform === 'win32') {
    await execFileAsync('cmd', ['/c', 'start', '', absPath], { windowsHide: true });
    return;
  }
  await execFileAsync('xdg-open', [absPath]);
}

const MAX_UPLOAD = 12 * 1024 * 1024;
const MAX_READ = 4 * 1024 * 1024;
const MAX_LIST = 800;

const ALLOWED_EXT = new Set(['.md', '.txt', '.docx', '.csv', '.xlsx', '.xls']);

function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function ensureRoot(absRoot, onReady, readyFlag) {
  fs.mkdirSync(absRoot, { recursive: true });
  const keep = path.join(absRoot, '.gitkeep');
  if (!fs.existsSync(keep)) fs.writeFileSync(keep, '', 'utf8');
  // onReady 每个进程只跑一次，避免 health 反复执行种子逻辑
  if (typeof onReady === 'function' && readyFlag && !readyFlag.done) {
    onReady(absRoot);
    readyFlag.done = true;
  }
}

/** 相对根的 posix 路径校验；返回绝对路径 */
function resolveUnderRoot(absRoot, relInput) {
  const raw =
    String(relInput ?? '.')
      .replace(/\\/g, '/')
      .trim() || '.';
  if (raw.includes('\0') || raw.split('/').includes('..')) {
    throw Object.assign(new Error('非法路径'), { status: 400 });
  }
  const abs = path.resolve(absRoot, raw === '.' ? '' : raw);
  const rootResolved = path.resolve(absRoot);
  if (abs !== rootResolved && !abs.startsWith(rootResolved + path.sep)) {
    throw Object.assign(new Error('路径越界'), { status: 403 });
  }
  const display =
    abs === rootResolved
      ? '.'
      : abs
          .slice(rootResolved.length + 1)
          .split(path.sep)
          .join('/');
  return { abs, display };
}

function extOf(name) {
  const i = name.lastIndexOf('.');
  return i >= 0 ? name.slice(i).toLowerCase() : '';
}

/** 旧目录（英文 / 中文短名）→ 与菜单一致的中文长名（仅当目标尚不存在时改名） */
function migrateLegacyRoot(projectRoot, legacyNames, dirName) {
  const names = Array.isArray(legacyNames) ? legacyNames : legacyNames ? [legacyNames] : [];
  const to = path.join(projectRoot, dirName);
  for (const legacyName of names) {
    if (!legacyName || legacyName === dirName) continue;
    const from = path.join(projectRoot, legacyName);
    if (!fs.existsSync(from)) continue;
    if (!fs.existsSync(to)) {
      try {
        fs.renameSync(from, to);
      } catch {
        // ignore
      }
      continue;
    }
    // 目标已存在：若旧目录为空（仅 .gitkeep / 空壳），直接删掉，避免双目录并存
    try {
      const leftovers = fs.readdirSync(from).filter((n) => n !== '.gitkeep' && n !== '.DS_Store');
      if (leftovers.length === 0) {
        fs.rmSync(from, { recursive: true, force: true });
      }
    } catch {
      // ignore
    }
  }
}

/**
 * @param {{ prefix: string, dirName: string, name: string, legacyDirNames?: string[], onReady?: (absRoot: string) => void }} opts
 * @returns {import('vite').Plugin}
 */
function createDocsPlugin(opts) {
  const { prefix, dirName, name, legacyDirNames, onReady } = opts;
  return {
    name,
    configureServer(server) {
      const projectRoot = server.config.root;
      migrateLegacyRoot(projectRoot, legacyDirNames, dirName);
      const absRoot = path.join(projectRoot, dirName);
      const readyFlag = { done: false };
      ensureRoot(absRoot, onReady, readyFlag);

      server.middlewares.use(async (req, res, next) => {
        const url = req.url?.split('?')[0] ?? '';
        if (!url.startsWith(prefix)) return next();

        try {
          if (url === `${prefix}/health` && req.method === 'GET') {
            ensureRoot(absRoot, onReady, readyFlag);
            return sendJson(res, 200, {
              ok: true,
              mode: 'project-docs',
              root: dirName,
              absRoot,
            });
          }

          if (url === `${prefix}/list` && req.method === 'POST') {
            const body = JSON.parse((await readBody(req)).toString('utf8') || '{}');
            const { abs, display } = resolveUnderRoot(absRoot, body.path || '.');
            if (!fs.existsSync(abs))
              return sendJson(res, 404, { error: 'not found', path: display });
            const st = fs.statSync(abs);
            if (!st.isDirectory())
              return sendJson(res, 400, { error: 'not a directory', path: display });
            const names = fs.readdirSync(abs);
            const entries = [];
            for (const n of names.slice(0, MAX_LIST)) {
              if (n === '.gitkeep') continue;
              try {
                const child = path.join(abs, n);
                const cst = fs.statSync(child);
                const childDisplay = display === '.' ? n : `${display.replace(/\/$/, '')}/${n}`;
                entries.push({
                  name: n,
                  type: cst.isDirectory() ? 'dir' : 'file',
                  path: childDisplay,
                  size: cst.isFile() ? cst.size : undefined,
                  mtime: cst.mtimeMs,
                  // birthtime 在部分系统上可能回落到 mtime
                  ctime: cst.birthtimeMs || cst.ctimeMs || cst.mtimeMs,
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
              ok: true,
              path: display,
              root: dirName,
              entries,
              truncated: names.length > MAX_LIST,
            });
          }

          if (url === `${prefix}/mkdir` && req.method === 'POST') {
            const body = JSON.parse((await readBody(req)).toString('utf8') || '{}');
            const folderName = String(body.name || '').trim();
            if (
              !folderName ||
              /[\\/]/.test(folderName) ||
              folderName === '.' ||
              folderName === '..'
            ) {
              return sendJson(res, 400, { error: '无效文件夹名' });
            }
            const parent = String(body.parent || '.');
            const { abs: parentAbs, display: parentDisplay } = resolveUnderRoot(absRoot, parent);
            if (!fs.existsSync(parentAbs) || !fs.statSync(parentAbs).isDirectory()) {
              return sendJson(res, 404, { error: '父目录不存在', path: parentDisplay });
            }
            const target = path.join(parentAbs, folderName);
            const { display } = resolveUnderRoot(
              absRoot,
              parentDisplay === '.' ? folderName : `${parentDisplay}/${folderName}`,
            );
            fs.mkdirSync(target, { recursive: true });
            return sendJson(res, 200, { ok: true, path: display });
          }

          if (url === `${prefix}/upload` && req.method === 'POST') {
            const body = JSON.parse((await readBody(req)).toString('utf8') || '{}');
            const fileName = String(body.name || '').trim();
            const parent = String(body.parent || '.');
            const contentBase64 = String(body.contentBase64 || '');
            if (!fileName || /[\\/]/.test(fileName) || fileName.includes('..')) {
              return sendJson(res, 400, { error: '无效文件名' });
            }
            const ext = extOf(fileName);
            if (!ALLOWED_EXT.has(ext)) {
              return sendJson(res, 400, {
                error: `不支持的类型 ${ext || '(无扩展名)'}，允许：${[...ALLOWED_EXT].join(' ')}`,
              });
            }
            if (!contentBase64) return sendJson(res, 400, { error: '缺少文件内容' });
            let buf;
            try {
              buf = Buffer.from(contentBase64, 'base64');
            } catch {
              return sendJson(res, 400, { error: '内容不是合法 base64' });
            }
            if (buf.length > MAX_UPLOAD) {
              return sendJson(res, 413, { error: `文件过大（>${MAX_UPLOAD} bytes）` });
            }
            const { abs: parentAbs, display: parentDisplay } = resolveUnderRoot(absRoot, parent);
            if (!fs.existsSync(parentAbs) || !fs.statSync(parentAbs).isDirectory()) {
              return sendJson(res, 404, { error: '父目录不存在', path: parentDisplay });
            }
            const rel =
              parentDisplay === '.' ? fileName : `${parentDisplay.replace(/\/$/, '')}/${fileName}`;
            const { abs, display } = resolveUnderRoot(absRoot, rel);
            fs.writeFileSync(abs, buf);
            return sendJson(res, 200, { ok: true, path: display, size: buf.length });
          }

          if (url === `${prefix}/write-text` && req.method === 'POST') {
            const body = JSON.parse((await readBody(req)).toString('utf8') || '{}');
            const rel = String(body.path || '').trim();
            if (!rel || rel === '.') return sendJson(res, 400, { error: '缺少 path' });
            const content = String(body.content ?? '');
            const bytes = Buffer.byteLength(content, 'utf8');
            if (bytes > MAX_UPLOAD) {
              return sendJson(res, 413, { error: `内容过大（>${MAX_UPLOAD} bytes）` });
            }
            const { abs, display } = resolveUnderRoot(absRoot, rel);
            fs.mkdirSync(path.dirname(abs), { recursive: true });
            fs.writeFileSync(abs, content, 'utf8');
            return sendJson(res, 200, { ok: true, path: display, size: bytes });
          }

          if (url === `${prefix}/write-binary` && req.method === 'POST') {
            const body = JSON.parse((await readBody(req)).toString('utf8') || '{}');
            const rel = String(body.path || '').trim();
            if (!rel || rel === '.') return sendJson(res, 400, { error: '缺少 path' });
            const contentBase64 = String(body.contentBase64 || '');
            let buf;
            try {
              buf = Buffer.from(contentBase64, 'base64');
            } catch {
              return sendJson(res, 400, { error: '内容不是合法 base64' });
            }
            if (buf.length > MAX_UPLOAD) {
              return sendJson(res, 413, { error: `内容过大（>${MAX_UPLOAD} bytes）` });
            }
            const { abs, display } = resolveUnderRoot(absRoot, rel);
            fs.mkdirSync(path.dirname(abs), { recursive: true });
            fs.writeFileSync(abs, buf);
            return sendJson(res, 200, { ok: true, path: display, size: buf.length });
          }

          if (url === `${prefix}/read` && req.method === 'POST') {
            const body = JSON.parse((await readBody(req)).toString('utf8') || '{}');
            const { abs, display } = resolveUnderRoot(absRoot, body.path);
            if (!fs.existsSync(abs))
              return sendJson(res, 404, { error: 'not found', path: display });
            const st = fs.statSync(abs);
            if (!st.isFile()) return sendJson(res, 400, { error: 'not a file', path: display });
            if (st.size > MAX_READ) {
              return sendJson(res, 413, { error: `文件过大（>${MAX_READ} bytes）`, size: st.size });
            }
            const buf = fs.readFileSync(abs);
            const ext = extOf(path.basename(abs));
            const textExt = new Set(['.md', '.txt', '.csv']);
            if (textExt.has(ext)) {
              return sendJson(res, 200, {
                ok: true,
                path: display,
                size: st.size,
                encoding: 'utf-8',
                content: buf.toString('utf8'),
              });
            }
            return sendJson(res, 200, {
              ok: true,
              path: display,
              size: st.size,
              encoding: 'base64',
              contentBase64: buf.toString('base64'),
            });
          }

          if (url === `${prefix}/delete` && req.method === 'POST') {
            const body = JSON.parse((await readBody(req)).toString('utf8') || '{}');
            const { abs, display } = resolveUnderRoot(absRoot, body.path);
            if (display === '.') return sendJson(res, 400, { error: '不能删除根目录' });
            if (dirName === 'prompts' && PROTECTED_PROMPT_FILES.has(path.basename(display))) {
              return sendJson(res, 403, { error: '系统提示词不可删除', path: display });
            }
            if (!fs.existsSync(abs))
              return sendJson(res, 404, { error: 'not found', path: display });
            const st = fs.statSync(abs);
            if (st.isDirectory()) {
              const children = fs.readdirSync(abs).filter((n) => n !== '.gitkeep');
              if (children.length) {
                return sendJson(res, 400, { error: '文件夹非空，请先删除内部文件', path: display });
              }
              fs.rmSync(abs, { recursive: true, force: true });
            } else {
              fs.unlinkSync(abs);
            }
            return sendJson(res, 200, { ok: true, path: display });
          }

          if (url === `${prefix}/open` && req.method === 'POST') {
            const body = JSON.parse((await readBody(req)).toString('utf8') || '{}');
            const { abs, display } = resolveUnderRoot(absRoot, body.path);
            if (!fs.existsSync(abs))
              return sendJson(res, 404, { error: 'not found', path: display });
            const st = fs.statSync(abs);
            if (!st.isFile()) return sendJson(res, 400, { error: '只能打开文件', path: display });
            try {
              await openLocalPath(abs);
              return sendJson(res, 200, { ok: true, path: display });
            } catch (e) {
              return sendJson(res, 500, {
                error: e instanceof Error ? e.message : String(e),
                path: display,
              });
            }
          }

          if (url === `${prefix}/tree` && req.method === 'GET') {
            ensureRoot(absRoot);
            function walk(dirAbs, rel) {
              const names = fs.readdirSync(dirAbs);
              const dirs = [];
              for (const n of names) {
                if (n === '.gitkeep') continue;
                const childAbs = path.join(dirAbs, n);
                let st;
                try {
                  st = fs.statSync(childAbs);
                } catch {
                  continue;
                }
                if (!st.isDirectory()) continue;
                const childRel = rel === '.' ? n : `${rel}/${n}`;
                dirs.push({
                  name: n,
                  path: childRel,
                  children: walk(childAbs, childRel),
                });
              }
              dirs.sort((a, b) => a.name.localeCompare(b.name, 'zh'));
              return dirs;
            }
            return sendJson(res, 200, {
              ok: true,
              root: dirName,
              tree: walk(absRoot, '.'),
            });
          }

          return sendJson(res, 404, { error: 'not found' });
        } catch (e) {
          const status = e && typeof e === 'object' && 'status' in e ? Number(e.status) : 500;
          return sendJson(res, status || 500, {
            error: e instanceof Error ? e.message : String(e),
          });
        }
      });
    },
  };
}

export function localRequirementsPlugin() {
  return createDocsPlugin({
    prefix: '/__local_requirements',
    dirName: 'requirements',
    legacyDirNames: ['需求文档库', '需求'],
    name: 'local-requirements',
  });
}

export function localCasesPlugin() {
  return createDocsPlugin({
    prefix: '/__local_cases',
    dirName: 'cases',
    legacyDirNames: ['用例管理', '用例'],
    name: 'local-cases',
  });
}

export function localTemplatesPlugin() {
  return createDocsPlugin({
    prefix: '/__local_templates',
    dirName: 'templates',
    legacyDirNames: ['测试模板库', '模板'],
    name: 'local-templates',
  });
}

const CHAT_SYSTEM_PROMPT_FILE = '系统提示词.md';
/** prompts 下禁止删除的文件（含旧名，防止误删） */
const PROTECTED_PROMPT_FILES = new Set([CHAT_SYSTEM_PROMPT_FILE, 'AI工作台系统提示词.md']);

const DEFAULT_CHAT_SYSTEM_PROMPT =
  '你是一名资深测试工程师，擅长测试设计、用例编写、缺陷分析与质量风险评估。' +
  '回答务实、结构化：先给结论，再给可执行的步骤或模板；涉及用例时使用规范的字段格式。\n';

/** 已废弃的「默认用例提示词」文件名，启动时清理，避免与插件所选提示词混淆 */
const LEGACY_CASE_DEFAULT_NAMES = ['默认提示词.md', '默认用例生成.md', '用例生成默认提示词.md'];

function migratePromptFile(absRoot, fromNames, toName) {
  const dest = path.join(absRoot, toName);
  if (fs.existsSync(dest)) {
    for (const n of fromNames) {
      const p = path.join(absRoot, n);
      if (fs.existsSync(p) && p !== dest) {
        try {
          fs.unlinkSync(p);
        } catch {
          // ignore
        }
      }
    }
    return dest;
  }
  for (const n of fromNames) {
    const p = path.join(absRoot, n);
    if (fs.existsSync(p)) {
      try {
        fs.renameSync(p, dest);
        return dest;
      } catch {
        // ignore
      }
    }
  }
  return dest;
}

const KNOWLEDGE_CATEGORIES = ['测试规范', '方法论', '环境约定'];

export function localKnowledgePlugin() {
  return createDocsPlugin({
    prefix: '/__local_knowledge',
    dirName: 'knowledge',
    legacyDirNames: ['知识库管理', '知识库'],
    name: 'local-knowledge',
    onReady(absRoot) {
      for (const cat of KNOWLEDGE_CATEGORIES) {
        fs.mkdirSync(path.join(absRoot, cat), { recursive: true });
      }
    },
  });
}

export function localPromptsPlugin() {
  return createDocsPlugin({
    prefix: '/__local_prompts',
    dirName: 'prompts',
    legacyDirNames: ['提示词管理', '提示词'],
    name: 'local-prompts',
    onReady(absRoot) {
      // 不再种子「默认提示词」：用例生成须在插件面板中显式选择提示词
      for (const n of LEGACY_CASE_DEFAULT_NAMES) {
        const p = path.join(absRoot, n);
        if (fs.existsSync(p)) {
          try {
            fs.unlinkSync(p);
          } catch {
            // ignore
          }
        }
      }
      const chatSeed = migratePromptFile(
        absRoot,
        ['AI工作台系统提示词.md'],
        CHAT_SYSTEM_PROMPT_FILE,
      );
      if (!fs.existsSync(chatSeed)) {
        fs.writeFileSync(chatSeed, DEFAULT_CHAT_SYSTEM_PROMPT, 'utf8');
      }
      // 清理旧版种子目录：prompts/功能测试/
      const legacyDir = path.join(absRoot, '功能测试');
      if (fs.existsSync(legacyDir) && fs.statSync(legacyDir).isDirectory()) {
        try {
          const names = fs.readdirSync(legacyDir).filter((n) => n !== '.DS_Store');
          if (
            names.length === 0 ||
            (names.length === 1 && LEGACY_CASE_DEFAULT_NAMES.includes(names[0]))
          ) {
            fs.rmSync(legacyDir, { recursive: true, force: true });
          }
        } catch {
          // ignore
        }
      }
    },
  });
}
