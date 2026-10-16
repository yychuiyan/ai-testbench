# TestBench

面向测试工程师的AI个人工作台：AI 对话、功能测试用例生成、模板库、知识库。

仓库：[yychuiyan/ai-testbench](https://github.com/yychuiyan/ai-testbench) · npm：[ai-testbench](https://www.npmjs.com/package/ai-testbench) · [变更日志](./CHANGELOG.md)

## 功能

| 模块       | 说明                                                                                        |
| ---------- | ------------------------------------------------------------------------------------------- |
| AI 工作台  | 资深测试工程师角色预设的多轮对话，流式输出，BYOK（自带密钥）直连模型；可按插件挂载工具      |
| 用例生成   | 输入需求描述（可勾选知识库文档作为上下文），输出结构化用例表格，导出 Excel / CSV / Markdown |
| 测试模板库 | 功能/接口/性能的用例与报告模板，磁盘 `测试模板库/`，自动渲染上架                            |
| 知识库管理 | 测试规范 / 方法论 / 环境约定，磁盘 `知识库管理/`；列表管理、创建与 AI 生成；对话「@」可引用 |
| 插件库     | 内置能力开关；对话「/」引用知识库/模板；管理页可生成能力建议                                |

模型配置（BYOK）、内容目录约定、插件用法见 **[操作手册](./docs/操作手册.md)**。

## 快速开始

两种用法任选其一。装好后都在侧栏「模型设置」配置 BYOK；默认打开 `http://127.0.0.1:4321/`。

### 方式一：本地服务（推荐）

1、 安装：

```bash
npx ai-testbench
```

执行后会安装全局短命令 `tbench`。

2、 初始化数据空间（首次必做；可再次执行以更换数据空间）：

```bash
tbench init
```

按序号选择数据空间：

```text
选择数据目录（其下直接放置「公共空间」与其它空间；知识库 / 用例 / 提示词 / 记忆等写入其中）：
  1) 打开系统文件夹选择器
  2) 当前目录（当前终端所在位置）
  3) 自定义路径（手输）
请输入 1 / 2 / 3（默认 1）：
```

3、 常用命令：

```bash
tbench init           # 选择并记住数据空间
tbench web            # 启动本地 Web 服务
tbench stop           # 停止服务
tbench restart        # 重启服务
tbench status         # 运行状态、端口、数据空间
tbench open           # 在浏览器中打开工作台
tbench path           # 显示当前数据空间路径
tbench config         # 显示配置文件地址
tbench logs           # 查看服务日志
tbench doctor         # 检查运行环境与配置是否正常
tbench help           # 显示操作命令列表
tbench version        # 显示当前版本号
tbench list           # 显示可安装的版本列表
tbench install        # 安装/更新到最新版本
tbench install 0.1.x  # 安装/更新到指定版本
tbench uninstall      # 卸载本机 tbench 命令（保留数据空间）
tbench wipe           # 删除当前数据空间（需确认；不可恢复）
tbench space list     # 列出全部数据空间与当前项
tbench space add      # 新建数据空间（--use 顺带设为当前）
tbench space use      # 切换当前数据空间
tbench ask            # 无界面单轮问答，tbench ask <提示词>
tbench rpc            # 以 stdio JSON-RPC 暴露本地问答能力
tbench acp            # 以 ACP 子集供外部编排驱动无 UI Agent
```

### 方式二：源码启动

适合改代码或二次开发。

1、 克隆仓库到本地：

```bash
git clone https://github.com/yychuiyan/ai-testbench.git
cd ai-testbench
```

2、 开发模式（热更新，含本地落盘 API）：

```bash
pnpm install
pnpm dev
```

3、 预览静态页（需先打包；无本地落盘）：

```bash
pnpm build
pnpm preview
```

## 许可证

[MIT](./LICENSE)
