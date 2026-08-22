# 模块划分与数据流

## 分层（依赖只能向下）

```
UI (src/app 页面)
  → API 路由 (src/app/api/*)        唯一的请求入口，薄壳
    → agent 编排 (src/lib/agent/)   对话循环：检索→组prompt→流式→写暂存
      → memory 层 (src/lib/memory/) 仓库 / 检索 / 整理
        → db 层 (src/lib/db/)       node:sqlite 单例 + 迁移
    → providers (src/lib/providers/) AI 调用唯一出口
```

禁止跨层：API 路由不直接碰 SQL；memory 层不 import 任何具体厂商 SDK；UI 不直接调 lib。

## 核心数据流

1. **对话**：POST /api/chat → orchestrator 按意图检索记忆（词法 FTS5 + 时近 + 重要性 + 沿边扩散 + 矛盾专项检索）→ 组装上下文包 → Provider 流式回复 → 客户端渲染。
2. **写回**：会话结束后 POST /api/consolidate 用 `extractor` 角色从对话抽取候选记忆（主张/决定/情绪/纠结），先入 staging，确认后入库并生成关联边与标签。
3. **引导**：首次运行检测无 profile → /onboarding 页面内填写「关于我」，不要求用户手工改任何文件。

## 关键文件

- src/lib/db/client.ts — 连接单例、WAL、迁移入口
- src/lib/memory/schema.sql — 全部表结构（单一事实来源）
- src/lib/providers/registry.ts — 角色(thinker/extractor/embedder)→provider+model 解析
- src/lib/agent/system-prompt.ts — 思考伙伴人格提示词（改动需谨慎，见 conventions.md）
- data/mine-brain.db — 运行时数据库（gitignore）

## 数据库选型说明

用 Node 22 内置 `node:sqlite`（DatabaseSync），不用 better-sqlite3 等原生模块——Windows 零编译依赖。
FTS5 trigram tokenizer 支持中文子串检索。embedding 向量存 BLOB（当前 provider 无 embeddings 接口，
向量检索是预留能力，主检索靠词法+时近+重要性+图边）。
