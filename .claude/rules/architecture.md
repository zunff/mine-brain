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

检索为**五信号融合**：标签命中 + 生活域 + 时近 + 重要性 + 向量余弦，再沿 contradicts/supersedes 边专项拉张力。
向量只对**当前 `(model, dims)`** 生效——跨模型/维度是另一套空间，比余弦=噪音（切换须重嵌）。

向量实现（已启用）：
- 默认接阿里云百炼 `qwen3.7-text-embedding`（OpenAI 兼容 `/embeddings`，1024 维，免费额度内零成本）。
- 存储：`memory_embeddings(memory_id PK, model, dims, vector BLOB)`；索引 `idx_emb_model`。
- 写入时机：会话后整理（`embedNewMemories`）与手动「重新向量化」（`/api/reindex`）。
- 查询：`computeVectorBoostMap` 把消息向量化再与全库余弦，作为第 5 信号加进 `buildContextBundle`。
- 降级与熔断：`embedderReady()`（需 model+key）为闸门；接口失败冷却 5 分钟；失败不影响词法检索。

关键文件：src/lib/memory/vector.ts（cosine/vectorBoost）、memory_embeddings 表、/api/reindex、settings 页向量卡片。
