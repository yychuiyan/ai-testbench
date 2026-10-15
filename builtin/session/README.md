# 会话内置 Runner

对应插件页「会话插件」里已落地的本机能力（默认开启、无扩展开关）。

| 文件 | 会话能力 | HTTP 前缀 |
| --- | --- | --- |
| `tb-fs.mjs` | `tool-fs` / `tool-working-directory` / `tool-fs-search` / `tool-skill` / `agent-instructions` / `present`（open）等 | `/__tb_fs` |
| `skill-fs.mjs` | `tool-skill` / `skill`（SKILL.md 发现与加载） | （被 tb-fs 调用） |
| `fs-observation-policy.mjs` | `fs-observation-policy`（跳过目录 / 读写与搜索上限） | （被 tb-fs 调用；health.observation） |
| `workspace-deps.mjs` | `workspace-dependencies` | `/__tb_fs/workspace-dependencies` |
| `office-to-pdf.mjs` | `office-to-pdf`（LibreOffice；否则 .extracted.md） | `/__tb_fs/office-to-pdf` |
| `tb-bash.mjs` | `tool-bash` / `tool-pwsh` / `tool-jobs` / 持久会话 | `/__tb_bash` · `/__tb_pwsh` · `*/session/*` |
| `sandbox-policy.mjs` | 软沙箱策略（黑名单 + 精简 env） | （被 tb-bash 调用） |
| `bash-session.mjs` | 持久 bash（node-pty 优先 / 管道回退） | （被 tb-bash 调用） |
| `pwsh-session.mjs` | 持久 pwsh（同上） | （被 tb-bash 调用） |
| `tb-web.mjs` | `tool-web` | `/__tb_web` |
| `session-runs.mjs` | 服务端会话回合（续跑 / 停止） | `/__tb_sessions/runs` |
| `tb-schedule.mjs` | 主机级 `schedule` / 会话 `tool-schedule` 落盘与 tick | `/__tb_schedule` |
| `tb-spill.mjs` | `spill-local` 过大内容落盘 | `/__tb_spill` |

产品扩展与文档库中间件仍在仓库根目录 `tb-plugins/`（如 `tb-memory`、`tb-kb`、`tb-config`、`tb-project-docs`）。
