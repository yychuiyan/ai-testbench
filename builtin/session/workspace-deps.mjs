/**
 * workspace-dependencies：探测本机常用运行时/包管理器绝对路径。
 */
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const TOOLS = [
  { id: 'node', names: ['node'] },
  { id: 'npm', names: ['npm'] },
  { id: 'npx', names: ['npx'] },
  { id: 'pnpm', names: ['pnpm'] },
  { id: 'yarn', names: ['yarn'] },
  { id: 'python', names: process.platform === 'win32' ? ['python', 'py'] : ['python3', 'python'] },
  { id: 'pip', names: process.platform === 'win32' ? ['pip', 'pip3'] : ['pip3', 'pip'] },
];

async function resolveOnPath(bin) {
  try {
    if (process.platform === 'win32') {
      const { stdout } = await execFileAsync('where', [bin], {
        timeout: 5_000,
        maxBuffer: 256 * 1024,
      });
      const line = String(stdout || '')
        .split(/\r?\n/)
        .map((l) => l.trim())
        .find(Boolean);
      return line || null;
    }
    const { stdout } = await execFileAsync('which', [bin], {
      timeout: 5_000,
      maxBuffer: 256 * 1024,
    });
    const p = String(stdout || '').trim();
    return p || null;
  } catch {
    return null;
  }
}

/**
 * @returns {Promise<Array<{ id: string, path: string | null, available: boolean }>>}
 */
export async function loadWorkspaceDependencies() {
  const out = [];
  for (const tool of TOOLS) {
    let found = null;
    for (const name of tool.names) {
      found = await resolveOnPath(name);
      if (found && fs.existsSync(found)) break;
      found = null;
    }
    out.push({
      id: tool.id,
      path: found,
      available: Boolean(found),
    });
  }
  return out;
}
