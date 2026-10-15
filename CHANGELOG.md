# 版本日志

### 本地一键部署

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

## [0.1.1] - 2026-10-15

工作台体验与稳定性小版本。

### 变更

- 空会话居中欢迎（标语「让测试更高效」）；无消息时隐藏标题与「对话 / 回合 / 记忆」Tab
- 「回合」Tab：「从此处继续」截断到该轮并自动续写；页面边距与对话区对齐
- 输入区随屏宽适配（最大约 1024px），默认高度与自动长高上限加大；左右边距加大
- 生成类抽屉：类型/分类删除改为行内二次确认
- 思考模式多轮回传 `reasoning_content`，避免工具续轮 HTTP 400
- 插件规格 / 操作手册同步更新；npm 补充中英文 keywords

## [0.1.0] - 2026-10-14

测试工程师的专属 AI 工作台，支持本地一键部署。

### 新增

#### 分发与部署

- npm 一体服务：`npx ai-testbench` / 全局命令 `ai-testbench`（`-y` / `--dir` / `--pick` 选择数据目录）
- 源码开发：`npm run dev`（含本地落盘 API，固定 `127.0.0.1:4321`）、`npm start`、静态 `preview`
- CLI：`ask`（可 `--tools`）、`rpc`（stdio JSON-RPC）、`acp`（轻量 ACP 子集）
- GitHub Pages 静态部署（`withastro/action`）
- 操作手册：`docs/操作手册.md`；规格：`docs/会话插件.md`、`docs/全局插件.md`

#### 我的工作台

- BYOK 直连 OpenAI 兼容接口（DeepSeek / 通义千问 / OpenAI / 自定义）；Key 仅存本机
- 流式对话；思索 UI：`思考中…` / `正在分析请求` / `思考完成`（时间线展开时标题不再重复摘要）
- 对话时间线：思考 / 工具步骤折叠展示；会话统计（模型用时、工具用时、TTFT、TPS）
- 用量展示；模型与 reasoning effort；LLM 自动重试（429/5xx/网络，最多 3 次）
- 访问权限：仅可查看 / 工作区内修改 / 完全权限
- 附件：添加文件（多格式含 Excel / Word）；粘贴图片；粘贴本地文件/路径 → 路径引用或附件卡片
- 斜杠与引用：`/` 插件、`@` 引用知识库 / 模板 / 工作区文档；输入栏「+」添加面板
- 多会话侧栏：置顶、重命名、归档、软删除、导出会话 JSON；空会话（无消息）切换时丢弃；LLM 短标题
- 多工作区：侧栏文件夹树；输入栏切换 / 添加本地文件夹
- 服务端会话回合 `/__tb_sessions/runs`：刷新/切页可重连；手动停止展示「已停止」
- DeepSeek DSML 工具调用解析加固，避免标签泄漏
- 「回合」Tab：轮次大纲
- 会话搜索（含 sqlite 同步查询）
- 「在会话中打开」（用例 / 提示词 / 知识库）：新建会话并挂路径卡片（不预填正文）

#### 内容库（磁盘英文目录 + 界面中文）

- 用例管理（`cases/`）：根与子目录文件平铺列表；双击打开、批量删除、「在会话中打开」
- 知识库（`knowledge/`）、提示词管理（`prompts/`）
- 需求文档库（`requirements/`）：存放需求，供生成用例引用对照
- 测试模板库（`templates/`）：测试方案 / 用例 / 报告等模板复用

#### 插件与本地能力

- 我的插件：会话默认 / 全局默认 / 扩展（可开关）；网页搜索为会话默认（`web_search` / `web_fetch`）
- 扩展：生成测试用例、生成提示词、生成知识库、知识库检索、会话记忆
- 本地工具：`fs_*`、`fs_glob` / `fs_grep`、bash / pwsh（含 session 与 jobs）、`present`、office→pdf（有 LibreOffice 时）
- 注入：`agent-instructions`（AGENTS.md / CLAUDE.md）、`time-context`
- 交互：`todo_write`、`ask_user_question`、`plan-mode` / `submit_plan`
- 目标 / 定时 / 子代理 / workflow；软沙箱；spill 超大结果落盘；skill 加载
- 工作区变更追踪、依赖探测、子代理模型可选

#### 会话记忆

- 存储：`.local/memories/`（USER / MEMORY / KEY / project / daily + SUGGESTIONS）
- 工作台「记忆」Tab：指南、待确认记忆建议（角标）、项目日志、项目关键记忆 KEY.md、长期记忆 MEMORY.md、全局规则（文件卡片本地打开）、归档、设置
- 重要写入经待确认采纳后注入；项目日志可直写不注入

#### 工程与质量

- ESLint（`src`）+ Prettier；`simple-git-hooks` + `lint-staged`
- 轻量自测：`npm test`
- 开发服忽略打开内容库目录与 `.local/**` 导致的整页热更新

[0.1.1]: https://www.npmjs.com/package/ai-testbench/v/0.1.1
[0.1.0]: https://www.npmjs.com/package/ai-testbench/v/0.1.0
