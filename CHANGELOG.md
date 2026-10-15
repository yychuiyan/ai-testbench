# 版本日志

问题与建议 [去反馈](https://docs.yychuiyan.com/friends/apply/)

### 本地安装与使用

要求本地已安装 [Node.js](https://nodejs.org/)（建议 20+）。任选其一：

```bash
# 免安装，直接启动（首次会拉取包）
npx ai-testbench

# 或全局安装后再启动
npm i -g ai-testbench
ai-testbench -y          # 数据目录用当前目录
# ai-testbench --dir ~/qa  # 或指定目录
```

浏览器打开终端提示的地址（默认 `http://127.0.0.1:4321/`），在侧栏「设置」里配置模型（BYOK）即可。更完整的说明见 [操作手册](https://github.com/yychuiyan/ai-testbench/blob/main/docs/操作手册.md) 。

## [0.1.0] - 2026-10-14

初版发布：面向测试工程师的纯静态个人工作台（Astro + React + Tailwind），支持本地一体服务与 GitHub Pages 演示。

### 新增

#### 分发与部署

- npm 一体服务：`npx ai-testbench` / 全局命令 `ai-testbench`（`-y` / `--dir` / `--pick` 选择数据目录）
- 源码开发：`npm run dev`（含本地落盘 API）、`npm start`、静态 `preview`
- GitHub Pages 静态部署（`withastro/action`）
- 操作手册：`docs/操作手册.md`

#### 我的工作台

- BYOK 直连 OpenAI 兼容接口（DeepSeek / 通义千问 / OpenAI / 自定义）；Key 仅存本机 localStorage
- 流式对话、思考过程摘要、用量展示；模型与 reasoning effort 选择
- 访问权限：仅可查看 / 工作区内修改 / 完全权限；本地文件工具 `fs_*`
- 附件：合并「添加文件」（多格式、体积上限，含 Excel / Word 解析）；粘贴图片
- 斜杠与引用：`/` 调用插件能力，`@` 引用知识库 / 模板等文档
- 多会话侧栏：置顶、重命名、归档、软删除与恢复；空会话可自动清理
- 多工作区（dsh 风格）：侧栏文件夹树挂会话；输入栏工作区下拉切换 / 添加本地文件夹；项目根工作区不可删除；无归属会话归入项目根展示
- DeepSeek DSML 工具调用解析加固（含双竖线形态），避免原始标签泄漏到界面

#### 内容库（磁盘英文目录 + 界面中文）

- 用例管理（`cases/`）：列表、结构化表格、导出 Excel / CSV / Markdown
- 知识库（`knowledge/`）：规范 / 方法论 / 环境约定；列表管理与创建
- 提示词管理（`prompts/`）
- 测试模板库（`templates/`）：功能 / 接口 / 性能用例与报告；`.md` 预览，`.xlsx` / `.docx` 上架下载
- 需求文档库（`requirements/`）

#### 插件库

- 内置能力开关（状态存本机）：生成测试用例、生成提示词、生成知识库、知识库检索、会话记忆（扩展插件）
- 我的插件三分类：会话默认（24）/ 全局默认（111）/ 扩展（可开关）；未落地项标「规划中」
- 网页搜索已升格为会话默认（对齐 dsh `tool-web`）：`web_search` / `web_fetch`（经 `/__tb_web`，需一体服务）
- 会话默认注入类能力：`agent-instructions`（加载 AGENTS.md/CLAUDE.md）、`time-context`（时钟节流注入）、`present`（交付文件卡片 + `/__tb_fs/open`）
- 会话 `tool-fs-search`：`fs_glob` / `fs_grep`（`/__tb_fs/glob|grep`，优先本机 ripgrep）
- 会话交互：`todo_write`（会话待办清单）/ `ask_user_question`（结构化提问并等待回答）
- 会话内置 Runner 迁至 `builtin/session/`（`tb-fs` / `tb-web`）；`tb-plugins/` 仅保留扩展与基建
- 会话 `tool-bash`：同步执行（`/__tb_bash`）；`background` + `tool-jobs`（list/output/kill）
- 会话 `tool-pwsh`：`/__tb_pwsh`，与 bash 共用 jobs（需本机安装 PowerShell）
- 会话 `plan-mode`：探查门闩 + `submit_plan`；入口在输入栏「添加」菜单
- 插件页双列卡片：顶对齐，避免展开一张时邻卡被撑高「假打开」
- 恢复思索 UI：`思考中…` / `思考完成`（不再用灰底「已完成，用时」摘要条）
- 会话 `tool-result-pruner`：过长工具返回头尾保留，写入 tools loop 前裁剪
- 会话 `compaction-basic` / `command-compact`：自动阈值压缩 + `/compact`
- 会话 `tool-goal` / `command-goal`：目标工具 + `/goal` 命令
- 会话 `tool-schedule`：定时提醒 create/list/update/cancel；页面打开时投递回原会话
- 会话 `tool-subagent*`：`spawn_subagent` / `fork_subagent` / `list_agents` / await·abort（进程内同模型）
- 会话 `tool-workflow` / `workflow-ptc`：`workflow` 编排脚本 + 浏览器引擎（agent/parallel/pipeline）
- 软沙箱 `sandbox-policy`：bash/pwsh 命令黑名单 + 精简 env（非 OS 隔离）
- 持久 bash：`bash_session_*`（`node-pty` optional，失败则管道 marker 回退）
- 全局插件目录：把已有会话/存储/LLM/网页等映射标为已就绪或部分就绪
- 规格文档：`docs/会话插件.md`、`docs/全局插件.md`
- 对话时间线：思考 / 工具步骤（搜索、获取、本地文件等）折叠展示
- 插件管理页：按诉求推荐扩展能力（结果缓存本机）
- 会话记忆：五轨 md（user / memory / key + project / daily）、待确认队列；`.local/memories/`（本地服务）

#### 工程与质量

- ESLint（`src`）+ Prettier；`simple-git-hooks` + `lint-staged` 提交前检查
- 轻量自测：`npm test`（含 DSML 解析等）

[0.1.0]: https://www.npmjs.com/package/ai-testbench/v/0.1.0
