# TestBench

面向测试工程师的AI个人工作台：AI 对话、功能测试用例生成、模板库、知识库。

仓库：[yychuiyan/ai-testbench](https://github.com/yychuiyan/ai-testbench) · npm：[ai-testbench](https://www.npmjs.com/package/ai-testbench) · [变更日志](./CHANGELOG.md)

## 功能

| 模块       | 说明                                                                                        |
| ---------- | ------------------------------------------------------------------------------------------- |
| AI 工作台  | 资深测试工程师角色预设的多轮对话，流式输出，BYOK 直连模型；可按插件挂载工具                 |
| 用例生成   | 输入需求描述（可勾选知识库文档作为上下文），输出结构化用例表格，导出 Excel / CSV / Markdown |
| 测试模板库 | 功能/接口/性能的用例与报告模板，磁盘 `templates/`，自动渲染上架                             |
| 知识库管理 | 测试规范 / 方法论 / 环境约定，磁盘 `knowledge/`；列表管理、创建与 AI 生成；对话「@」可引用  |
| 插件库     | 内置能力开关；对话「/」引用知识库/模板；管理页可生成能力建议                                |

模型配置（BYOK）、内容目录约定、插件用法见 **[操作手册](./docs/操作手册.md)**。

## 快速开始

两种用法任选其一。装好后都在侧栏「模型设置」配置 BYOK；默认打开 `http://127.0.0.1:4321/`。

### 方式一：npm 一体服务

适合日常使用：安装包后直接起本地服务，读写知识库 / 用例 / 提示词 / 记忆。数据默认落在**当前目录**，启动时可改。

1、 安装：

```bash
npx ai-testbench
# 或全局安装
npm i -g ai-testbench
```

2、 启动（全局安装后）：

```bash
ai-testbench              # 交互选择数据目录
ai-testbench -y           # 直接用当前目录
ai-testbench --dir ~/qa   # 指定数据目录
ai-testbench --pick       # 系统文件夹选择器
```

3、 按终端提示打开浏览器即可使用。

### 方式二：源码启动

适合改代码或二次开发。先克隆本仓库，再安装依赖。

1、开发模式（热更新，含本地落盘 API）：

```bash
npm install
npm run dev
```

2、 或先构建再起一体服务（与方式一体验接近，数据目录为当前仓库根）：

```bash
npm install
npm run build
npm start
```

3、 仅预览静态页（无本地落盘）：

```bash
npm run preview
```

## 许可证

[MIT](./LICENSE)
