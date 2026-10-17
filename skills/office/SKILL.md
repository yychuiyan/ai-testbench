# Office 工作流（Lantern Harness）

在本工作台处理 Word / Excel 时遵循以下约定（对齐 skill-office 子集）。

## 输入（人类附件）

- 聊天输入栏「添加文件」可解析：`.xlsx` / `.xls` → 表格文本摘要；`.docx` → 纯文本（mammoth）。
- 单文件体积上限见客户端 `FILE_MAX_BYTES`；过大请拆分或只附关键 sheet。
- 知识库 / 模板库中的 Office 文件可用 `@` 引用；Markdown 全文、Excel/Word 多为构建期摘要。

## 输出与交付

- 生成用例等结构化表：优先写工作区 `.md` / `.csv`，需要 Excel 时用产品导出或 `xlsx` 管线。
- 向用户交付已写好的工作区文件时，调用 `present`（勿只在正文报路径）；单次最多 4 个文件。
- 不要声称已生成 PPT/复杂版式 Word，除非工具链明确支持；本环境无 `office-to-pdf` 转换。

## 推荐步骤

1. 读清用户要的格式（md / csv / xlsx）与字段表头。
2. 用 `fs_*` 写入工作区；大结果可依赖 spill，勿把整表贴进对话。
3. `present` 声明交付物；需要人工打开时由 UI「本地打开」。

## 边界

- 无独立 Office COM/自动化；不做 PPT 编排。
- 不安装 Cordis `dsh-skill-office`；本文件供 `skill_load` 按需拉入上下文。
