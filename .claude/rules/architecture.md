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

1. **对话**：POST /api/chat → orchestrator 检索记忆（标签命中 + 生活域 + 时近 + 重要性 + 矛盾沿边专项 + 开放回路专项）→ 组装上下文包 → Provider 流式回复 → 客户端渲染。
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

当前检索**不使用向量、不使用 FTS5**，靠「写入时 LLM 打的关键词标签 + 生活域 + 时近 + 重要性」打分，
加上矛盾沿 contradicts/supersedes 边专项检索。这是刻意决策：个人规模下标签信号比弱向量更干净可靠。

向量是预留能力，分两种情况（都未启用）：
- SQLite BLOB 可存 `Float32Array` 向量（往返无损已验证），几千条内纯 JS/SQL 暴力余弦毫秒级。
- 真正的 kNN/索引需加载 `sqlite-vec` 扩展或侧挂 LanceDB（Win 上装原生扩展会回到编译坑，故不默认启用）。
启用条件：设置页给 embedder 角色配上模型，`resolveEmbedder()` 返回 provider 后检索自动叠加向量通道。
