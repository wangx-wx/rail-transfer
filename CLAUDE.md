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

## 工具链：Vite + TypeScript + vitest

**约束**：不在系统层面安装东西（`brew install` 等）；项目内的 npm 依赖正常使用。

- **前端**：Vite 构建，TypeScript（strict），产物进 `dist/`。
- **Worker**：TypeScript，wrangler 自带 esbuild 打包。
- **测试**：vitest，分两组 project（见 `vitest.config.ts`）：
  - `worker/**` 跑在**真实 workerd 运行时**（`@cloudflare/vitest-pool-workers`），
    能测到 `getSetCookie()`、Cache API、isolate 复用等 Workers 专有行为。
  - `web/**` 跑 Node 环境（纯函数 + 读 `test/fixtures/`）。
- **类型共享**：`shared/` 放类型与常量，两边都能 import。

常用命令：
```bash
npm install                 # 首次
npm test                    # 跑全部测试（vitest）
npm run typecheck           # tsc --noEmit
npm run dev                 # Vite 开发服务器（/api 代理到 :8787）
npm run build               # 构建前端到 dist/
node tools/gen-stations.mjs # 重新生成城市站表（纯静态，零网络）
node tools/dev-server.mjs   # 零依赖本地服务器（备选，进程内调 Worker）
```

## 开发规范

**测试**：新写的代码要配套测试用例——`web/` 的页面脚本、`worker/` 的代理脚本都算。提交前必须跑通 `npm test` 与 `npm run typecheck`。

**提交**：每次改动完成任务、测试通过后**先提交代码**。格式 `type(scope): desc`，type 取
`feat` / `fix` / `docs` / `style` / `refactor` / `test` / `chore` / `perf`。

**合规**：定位个人低频查询。不做自动下单、验证码识别、多账号、批量抓取、绕过风控。实测 50 次连续查询未见速率限制，但低频原则仍保留（依据是产品定位，非实测封禁）。

**建设阶段**：项目会大改，不要过度设计，不要为假想需求加抽象。
