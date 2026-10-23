# 查询表单 / 状态条 / 页面骨架 / 主题 —— 渲染信息全量清单

> 用途：UI 改版验收清单。
> 依据：`web/App.tsx`、`web/components/QueryForm.tsx`、`web/components/StatusBar.tsx`、
> `web/components/AppTheme.tsx`、`web/styles.css`、`web/main.tsx`、`index.html`。

---

## 1. 页面骨架

### 1.1 index.html

| 项 | 值 |
|---|---|
| `html lang` | `zh-CN` |
| `<title>` | `12306 查票助手` |
| viewport | `width=device-width, initial-scale=1`（无 `maximum-scale`、无 `viewport-fit=cover`） |
| favicon | `/favicon.svg` |
| 挂载点 | `<div id="root">` |
| 入口脚本 | `<script type="module" src="/web/main.tsx">` |

### 1.2 main.tsx

| 项 | 值 |
|---|---|
| 渲染树 | `StrictMode` → `AppTheme` → `App` |
| dayjs locale | `dayjs.locale('zh-cn')` |
| 样式引入 | `antd/dist/reset.css`、`./styles.css` |
| 异常 | `#root` 缺失时抛 `缺少挂载节点 #root` |

### 1.3 App.tsx 骨架结构

```
div.app-shell
├─ header.app-header
│   ├─ h1  12306 查票助手
│   └─ p   比官方网页给出更多选择方案
└─ main
    ├─ QueryForm            （常驻）
    ├─ h2.results-title     （view !== 'idle' 时）
    ├─ StatusBar            （text 为空时不渲染）
    └─ 结果区               （按 view 分支）
```

### 1.4 results-title 全部取值

| `view` | 结果标题 | 结果区组件 | 额外结构 |
|---|---|---|---|
| `idle` | 不渲染 | 无 | 仅表单 + 状态条 |
| `direct` | `直达车次` | `TrainList` | 无 |
| `transfer` | `中转方案` | `TransferList` | 无 |
| `selfbuilt` | `自研中转方案` | `SelfBuiltList` | 前置 `div.results-toolbar`（右对齐，内含「重新选择枢纽」按钮） |
| `hubs` | `选择中转枢纽` | `HubPicker` | 无 |

### 1.5 各列表空态文案

| 列表 | 空态文案 |
|---|---|
| `TrainList` | `没有直达车次` |
| `TransferList` | `没有中转方案` |
| `SelfBuiltList` | `没有自研中转方案` |
| `HubPicker` | `没有合适的候选枢纽，建议改用『查中转』`（只渲染「返回」按钮） |

---

## 2. 查询表单字段

容器：`Form layout="vertical"`、`className="query-form"`、`initialValues={{ date: dayjs(defaultDate()) }}`。

| 字段 | label | 控件 | placeholder | 默认值 | 必填 | 错误文案 |
|---|---|---|---|---|---|---|
| `from` | 出发城市 | `AutoComplete`（`allCityNames()` 联想） | `北京` | 无 | 是 | `请输入出发城市` / `未识别的城市：{v}` |
| `to` | 到达城市 | `AutoComplete`（同上） | `上海` | 无 | 是 | `请输入到达城市` / `未识别的城市：{v}` |
| `date` | 日期 | `DatePicker` | `选择日期` | 北京时间明天 | 是 | `请选择日期` / `日期早于今天，无法查询` / `尚未开售：仅可查询 {today} ~ {max}` |
| `token` | 口令 | `Input.Password`（`visibilityToggle`、`autoComplete="new-password"`） | `可选` | 无 | 否 | 无 |

- 校验短路顺序：`date` → `from` → `to`，一次只报第一个语义错误。
- `QueryContext` = `{ from: ResolvedCity, to: ResolvedCity, date: 'YYYY-MM-DD', token: string }`。
- 对调按钮：`Button type="text" shape="circle"`，`Tooltip` + `aria-label` 均为「对调出发与到达城市」。

---

## 3. 三个查询按钮

| 文案 | type | 触发流程 | loading |
|---|---|---|---|
| `查直达` | `primary` | 单次 `leftTicket` → 解析 → 合并全量站名表 | `querying` |
| `查中转` | 默认 | 官方基线 + 分段查询，流式刷新；完成后自动查最优方案各程价格 | `querying` |
| `自研中转` | 默认 | **零请求**离线算候选枢纽 → 切 `hubs` 视图 | `querying` |

---

## 4. StatusBar 全部文案来源

`kind === 'info'` → 纯文本 `div.query-status`；`warn` / `error` → antd `Alert`（`showIcon`，`marginBottom: 12`）。

### 4.1 直达通路

| 时机 | 文案 | kind |
|---|---|---|
| 发起 | `正在查询直达…` | info |
| 成功 | `直达 {N} 趟` | info |
| 失败 | `直达查询失败：{error}` | error |
| 异常 | `查询出错：{e}` | error |

### 4.2 官方中转通路

| 时机 | 文案 | kind |
|---|---|---|
| 发起 | `正在查询官方基线…` | info |
| 基线失败 | `官方基线查询失败：{error}，改用内置枢纽兜底…` | warn |
| 每段完成 | `已查 {i+1}/{total} 段，累计 {n} 条方案`（有错追加 `（查询失败：{error}）`） | info / warn |
| 完成（有错） | `{查询部分完成\|中转查询失败}：中转 {n} 条方案；{错误列表}` | warn / error |
| 完成（无错） | `完成：中转 {n} 条方案` | info |

### 4.3 自研通路

| 时机 | 文案 | kind |
|---|---|---|
| 阶段一 | `候选枢纽（离线计算，未发起任何请求）` | info |
| 查询中 | `正在自研枚举中转…` | info |
| 完成 | `自研中转 {n} 条方案（经 {m} 个枢纽，扩展 {k} 条边）` | info |
| 取消 | `已取消自研查询` | info |
| 异常 | `自研查询出错：{e}` | error |

---

## 5. AppTheme 完整 token 清单

### 5.1 CSS 变量（`--rail-*`）

| 变量 | 亮色 | 暗色 |
|---|---|---|
| `--rail-page` | `#f5f5f7` | `#101012` |
| `--rail-surface` | `#ffffff` | `#1c1c1e` |
| `--rail-text` | `#1d1d1f` | `#f5f5f7` |
| `--rail-secondary` | `#68686e` | `#aaaab0` |
| `--rail-line` | `#e8e8ed` | `#38383d` |
| `--rail-blue` | `#0066cc` | `#75b9ff` |
| `--rail-green` | `#267b48` | `#79d69a` |
| `--rail-panel` | `#fbfbfd` | `#232326` |

另：`--card-padding` 桌面 22px，≤767px 16px。

### 5.2 antd token 覆盖

| token | 值 |
|---|---|
| `fontFamily` | `-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", sans-serif` |
| `colorPrimary` | 亮 `#007aff` / 暗 `#0a84ff` |
| `colorBgLayout` | `--rail-page` |
| `colorBgContainer` | `--rail-surface` |
| `colorText` | `--rail-text` |
| `colorTextSecondary` | `--rail-secondary` |
| `colorBorderSecondary` | `--rail-line` |
| `borderRadius` | 12 |
| `borderRadiusLG` | 20 |
| `controlHeight` | 44 |
| `controlHeightSM` | 24 |
| `controlHeightLG` | 44 |

### 5.3 组件级覆盖

| 组件 | 覆盖 |
|---|---|
| `Form` | `itemMarginBottom: 0`、`labelColor: secondary` |
| `Button` | `controlHeightSM: 44` |
| `Input` / `Select` / `DatePicker` | 字号 16 |
| `Card` | `bodyPaddingSM: 20` |
| `Collapse` | `headerBg: transparent`、`contentBg: surface` |

### 5.4 主题切换机制

`useSyncExternalStore` 订阅 `matchMedia('(prefers-color-scheme: dark)')`，
切换时改 `data-theme` 属性 + CSS 变量 + antd `theme.darkAlgorithm`。
**只跟随系统，无手动切换入口。**

---

## 6. styles.css 全部类名清单

### 6.1 骨架

| 类名 | 作用 | 响应式 |
|---|---|---|
| `app-theme` | 主题根，定义 `--card-padding`，min-height 100vh | `--card-padding` 767px 降为 16px |
| `app-shell` | 内容容器，max-width 1160px，padding 32px | 767px 收窄并适配安全区 |
| `app-header` | 页头，下距 26px | — |
| `app-header h1` | 28px / 650 / letter-spacing -.6px | 767px 降为 26px |
| `app-header p` | 副标题 13px 次要色 | — |
| `results-title` | 结果标题 20px / 600 | — |
| `muted` | 通用灰字 13px | — |
| `query-status` | 状态条，`overflow-wrap: anywhere` | — |

### 6.2 查询表单

| 类名 | 作用 | 响应式 |
|---|---|---|
| `query-form` | 6 列网格 `1fr 44px 1fr 160px 150px auto` | 959px 变 4 列；767px 变 3 列 + 分行 |
| `query-from` / `query-to` / `query-date` / `query-access` / `query-swap` / `query-actions` | grid-area 定位 | 各断点重排 |
| `query-actions` | 按钮行，flex gap 10px | 767px 变 2 列网格、按钮铺满 |

### 6.3 车次卡

| 类名 | 作用 | 响应式 |
|---|---|---|
| `train-list` | 卡片列表 grid | — |
| `ticket-card` | 卡片根，下距 12px，无阴影 | — |
| `ticket-main` | 主网格 4 列 `120px / 1.3fr / 1fr / .8fr` | 959px 3 列；767px 单列 |
| `ticket-caption` | 卡片头两端对齐 13px | — |
| `train-identity` | 车次号 + 副标题 | 767px 横向两端对齐 |
| `ticket-actions` | 操作区 flex 右对齐 | 959px 跨列；767px 左对齐 |
| `ticket-note` | 始发/终到 Tag 上距 | — |
| `buy-short-result` | 买短乘长结果区，上边框 + 留白 | — |

### 6.4 时刻与席别

| 类名 | 作用 | 响应式 |
|---|---|---|
| `journey-times` | 三栏网格 `1fr auto 1fr` | — |
| `journey-end` | 单端（时刻 + 站名），末列右对齐 | — |
| `journey-duration` | 中间历时 + 横线 | — |
| `day-offset` | 跨天 `+N` 上标 | — |
| `seat-list` | 席别标签 flex 换行 | — |
| `seat-label` | 单席别 13px | — |
| `seat-on` / `seat-hl` | 有票（绿） | — |
| `seat-off` | 无票 / 占位（灰） | — |

### 6.5 价格

| 类名 | 作用 |
|---|---|
| `price-item` | 直达的单条「席别名 + 价格」 |
| `total-price` | 参考价主数字 15px / 600 |
| `price-breakdown` | `¥A + ¥B` 分解 12px 次要色 |
| `ref-price` | 参考价整体 inline-flex |
| `leg-prices` | 自研多程价格块容器 auto-fit |
| `leg-price` | 单程价格卡（浅底 + 边框 + 圆角） |
| `leg-price-head` | 官方价格卡标题「车次 · 上车 → 下车」 |
| `leg-price-code` | 自研价格卡标题（仅车次） |
| `leg-price-cta` | 查价按钮容器 |
| `price-list` | 价格小表 grid |
| `price-row` | 一行两列 + 行分隔线 |
| `price-row--ref` | 二等座参考行蓝色加粗 |
| `price-name` / `price-amount` | 席别名 / 金额 |

### 6.6 展开详情

| 类名 | 作用 | 响应式 |
|---|---|---|
| `journey-details` | `<details>` 容器，上边框 | — |
| `journey-details summary` | 44px 最小高度，`+` / `−` 指示 | — |
| `transfer-legs` | 各程容器 gap 16px | — |
| `transfer-leg` | 单程 `24px + 1fr` 两列 | — |
| `leg-index` | 圆形序号徽标 | — |
| `leg-content` | 单程内容网格 `heading/seats/times/price` | 767px 单列 |
| `leg-heading` | 车次 + 始发/终到 Tag | — |
| `leg-tools` | 余票区 | — |
| `transfer-facts` | 换乘事实列表 gap 6px | — |
| `transfer-wait` | 单个换乘行 13px | — |
| `wrapping-tag` | antd Tag 允许换行 | — |

### 6.7 枢纽选择

| 类名 | 作用 |
|---|---|
| `hub-picker` | 容器 grid gap 16px |
| `hub-picker-hint` | 说明 + 已选计数 |
| `hub-grid` | 候选网格 auto-fill ≥150px |
| `hub-card` | 候选卡按钮，hover 变蓝边，disabled 半透明 |
| `hub-card--on` | 选中态蓝边 + 蓝色调底 |
| `hub-card-city` / `hub-card-ratio` | 城市名 / 绕行比值 |
| `hub-picker-actions` | 底部按钮行 |
| `list-toolbar` / `hub-list` / `results-toolbar` | **CSS 中无定义**，仅挂载点 |

### 6.8 接驳

| 类名 | 作用 |
|---|---|
| `connection-panel` | 面板根，13px，gap 6px |
| `connection-summary` | 站对 + 标记一行 |
| `connection-pair` | 站对文本 |
| `connection-modes` | 两种方式容器 |
| `connection-mode` | 单个方式 inline-flex |
| `connection-errors` | 错误 + 重试 |
| `connection-details` | 展开详情，上分隔线 |
| `connection-detail` | 单方式详情块 |
| `connection-lines` / `connection-line` / `connection-line-title` | 公交逐段明细 |

---

## 7. 响应式断点

| 断点 | 变化 |
|---|---|
| `max-width: 959px` | 表单 4 列；`.ticket-main` 3 列；`.ticket-actions` 跨列 |
| `max-width: 767px` | `--card-padding` 16px；shell padding 收窄 + 安全区；表单 3 列分行、按钮铺满；`.ticket-main` 单列；`.leg-content` 单列 |
| 无 380px 及以下断点 | — |

---

## 8. 无障碍现状

| 项 | 现状 |
|---|---|
| `aria-label="行程时间"` | `JourneyTimes` 容器 |
| `aria-label="历时"` | 历时 span（会覆盖可见文本读屏） |
| `aria-label="跨{N}天"` | 跨天上标 |
| `aria-label="对调出发与到达城市"` | 对调按钮 |
| `aria-pressed` | `hub-card` 选中态 |
| 焦点样式 | **仅 `.hub-card` 无自定义 focus-visible；antd 默认** |
| `prefers-reduced-motion` | **未处理** |
| 表格语义 | 价格小表用 `div` + grid，无 `role="table"` |
