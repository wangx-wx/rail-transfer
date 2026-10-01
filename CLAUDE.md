# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 我想做什么

做一个 12306 选票工具：查票、比中转方案、帮我做决策。

核心机会点：官方中转只给「换乘一次的部分列车」（候选枢纽被截断为 Top-N），本工具靠**强制枚举候选枢纽**把被过滤掉的方案补回来。

最终交付：GitHub Pages 前端 + 代理层（本地 Node → 后续可换 Cloudflare Workers）。

现状：设计阶段，还没有产品代码。详细结论查 `docs/`。

## 开发规范

**提交**：每次改动完成任务、通过测试用例后先提交。格式 `type(scope): desc`，type 取
`feat` / `fix` / `docs` / `style` / `refactor` / `test` / `chore` / `perf`。

**验证**：改动要有可执行的验证手段，验证通过再提交。`spike/` 下是调研取证用的一次性脚本（会真实请求 12306），不是测试套件。

**依赖**：零第三方依赖，Node 24 内置 `fetch` 足够（本机 `npm install` 会 EPERM）。

**合规**：定位个人低频查询。不做自动下单、验证码识别、多账号、批量抓取、绕过风控。

**建设阶段**：项目会大改，不要过度设计，不要为假想需求加抽象。
