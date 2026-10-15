/**
 * storage-domain：列举本机数据目录下已知存储域（.local 子集）。
 */
import fs from 'node:fs';
import path from 'node:path';

/** @type {Array<{ id: string, rel: string, kind: 'file' | 'dir', roleZh: string }>} */
export const KNOWN_STORAGE_DOMAINS = [
  { id: 'sessions', rel: '.local/sessions.json', kind: 'file', roleZh: '会话真相源' },
  { id: 'sessions-jsonl', rel: '.local/sessions.jsonl', kind: 'file', roleZh: '会话 JSONL 审计' },
  { id: 'checkpoints', rel: '.local/checkpoints', kind: 'dir', roleZh: '会话检查点' },
  { id: 'session-log', rel: '.local/session-log', kind: 'dir', roleZh: 'DeepSeek 形态回合日志' },
  { id: 'schedules', rel: '.local/schedules.json', kind: 'file', roleZh: '主机定时提醒' },
  { id: 'spill', rel: '.local/spill', kind: 'dir', roleZh: '工具结果溢出' },
  { id: 'memories', rel: '.local/memories', kind: 'dir', roleZh: '会话记忆' },
  { id: 'workspaces', rel: '.local/workspaces.json', kind: 'file', roleZh: '工作区注册表' },
  { id: 'app-config', rel: '.local/app.config.json', kind: 'file', roleZh: '本机应用配置' },
  { id: 'case-suites', rel: '.local/case-suites.json', kind: 'file', roleZh: '用例套件' },
  { id: 'case-sessions', rel: '.local/case-sessions.json', kind: 'file', roleZh: '用例会话' },
];

/**
 * @param {string} root
 */
export function listStorageDomains(root) {
  const base = path.resolve(root);
  return KNOWN_STORAGE_DOMAINS.map((d) => {
    const abs = path.join(base, d.rel);
    let exists = false;
    let bytes = 0;
    let mtime = null;
    try {
      if (fs.existsSync(abs)) {
        const st = fs.statSync(abs);
        exists = true;
        bytes = st.isFile() ? st.size : 0;
        if (st.isDirectory()) {
          try {
            bytes = fs.readdirSync(abs).length;
          } catch {
            bytes = 0;
          }
        }
        mtime = st.mtime.toISOString();
      }
    } catch {
      // ignore
    }
    return {
      id: d.id,
      path: d.rel,
      kind: d.kind,
      roleZh: d.roleZh,
      exists,
      /** 文件为字节；目录为条目数 */
      size: bytes,
      mtime,
    };
  });
}
