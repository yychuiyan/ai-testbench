# 会话内置 Runner

对应插件页「会话插件」里已落地的本机能力（默认开启、无扩展开关）。

| 文件 | 会话能力 | HTTP 前缀 |
| --- | --- | --- |
| `tb-fs.mjs` | `tool-fs` / `tool-fs-search` / `agent-instructions` / `present`（open）等 | `/__tb_fs` |
| `tb-bash.mjs` | `tool-bash` / `tool-pwsh` / `tool-jobs` | `/__tb_bash` · `/__tb_pwsh` |
| `tb-web.mjs` | `tool-web` | `/__tb_web` |

产品扩展与文档库中间件仍在仓库根目录 `tb-plugins/`（如 `tb-memory`、`tb-kb`、`tb-config`、`tb-project-docs`）。
