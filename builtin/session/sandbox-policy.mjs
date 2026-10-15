/**
 * 软沙箱策略（非 OS 隔离）：
 * - 命令黑名单（明显危险串）
 * - 精简子进程 env
 * - access !== full 时由调用方强制工作区 cwd
 */

const KEEP_ENV = new Set([
  'PATH',
  'HOME',
  'USER',
  'LOGNAME',
  'SHELL',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'TERM',
  'TMPDIR',
  'TMP',
  'TEMP',
  'TZ',
  'COLORTERM',
  'SSH_AUTH_SOCK',
]);

const SECRET_ENV_RE =
  /^(API_?KEY|.*_API_KEY|.*SECRET.*|.*TOKEN.*|.*PASSWORD.*|.*PASSWD.*|AWS_|AZURE_|GOOGLE_APPLICATION_|OPENAI_|ANTHROPIC_|DEEPSEEK_)/i;

/** @type {Array<{ re: RegExp, reason: string }>} */
const DENY_PATTERNS = [
  { re: /\brm\s+(-[a-zA-Z]*f[a-zA-Z]*\s+|--force\s+)*\/\s*$/m, reason: 'refuses rm targeting /' },
  {
    re: /\brm\s+(-[a-zA-Z]*r[a-zA-Z]*f[a-zA-Z]*|-[a-zA-Z]*f[a-zA-Z]*r[a-zA-Z]*)\s+\/(\s|$)/,
    reason: 'refuses rm -rf /',
  },
  { re: /\bmkfs(\.\w+)?\b/, reason: 'refuses mkfs' },
  { re: /\bdd\b[^|\n]*\bof\s*=\s*\/dev\//, reason: 'refuses dd to /dev' },
  { re: />\s*\/etc\//, reason: 'refuses write redirect to /etc' },
  { re: /\bcurl\b[^|\n]*\|\s*(ba)?sh\b/, reason: 'refuses curl|sh' },
  { re: /\bwget\b[^|\n]*\|\s*(ba)?sh\b/, reason: 'refuses wget|sh' },
  { re: /\bchmod\s+(-R\s+)?777\s+\//, reason: 'refuses chmod 777 /' },
  { re: /\b:\(\)\s*\{\s*:\|:&\s*\}\s*;/, reason: 'refuses fork bomb' },
  { re: /\bshutdown\b|\breboot\b|\bpoweroff\b|\bhalt\b/, reason: 'refuses power control' },
  { re: /\bdiskutil\s+(erase|partition)/i, reason: 'refuses diskutil destructive ops' },
];

/**
 * @param {{ access?: string, workspace?: string }} opts
 */
export function resolveSandboxPolicy(opts = {}) {
  const access =
    opts.access === 'full' || opts.access === 'readwrite' || opts.access === 'readonly'
      ? opts.access
      : 'readonly';
  const workspaceRoot = String(opts.workspace || '').trim() || process.cwd();
  return {
    mode: access === 'full' ? 'danger-full-access' : 'workspace-confined',
    access,
    workspaceRoot,
    enforceWorkspaceCwd: access !== 'full',
    scrubEnv: true,
  };
}

/**
 * @param {string} command
 * @param {{ access?: string } | null} [_policy]
 * @returns {{ ok: true } | { ok: false, error: string }}
 */
export function assertCommandAllowed(command, _policy = null) {
  const cmd = String(command ?? '');
  if (!cmd.trim()) return { ok: false, error: 'command is required' };
  for (const { re, reason } of DENY_PATTERNS) {
    if (re.test(cmd)) {
      return {
        ok: false,
        error: `sandbox-policy blocked: ${reason}（软沙箱，非 OS 隔离）`,
      };
    }
  }
  return { ok: true };
}

/**
 * @param {{ scrubEnv?: boolean } | null} [policy]
 * @param {NodeJS.ProcessEnv} [base]
 */
export function buildChildEnv(policy = null, base = process.env) {
  const scrub = policy?.scrubEnv !== false;
  /** @type {Record<string, string>} */
  const out = {};
  if (!scrub) {
    for (const [k, v] of Object.entries(base)) {
      if (typeof v === 'string') out[k] = v;
    }
    out.TERM = out.TERM || 'dumb';
    return out;
  }
  for (const [k, v] of Object.entries(base)) {
    if (typeof v !== 'string') continue;
    if (KEEP_ENV.has(k) || k.startsWith('LC_')) {
      out[k] = v;
      continue;
    }
    if (SECRET_ENV_RE.test(k)) continue;
  }
  out.TERM = out.TERM || 'dumb';
  if (!out.PATH && typeof base.PATH === 'string') out.PATH = base.PATH;
  if (!out.HOME && typeof base.HOME === 'string') out.HOME = base.HOME;
  return out;
}

/** 供单测列举 */
export function listDenyPatternReasons() {
  return DENY_PATTERNS.map((p) => p.reason);
}
