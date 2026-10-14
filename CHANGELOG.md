# 版本日志

这里留一个提issue的入口

### 本地安装与使用

需已安装 [Node.js](https://nodejs.org/)（建议 20+）。任选其一：

```bash
# 免安装，直接启动（首次会拉取包）
npx ai-testbench

# 或全局安装后再启动
npm i -g ai-testbench
ai-testbench -y          # 数据目录用当前目录
# ai-testbench --dir ~/qa  # 或指定目录
```

浏览器打开终端提示的地址（默认 `http://127.0.0.1:4321/`），在侧栏「设置」里配置模型（BYOK）即可。更完整的说明见 [操作手册](./docs/操作手册.md) 。

## [0.1.0] - 2026-10-14

### 新增

- 初版发布：AI 工作台、用例 / 知识库 / 提示词管理、插件库
- npm 一体服务：`npx ai-testbench` / 全局命令 `ai-testbench`（可选数据目录）
- GitHub Pages 静态部署；磁盘英文文档根（`knowledge/` 等）+ 界面中文
- 操作手册：`docs/操作手册.md`

[0.1.0]: https://www.npmjs.com/package/ai-testbench/v/0.1.0
