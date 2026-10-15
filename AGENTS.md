# Agent / 贡献约定

## Git 提交

遵循 Conventional Commits（约定见本地 `.cursor/rules/`，该目录不入库）。

示例：`feat(nav): 主导航支持展开收起`

仅在用户明确要求时创建 commit；勿提交 `.local/`、密钥与本机文档库内容。

## 格式与检查

| 命令                | 作用                       |
| ------------------- | -------------------------- |
| `pnpm lint`         | ESLint（`src`）            |
| `pnpm typecheck`    | 类型检查（`tsc --noEmit`） |
| `pnpm test`         | 轻量自测（`node:test`）    |
| `pnpm format`       | Prettier 写回              |
| `pnpm format:check` | Prettier 检查              |

`pre-commit`（simple-git-hooks + lint-staged）会对暂存的 `src` 文件自动 Prettier，并对 `.ts/.tsx` 跑 ESLint。

**Node 类型**：`@types/node` 是 `tsc --noEmit` 能识别 `node:*` 与 `process` 的前提，属于必需依赖，勿移除。

**是否需要 ESLint / Prettier**：需要。本仓库已接入轻量配置，用于统一格式与基本质量门禁；规则可后续收紧。
