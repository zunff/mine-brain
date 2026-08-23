# 开发 - 验证 - 提交流程

## 改动后验证顺序

1. `pnpm build` —— 类型检查 + 构建必须零错误。
2. `pnpm test` —— 单元测试（vitest，tests/ 目录）必须全绿；改检索/整理/Provider 逻辑时必须同步补测试。
3. `pnpm lint` —— 无新增 error。
4. UI 改动：起 dev server（后台），用 playwright-cli 截图验证：

```bash
playwright-cli open http://localhost:3000
playwright-cli screenshot            # 截当前页
playwright-cli snapshot              # 取可交互元素引用
playwright-cli click <ref>           # 点按元素后复查
playwright-cli close                 # 结束会话
```

截图要覆盖：正常路径 + 至少一个边界态（空数据 / 未配置 provider 的提示态）。
没看截图就宣布 UI 完成 = 未完成。

## 测试编写原则（工具，不是任务）

只写「这里的回归会怎样坏」的测试。两条准入标准，满足其一才写：
1. **这段逻辑出过 bug**——现成案例：supersedes 语义守卫（观察类记忆曾误把价值陈述标记为已推翻）、导出泄漏 API Key、LLM 输出被围栏包裹。
2. **它的行为就是产品承诺**（契约）——例如：embedder 未配置必须返回 null 且调用方降级；空串角色覆盖回退全局；被推翻的 value 不再进宪章。

**明确不写**：getter 返回空、语言本身保证的行为、纯转发的胶水代码。为覆盖率而凑数 = 冗余。

**其他准则**：
- 测试要点是「编码为什么」——夹具要模拟真实形态（如沉睡 60 天的旧纠结、带代码围栏的 LLM 输出），断言失败要能读出产品语义，而不是堆断言。
- 发现设计含糊时，先改实现或写注释说清，再固化成测试；不要用测试去迁就一个含糊的现状。
- 数据库类测试用 `MINE_BRAIN_DATA_DIR` 隔离到临时目录，绝不碰真实 `data/`。
- **绝不调用真实 AI**：LLM 调用非确定性 + 需要网络/密钥 + 烧钱。单测必须离线、确定、零成本。AI 链路靠脚本级 E2E（playwright 走真实会话）验证。
- 改检索/整理/Provider 逻辑必须同步补对应测试；纯 UI 改动由 build + playwright 截图验证，不强制组件测试。

## 提交规范

- 阶段性小步提交；一个逻辑单元一个 commit。
- message 用中文一句话说清「为什么」，格式：`<类型>: <内容>`，如 `feat: 会话后整理流水线`。
- 提交前 `git status` 复查，确认没有 data/、.env.local、node_modules 混入。

## 绝不提交

data/（用户记忆数据库）、.env.local（真实密钥）、.next/、node_modules/、playwright 截图产物。

## 已知坑

- Windows 下 cp 大量小文件慢，挪 node_modules 用 mv 不要 cp。
- opencode zen 无 /embeddings 端点，调用会返回 HTML 而不是 JSON——embed 缺失是常态路径，必须优雅降级。
