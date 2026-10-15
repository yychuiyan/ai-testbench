/**
 * 项目内固定根目录文档库（仅 `astro dev`）：
 * - requirements/ → `/__tb_requirements`（界面：需求文档库）
 * - cases/        → `/__tb_cases`（界面：用例管理）
 * - templates/    → `/__tb_templates`（界面：测试模板库）
 * - prompts/      → `/__tb_prompts`（界面：提示词管理）
 * - knowledge/    → `/__tb_knowledge`（界面：知识库管理）
 * 支持 list / mkdir / rename / upload / read / delete（进系统废纸篓，非空目录拒绝）/ open；路径不得逃出根目录。
 */
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
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

/**
 * 把文件/目录移入系统废纸篓（可恢复），而不是直接抹除。
 * 失败时抛错，绝不静默退化为永久删除——避免误删无法找回。
 *
 * - darwin：交给 Finder，自动处理重名与外部卷的 .Trashes；
 *   路径经 argv 传入，不做字符串插值，任意文件名都安全。
 * - win32：Microsoft.VisualBasic 的 SendToRecycleBin。
 * - linux：按 freedesktop Trash 规范移动到 ~/.local/share/Trash。
 */
async function trashLocalPath(absPath) {
  if (process.platform === 'darwin') {
    await execFileAsync('osascript', [
      '-e',
      'on run argv',
      '-e',
      'tell application "Finder" to delete (POSIX file (item 1 of argv) as alias)',
      '-e',
      'end run',
      absPath,
    ]);
    return;
  }

  if (process.platform === 'win32') {
    const quoted = `'${absPath.replace(/'/g, "''")}'`;
    const script = [
      'Add-Type -AssemblyName Microsoft.VisualBasic;',
      `$p = ${quoted};`,
      'if (Test-Path -LiteralPath $p -PathType Container) {',
      '  [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory($p, "OnlyErrorDialogs", "SendToRecycleBin")',
      '} else {',
      '  [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile($p, "OnlyErrorDialogs", "SendToRecycleBin")',
      '}',
    ].join(' ');
    await execFileAsync('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], {
      windowsHide: true,
    });
    return;
  }

  // Linux / 其他：freedesktop Trash 规范（仅同卷有效，跨卷由 rename 抛 EXDEV）
  const dataHome = process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share');
  const filesDir = path.join(dataHome, 'Trash', 'files');
  const infoDir = path.join(dataHome, 'Trash', 'info');
  fs.mkdirSync(filesDir, { recursive: true });
  fs.mkdirSync(infoDir, { recursive: true });
  const base = path.basename(absPath);
  let dest = path.join(filesDir, base);
  for (let i = 1; fs.existsSync(dest); i++) dest = path.join(filesDir, `${base}.${i}`);
  fs.renameSync(absPath, dest);
  const stamp = new Date().toISOString().slice(0, 19).replace('T', ' ');
  fs.writeFileSync(
    path.join(infoDir, `${path.basename(dest)}.trashinfo`),
    `[Trash Info]\nPath=${encodeURIComponent(absPath)}\nDeletionDate=${stamp}\n`,
    'utf8',
  );
}

const MAX_UPLOAD = 12 * 1024 * 1024;
const MAX_READ = 4 * 1024 * 1024;
const MAX_LIST = 5000;

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

/** 列表 / 文件夹树 / 删除判定统一忽略的占位与系统文件（.DS_Store 由 macOS 自动生成） */
const IGNORED_ENTRIES = new Set(['.gitkeep', '.DS_Store']);
function isIgnoredEntry(name) {
  return IGNORED_ENTRIES.has(name);
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
export function migrateLegacyRoot(projectRoot, legacyNames, dirName) {
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
              if (isIgnoredEntry(n)) continue;
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
            if (dirName === '提示词管理' && PROTECTED_PROMPT_FILES.has(path.basename(display))) {
              return sendJson(res, 403, { error: '系统提示词不可删除', path: display });
            }
            if (!fs.existsSync(abs))
              return sendJson(res, 404, { error: 'not found', path: display });
            const st = fs.statSync(abs);
            if (st.isDirectory()) {
              // 非空目录一律拒绝：前端会先提示「还有 N 个文件」，由用户清空后再删
              const children = fs.readdirSync(abs).filter((n) => !isIgnoredEntry(n));
              if (children.length) {
                return sendJson(res, 400, {
                  error: '文件夹非空，请先清空内部内容',
                  path: display,
                  children: children.length,
                });
              }
            }
            // 移入系统废纸篓（可恢复），不做永久删除
            await trashLocalPath(abs);
            return sendJson(res, 200, { ok: true, path: display, trashed: true });
          }

          if (url === `${prefix}/rename` && req.method === 'POST') {
            const body = JSON.parse((await readBody(req)).toString('utf8') || '{}');
            const { abs, display } = resolveUnderRoot(absRoot, body.path);
            if (display === '.') return sendJson(res, 400, { error: '不能重命名根目录' });
            if (!fs.existsSync(abs))
              return sendJson(res, 404, { error: 'not found', path: display });
            const newName = String(body.name || '').trim();
            if (
              !newName ||
              /[\\/]/.test(newName) ||
              newName === '.' ||
              newName === '..' ||
              newName.includes('\0')
            ) {
              return sendJson(res, 400, { error: '无效名称' });
            }
            // 与删除保持一致：系统提示词为受保护文件，不允许改名
            if (dirName === '提示词管理' && PROTECTED_PROMPT_FILES.has(path.basename(display))) {
              return sendJson(res, 403, { error: '系统提示词不可重命名', path: display });
            }
            const st = fs.statSync(abs);
            // 文件改名须保持允许的扩展名，否则后续无法预览 / 再次上传
            if (st.isFile()) {
              const ext = extOf(newName);
              if (!ALLOWED_EXT.has(ext)) {
                return sendJson(res, 400, {
                  error: `不支持的类型 ${ext || '(无扩展名)'}，允许：${[...ALLOWED_EXT].join(' ')}`,
                });
              }
            }
            const slash = display.lastIndexOf('/');
            const parentDisplay = slash >= 0 ? display.slice(0, slash) : '.';
            const { abs: parentAbs } = resolveUnderRoot(absRoot, parentDisplay);
            const targetAbs = path.join(parentAbs, newName);
            if (targetAbs !== abs && fs.existsSync(targetAbs)) {
              return sendJson(res, 409, { error: `已存在同名项目「${newName}」`, path: display });
            }
            fs.renameSync(abs, targetAbs);
            const { display: newDisplay } = resolveUnderRoot(
              absRoot,
              parentDisplay === '.' ? newName : `${parentDisplay}/${newName}`,
            );
            return sendJson(res, 200, { ok: true, path: newDisplay, from: display });
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
            // 顺带算出每个目录递归的文件数：左侧文件夹树要显示「名称 (N)」，
            // 一次遍历算完，省掉前端逐目录请求。
            function walk(dirAbs, rel) {
              const names = fs.readdirSync(dirAbs);
              const dirs = [];
              let fileCount = 0;
              for (const n of names) {
                if (isIgnoredEntry(n)) continue; // 与 /list 保持同一口径
                const childAbs = path.join(dirAbs, n);
                let st;
                try {
                  st = fs.statSync(childAbs);
                } catch {
                  continue;
                }
                if (st.isDirectory()) {
                  const childRel = rel === '.' ? n : `${rel}/${n}`;
                  const sub = walk(childAbs, childRel);
                  fileCount += sub.fileCount;
                  dirs.push({
                    name: n,
                    path: childRel,
                    fileCount: sub.fileCount,
                    children: sub.children,
                  });
                } else {
                  fileCount += 1;
                }
              }
              dirs.sort((a, b) => a.name.localeCompare(b.name, 'zh'));
              return { children: dirs, fileCount };
            }
            const walked = walk(absRoot, '.');
            return sendJson(res, 200, {
              ok: true,
              root: dirName,
              tree: walked.children,
              // 根目录递归文件总数（含直接存放在根下的文件）
              totalFiles: walked.fileCount,
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

/**
 * 数据空间内容目录：中文目录名 ↔ 旧目录名。
 * 单一来源：插件挂载、`cli/server.mjs` 初始化、资源列表都读这里。
 */
export const DOC_ROOT_DIRS = {
  requirements: { dirName: '需求文档库', legacyDirNames: ['requirements', '需求'] },
  cases: { dirName: '用例管理', legacyDirNames: ['cases', '用例'] },
  templates: { dirName: '测试模板库', legacyDirNames: ['templates', '模板'] },
  prompts: { dirName: '提示词管理', legacyDirNames: ['prompts', '提示词'] },
  knowledge: { dirName: '知识库管理', legacyDirNames: ['knowledge', '知识库'] },
};

export function tbRequirementsPlugin() {
  return createDocsPlugin({
    prefix: '/__tb_requirements',
    ...DOC_ROOT_DIRS.requirements,
    name: 'tb-requirements',
  });
}

export function tbCasesPlugin() {
  return createDocsPlugin({
    prefix: '/__tb_cases',
    ...DOC_ROOT_DIRS.cases,
    name: 'tb-cases',
  });
}

export function tbTemplatesPlugin() {
  return createDocsPlugin({
    prefix: '/__tb_templates',
    ...DOC_ROOT_DIRS.templates,
    name: 'tb-templates',
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

export function tbKnowledgePlugin() {
  return createDocsPlugin({
    prefix: '/__tb_knowledge',
    ...DOC_ROOT_DIRS.knowledge,
    name: 'tb-knowledge',
    // 知识库为平铺存储：分类只写在 frontmatter 的 category，不再按分类建子目录
  });
}

export function tbPromptsPlugin() {
  return createDocsPlugin({
    prefix: '/__tb_prompts',
    ...DOC_ROOT_DIRS.prompts,
    name: 'tb-prompts',
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
      // 清理旧版种子目录：提示词管理/功能测试/
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
