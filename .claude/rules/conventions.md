# 代码 / 数据 / Provider 约定

## TypeScript 与代码风格

- strict 模式，`pnpm build` 通过 = 类型检查通过；改完必跑。包管理用 pnpm（锁文件 pnpm-lock.yaml），Node ≥22（本机 n 切换，CI/Docker 固定 Node 24）。
- 不引入重型依赖（无 langchain、无重状态库）。新依赖需有明确理由且积极维护。
- 组件放 `src/app/<页面>/` 或 `src/components/`；服务端逻辑一律进 `src/lib/`。
- API 路由只做：参数校验 → 调 lib → 返回 JSON/SSE。业务逻辑不写在 route 里。
- 路由层绝不出现裸 SQL：`getDb().prepare` 只允许出现在 db / repo 层。会话改名、删除等一律经 `renameSession` / `deleteSession` 等 repo 函数；删除会话前先查 `isSessionStreaming`，后台流写入中返回 409，避免僵尸写指向已删除的会话。
- JSX 无障碍开关：折叠/按压态必须写显式字符串 `aria-expanded={cond ? "true" : "false"}` / `aria-pressed={cond ? "true" : "false"}`——React 会丢弃布尔值 `false` 的 `aria-*` 属性，折叠态将沦为无属性可读。
- 图标按钮必须有 `aria-label` 或等价可读文本；可点击区域用 `<button>` 而非裸 `<div onClick>`，保证键盘可达。

## React 组件与页面拆分

- 页面组件是容器，负责组合 feature 组件/hooks 与少量路由级状态；一个控制器（如 `page.tsx`）不应同时背负 JSX、SSE、滚动、输入、会话四套状态。
- 展示组件不得直接 fetch / 访问 lib / 操作路由；数据与动作全部经 props 显式传入，回调返回「发生了什么」而不是整包 setState。
- 跨组件共享的客户端状态抽到 feature hooks（`src/components/<feature>/hooks/`），单一组件独占的状态留在组件内，不做预支抽象。
- hook 对外返回「状态与动作方法」，不暴露可变 Ref 让调用方直改——react-hooks v6 的 `immutability`/`refs` 规则禁止渲染期读写 `ref.current`、禁止修改 hook 返回值的成员（例：`scroll.userScrolledUpRef.current = false` 会被拒，应调用 hook 内部的 `resetScroll()`）。
- 回调经调用方持有的 Ref 注入并在事件时读取（异步发生，不受初始化顺序影响）；Ref 写入只在 effect 或事件里，绝不在渲染期。
- 桌面端与移动端展示差异要共享数据模型、事件处理与列表项组件，避免两套业务逻辑。
- 何时继续拆的信号：某区域有了自己的状态 / 需要独立测试 / 在别处复用 / props 接口膨胀。不为凑行数机械切文件。
- 抽离组件或 hook 后，行为契约由离线单测或 Playwright DOM 断言保留（改动必须同步对应验证）。

## 记忆数据铁律（领域规则，违反=bug）

- 所有记忆实体带 `created_at` 与适用的 `valid_from`；时间永远显式，不做隐式「最新覆盖旧」。
- 信念/主张改变主意：旧行置 `status='superseded'`，新建行，两行间建 `contradicts` 边。永不 UPDATE 覆盖内容语义。
- 原始文本（entries）是不可变的地面真值，整理产物（claims/insights）必须能溯源到 entry id。
- 删除只做软删（`deleted_at`），导出/备份必须包含全部历史。

## AI Provider 铁律

- 业务代码里**禁止出现**模型名、base_url、api key 字面量；只能通过角色名（thinker/extractor/embedder…）调 `resolveProvider(role)`。
- Provider 接口：`chat(messages, opts)` 必须支持流式；`embed?()` 是独立能力（对话用的 opencode zen 无 embeddings 端点，需经 embedder 角色指向百炼/Ollama 等）。调用方一律先查 `embedderReady()`，不 ready 或失败即降级到词法检索，绝不允许因此报错。
- 向量铁律：向量只对当前 `(model, dims)` 有效（跨模型=噪音）；换模型/维度必须重嵌。存储用 `memory_embeddings` 表的 model/dims 元数据对账，查询时只匹配当前模型。
- 联网搜索是独立能力（非 OpenAI 协议，无 model 概念）：经 `searcherReady()` / `resolveSearcher()` 解析。key 只认 searcher 角色覆盖或 `MINE_BRAIN_SEARCH_API_KEY` env，**绝不回退全局对话 key**（跨厂商混用必失败）；未配置时聊天页整体隐藏开关，搜索/抓正文失败只降级不报错。
- 当前模型 x-preview-f-free 是推理模型：思考在 `message.reasoning_content`，正文在 `message.content`；max_tokens 给足（≥2000），否则 content 为空。
- key 只存于 `.env.local`（gitignore）或运行时 DB settings 表，绝不入库 git。

## 配置与密钥

- `.env.local` 本地真实密钥（已 ignore）；`.env.example` 只放占位符（提交）。
- 用户可在设置页改 provider 配置（存 DB settings 表），env 只是首次默认值。
