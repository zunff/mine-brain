# mine-brain

个人生活向「第二大脑 / 思考伙伴」——记住用户的价值观、人生阶段、反复纠结与重要决定，
在对话中主动对照过去、指出矛盾与盲点，而不是迎合。**不是技术知识库，不是普通笔记工具，不是 RAG 文档机器人。**

技术栈：Next.js App Router + React + TypeScript + Tailwind · 包管理 pnpm（Node ≥22，本机用 n 切换版本）· 数据库 Node 内置 `node:sqlite`（SQLite，含 FTS5，可选用）· 检索为五信号融合（标签/生活域/时近/重要性/向量余弦）· AI 调用全部经 Provider 抽象（OpenAI 兼容协议）。

## 常用命令

```bash
pnpm dev        # 开发服务器 http://localhost:3000
pnpm build      # 生产构建（改动后必跑，作为类型检查）
pnpm lint       # ESLint
pnpm test       # vitest 单测
```

UI 改动必须用 playwright-cli 打开页面截图验证后再报告完成（见 .claude/rules/workflow.md）。

## 规则路由（按需读取）

| 主题 | 文件 |
| --- | --- |
| 产品定位与设计红线 | .claude/rules/project.md |
| 模块划分与数据流 | .claude/rules/architecture.md |
| 代码 / 数据 / Provider 约定 | .claude/rules/conventions.md |
| 开发-验证-提交流程 | .claude/rules/workflow.md |

## 目录速览

- `src/app/` 页面与 API 路由（chat / memories / settings / onboarding）
- `src/lib/db/` SQLite 连接与迁移
- `src/lib/providers/` AI Provider 抽象（业务代码禁止直接 import 具体厂商）
- `src/lib/memory/` 记忆仓库、检索、整理
- `src/lib/agent/` 思考伙伴人格提示词与对话编排
- `data/` 运行时数据库与导出（已 gitignore，绝不提交）
