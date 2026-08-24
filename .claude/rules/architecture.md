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

## 前端 feature 目录边界

- `src/app/<route>/page.tsx` 只做路由级容器：组合 feature 组件与 hooks、持有页面级少量状态（如消息正文、开关偏好）。聊天页 `page.tsx` 就此收敛为编排层。
- feature 专属展示组件、共享类型、客户端 hooks 放 `src/components/<feature>/` 与 `src/components/<feature>/hooks/`。
- 客户端 hooks 必须经 API 路由取数，不得 import `lib/` 下的 repo/db/provider（依赖只能向下）。
- 一个 hook 一个状态域：会话 / 流式连接 / 输入编辑 / 滚动各自独立，页面负责组合与事件编排；禁止再造一个「万能 useChatPage」。
- 状态所有权在抽离后必须保持单一：流式与会话的状态域谁拥有谁负责更新，跨域的收尾回调（如 done→拉候选）经 Ref 注入汇合于页面层。
- 聊天页仍是「深度思考=同一管道的展示面」：这些组件与 hooks 是纯展示/状态壳，不产生第二条数据流。

## 核心数据流

1. **对话**：POST /api/chat → orchestrator 检索记忆（标签命中 + 生活域 + 时近 + 重要性 + 矛盾沿边专项 + 开放回路专项）→ 组装上下文包 → Provider 流式回复 → 客户端渲染。（可选）用户开「联网」时，组 prompt 前先经 `searcher` 拉外部资料注入上下文包，失败静默跳过。
2. **写回**：会话结束后 POST /api/consolidate 用 `extractor` 角色从对话抽取候选记忆（主张/决定/情绪/纠结），先入 staging，确认后入库并生成关联边与标签。
3. **引导**：首次运行检测无 profile → /onboarding 页面内填写「关于我」，不要求用户手工改任何文件。

## 深度思考（同一管道，不是另一条管道)

深度思考不是独立的 AI 调用链：它只是 `runChat` 同一条 async-generator 管道上的按请求布尔量 `deepThinking`——角色、Provider 流、写回路径完全相同，只放大上下文预算并补时间线。普通模式**不**构造时间线（`buildContextBundle` 返回 `timeline: undefined`），这是隔离的唯一体现，不是两套代码。

- 资源上限：张力 `tensionLimit` 深度 8 / 普通 5；开放回路 `openLoopLimit` 深度 5 / 普通 3。
- 时间线：仅深度模式构造。只收 `type ∈ {claim, decision, insight}` 且 `status ∈ {active, superseded}` 的记忆，按生活域/标签命中过滤，按时间排序、最新立场在最后，`MAX_TIMELINE_SPANS = 6` 跨度采样保最新；排除 `archived` 与软删。被推翻的旧立场保留在时间线里（历史演进而非抹去）。
- 前端身份：每条消息带 `deepThinking` 标记，思考与检索区文案按它区分；UI 开关经 `localStorage` 记住偏好。
- 上述契约由 tests/retrieve.test.ts「buildContextBundle — 深度思考模式」固化为回归测试，改动必须同步该组测试。

## 关键文件

- src/lib/db/client.ts — 连接单例、WAL、迁移入口
- src/lib/memory/schema.sql — 全部表结构（单一事实来源）
- src/lib/providers/registry.ts — 角色(thinker/extractor/embedder/searcher)→provider+model 解析
- src/lib/providers/web-search.ts — 联网搜索能力（WebSearchProvider / Exa 适配器 / gatherWebMaterial）
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

联网搜索（可选，未配置即整体隐藏）：
- 聊天页「联网」开关（localStorage 记住偏好）→ /api/chat 带 `webSearch` → orchestrator 组 prompt 前调 `gatherWebMaterial`。
- 消息含链接→读正文（/contents，单条最多 6000 字）；否则以原话为查询调用 search，结果带发布时间。
- 注入 system prompt 的【外部资料】块并 emits `type:"web"` 事件供前端标注来源；检索/正文抓取失败只降级不报错。
- 铁律：外部资料是「世界的说法」不是用户记忆——prompt 要求引用带来源与时间；consolidate 的 extractor 提示词明确禁止把外部观点提取为用户的记忆。
