# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目定位

12306 中转换乘查询工具，目标：**比官方网页给出更多中转方案**。

立项依据：12306 官方帮助页自述只查询「换乘**一次**的**部分**列车余票」，根因是候选枢纽在服务端被截断为 Top-N（官方专利 `CN114912659A`，实施例 n=10）。本项目通过**强制枚举候选枢纽**（`queryG` 的 `middle_station` 参数）把被截断的方案补回来。实测兰州→杭州：官方默认 9 条，额外枚举 8 个枢纽后多出 29 条。

**当前状态：设计完成，尚未开工。** 仓库内只有设计与调研资料，没有可运行的产品代码。

## 交付形态

- 前端：GitHub Pages 静态页
- 代理：本地 Node（阶段一，零合规风险）→ Cloudflare Workers（阶段二，需外网访问时启用）

纯 GitHub Pages 不可行：12306 接口无 CORS 头、OPTIONS 预检 302、不支持 JSONP，必须有服务端代理层。

## 常用命令

无构建系统、无 `package.json`、**零第三方依赖**（Node 24 内置 `fetch` 足够；本机 `~/.npm` 有 root 属主文件，`npm install` 会 EPERM）。

```bash
# 接口复核脚本（直接运行，无需安装）
node spike/recheck/t.mjs    # 城市代表站展开行为
node spike/recheck/t2.mjs   # 无关/反向枢纽与目的地站过滤
node spike/recheck/t3.mjs   # 同城多站展开
node spike/recheck/t4.mjs   # 非城市名站码是否触发城市展开
node spike/recheck/t5.mjs   # 小站/辖属站过滤
node spike/recheck/t6.mjs   # 跨 OD 的枢纽组展开

# 自研中转算法验证（Python，用 curl 调 mobile.12306.cn）
python3 spike/transfer-proof3.py
```

`spike/` 下脚本是**调研取证用的一次性脚本**，会真实请求 12306，不是测试套件。改动它们前先确认目的。

## 架构（规划中，见 `docs/设计方案.md` 第七节）

核心约束：**「取数层」与「代理层」必须分离**，使阶段一（本地 Node）→ 阶段二（Workers）不改取数逻辑。

```
server.mjs            本地 HTTP 服务（Node 内置模块）
src/
  stations.mjs        3404 站表：中文/拼音/电报码检索 + 城市→车站映射
  source-kyfw.mjs     余票通道（动态路径）+ 官方中转通道（主路径 + 备选容错）
  source-mobile.mjs   车次表 / 经停站 / 换乘预留时间
  presale.mjs         预售期校验与日期规范化（坑①）
  transfer.mjs        枢纽枚举 + 分页 + 合并去重 + 自研打分
  fallback.mjs        自研中转算法（官方接口异常时降级）
  hubs.mjs            候选枢纽清单（可配置）
  watch.mjs           余票轮询 + 提醒（限流/退避/去重）
public/index.html     原生 HTML/CSS/JS
```

算法骨架（路线 B：官方 Top-N 复用 + 强制枢纽枚举）：

```
Step 0  预售期校验（D ∈ [今天, 今天+14]）
Step 1  1 次空 middle_station 的 queryG → 官方默认方案 + 候选站种子
Step 2  对候选枢纽逐个调 queryG，用 result_index / can_query 分页取完
Step 3  合并去重
Step 4  硬约束过滤：最小换乘时间 + 无回头路线
Step 5  自研打分排序（官方 score 是黑盒，不直接采用）
```

## 必须知道的坑

1. **日期越界伪装成"查询超时"**：超出预售期时返回 `302 → error.html`，页面只显示"查询超时"，与网络故障无法区分。工具必须前置校验日期，越界时明确提示"该日期尚未开售"，绝不能当成网络错误。过去日期同样不报错（返回"没有查询到中转方案"），也要客户端拦截。
2. **接口路径是动态的，不要硬编码**：余票路径从 `/otn/leftTicket/init` 里的 `var CLeftTicketUrl` 读取（可靠）；中转路径**不能**从 `/otn/lcQuery/init` 读（该页需登录，302 → login.html），以 `/lcquery/queryG` 为主 + 备选路径列表 + 识别 `errorMsg:"url error"` 后自动切换。
3. **一个 `queryG` 只覆盖一个枢纽**；`result_index` 分页有陷阱；跨天/隔日达是最容易算错的地方。
4. 接口全部是内部接口，无文档、随时变更。字段要防御性解析；语义未确证的字段**不要臆测**（见调研报告 §6 E12）。

## 合规边界（硬约束）

定位为**个人低频查询**。请求量约 31 次/查询（15 枢纽 × 2 页），须串行 + 300~800ms 间隔 + 缓存。
**不做**：自动下单、验证码识别、多账号、批量抓取、绕过风控。

## 文档地图

| 文档 | 用途 |
|---|---|
| `docs/设计方案.md` | 主设计文档（v3），只写决策 |
| `docs/部署与架构决策.md` | 部署选型 + 算法复核结论 + Workers 免费额度实测 |
| `docs/research/12306中转算法调研报告.md` | 853 行一手调研，**细节查这里**（200+ 次实测、5 篇专利、4 个项目源码分析） |
| `docs/research/*.json` | 217 条实测响应样本 |

**改设计结论前先读调研报告对应章节**，不要凭记忆或推测。

## 提交规范

每次改动完成任务、通过验证后再提交。格式：

```
type(scope): desc
```

type 取值：`feat`（新功能）、`fix`（修补 bug）、`docs`（文档）、`style`（格式，不影响运行）、`refactor`（重构）、`test`（测试）、`chore`（构建/工具）、`perf`（性能优化）。

## 已知取舍

- 不采用全站暴力穷举（3404 站）、离线时刻表自建图（193MB）、全路 OD 预计算（需离线集群，且它正是"方案不全"的根因）。
- 不需要 Playwright/CDP（v2 的浏览器方案已证明不必要）。
- 官方只支持换乘一次；是否自研 2 次换乘待定（见设计方案第十节待决策项）。
