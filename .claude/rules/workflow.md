# 开发 - 验证 - 提交流程

## 改动后验证顺序

1. `npm run build` —— 类型检查 + 构建必须零错误。
2. `npm run lint` —— 无新增 error。
3. UI 改动：起 dev server（后台），用 playwright-cli 截图验证：

```bash
playwright-cli open http://localhost:3000
playwright-cli screenshot            # 截当前页
playwright-cli snapshot              # 取可交互元素引用
playwright-cli click <ref>           # 点按元素后复查
playwright-cli close                 # 结束会话
```

截图要覆盖：正常路径 + 至少一个边界态（空数据 / 未配置 provider 的提示态）。
没看截图就宣布 UI 完成 = 未完成。

## 提交规范

- 阶段性小步提交；一个逻辑单元一个 commit。
- message 用中文一句话说清「为什么」，格式：`<类型>: <内容>`，如 `feat: 会话后整理流水线`。
- 提交前 `git status` 复查，确认没有 data/、.env.local、node_modules 混入。

## 绝不提交

data/（用户记忆数据库）、.env.local（真实密钥）、.next/、node_modules/、playwright 截图产物。

## 已知坑

- Windows 下 cp 大量小文件慢，挪 node_modules 用 mv 不要 cp。
- opencode zen 无 /embeddings 端点，调用会返回 HTML 而不是 JSON——embed 缺失是常态路径，必须优雅降级。
