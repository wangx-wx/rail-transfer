# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 我想做什么

做一个 12306 选票工具：查票、比中转方案、帮我做决策。

核心机会点：官方中转只给「换乘一次的部分列车」（候选枢纽被截断为 Top-N），本工具靠**强制枚举候选枢纽**把被过滤掉的方案补回来。

最终交付：GitHub Pages 前端 + Cloudflare Workers 代理层。

## 现状：空项目

**还没有产品代码。** 仓库现有的 `docs/`、`spike/` 是开工前的**前置探索**资料，不是产品的一部分，不必为它们补测试。

开工时从零建工程，不要被现有目录结构约束。

## 开发规范

**测试**：新写的代码要配套测试用例——GitHub Pages 的页面脚本、Cloudflare Workers 的代理脚本都算。提交前必须跑通测试。

**提交**：每次改动完成任务、测试通过后**先提交代码**。格式 `type(scope): desc`，type 取
`feat` / `fix` / `docs` / `style` / `refactor` / `test` / `chore` / `perf`。

**合规**：定位个人低频查询。不做自动下单、验证码识别、多账号、批量抓取、绕过风控。

**建设阶段**：项目会大改，不要过度设计，不要为假想需求加抽象。
