# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 我想做什么

做一个 12306 选票工具：查票、比中转方案、帮我做决策。

核心机会点：官方中转只给「换乘一次的部分列车」（候选枢纽被截断为 Top-N），本工具靠**强制枚举候选枢纽**把被过滤掉的方案补回来。

最终交付：GitHub Pages 前端 + Cloudflare Workers 代理层。

## 现状：v1 骨架已建成

前端（`web/`）、代理层（`worker/`）、共享层（`shared/`）已实现，端到端跑通（北京→上海得到 30+ 条中转方案）。详见 `spec/技术方案.md`。

**产品范围以 `spec/产品方案.md` 为准**，技术实现以 `spec/技术方案.md` 为准（决策清单均带 ID 与状态，可追加可推翻）。两份文档同构：产品方案的决策用 `D-` 前缀，技术方案用 `T` 前缀。

`docs/`、`spike/` 是前序探索资料（被 .gitignore 忽略，仅存本地），部分结论已过时——见 `spec/产品方案.md` 第六节。

## 根本约束：零依赖、零构建、零环境变量

**不得在本机安装任何应用或依赖**（用户明确要求）。因此：

- 前端与 Worker 用**原生 ESM**（`.js` + JSDoc 类型注解），无打包、无 `tsc`。
- 测试用 Node 内置 `node:test`，`package.json` **无 dependencies**。
- 本地开发用自建 `tools/dev-server.mjs`（静态托管 + 进程内调用 `worker/index.js`），**不需要 wrangler**。
- 取数层（`worker/source.js`）环境无关，Node 与 Workers 共用同一份代码。

常用命令（无安装步骤）：
```bash
node --test                 # 跑全部测试
node tools/dev-server.mjs   # 本地开发服务器（默认 8765）
node tools/gen-stations.mjs # 重新生成城市站表（纯静态，零网络）
```

## 开发规范

**测试**：新写的代码要配套测试用例——`web/` 的页面脚本、`worker/` 的代理脚本都算。提交前必须跑通 `node --test`。

**提交**：每次改动完成任务、测试通过后**先提交代码**。格式 `type(scope): desc`，type 取
`feat` / `fix` / `docs` / `style` / `refactor` / `test` / `chore` / `perf`。

**合规**：定位个人低频查询。不做自动下单、验证码识别、多账号、批量抓取、绕过风控。实测 50 次连续查询未见速率限制，但低频原则仍保留（依据是产品定位，非实测封禁）。

**建设阶段**：项目会大改，不要过度设计，不要为假想需求加抽象。
