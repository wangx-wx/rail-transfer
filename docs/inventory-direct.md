# 直达车次页面渲染清单（UI 改版验收基线）

> 盘点对象：`view === 'direct'` 时实际渲染的全部信息。
> 依据代码：`web/App.tsx`、`web/components/TrainList.tsx`、`web/components/JourneyTimes.tsx`、
> `web/lib/view.ts`、`web/lib/parse.ts`、`web/lib/buyshort.ts`、`shared/types.ts`、
> `shared/constants.ts`、`web/styles.css`。
> 基线测试：`web/tests/TrainList.test.tsx`（18 条，全部通过）。

---

## 1. 页面级信息（卡片之外）

| # | 渲染项 | 文案模板 | 数据来源 | 显示条件 |
|---|---|---|---|---|
| P1 | 结果标题 `.results-title`（`<h2>`） | 「直达车次」 | `App.tsx:441-442` 常量 | `view === 'direct'` |
| P2 | 查询状态 `.query-status`（纯文本 div） | 「正在查询直达…」 | `App.tsx:223` | 查询发起时，`kind='info'` |
| P3 | 查询状态 | 「直达 {N} 趟」 | `App.tsx:237`，`N = trains.length` | 查询成功后，`kind='info'` |
| P4 | 查询状态（Alert） | 「直达查询失败：{error}」 | `App.tsx:231` | 请求失败，`kind='error'` |
| P5 | 查询状态（Alert） | 「查询出错：{e}」 | `App.tsx:239` | 抛异常，`kind='error'` |
| P6 | 空态 `ant-empty` | 「没有直达车次」 | `TrainList.tsx:110` 常量 | `result` 非空且 `trains.length === 0` |
| P7 | 整块不渲染 | — | `TrainList.tsx:108` | `result === null`（查询中 / 未查询） |

补充：
- `P2`/`P3` 为 `kind='info'`，渲染为 `.query-status` 灰字；`P4`/`P5` 为 antd `Alert`（`showIcon`，`marginBottom: 12`），同时带 `.query-status` 类。
- 直达查询开始时 `App.tsx:215-219` 会重置 `direct=null`、`prices={}`、`buyShort={}`、`buyShortProgress={}`。

---

## 2. 单张直达卡片完整渲染顺序（层 A~F）

卡片根：antd `Card`，`className="ticket-card"`，`size="small"`，`variant="borderless"`，
`styles.body.padding = 'var(--card-padding, 20px)'`（`TrainList.tsx:131`）。
`key = ${trainCode}-${fromStation}-${toStation}`。
**卡片无 `title` / `extra` / `footer`**，全部内容在 body 内。

每卡渲染前计算的变量（`TrainList.tsx:115-128`）：

| 变量 | 定义 |
|---|---|
| `from` | `nameOf(t.fromStation, stationMap)` |
| `to` | `nameOf(t.toStation, stationMap)` |
| `via` | `viaTags(nameOf(t.startStation, stationMap), nameOf(t.endStation, stationMap), from, to)` |
| `seats` | `t.seats.map(s => seatLabel(s.name, s.raw)).filter(Boolean)` |
| `key` | `priceKey(t.trainNo, t.fromStationNo, t.toStationNo)`，缺失站序时为 `null` |
| `priceMap` | `key ? prices[key] : undefined` |
| `priceItems` | `seatPrices(priceMap)` |
| `soldOut` | `isSoldOut(t)`（基准席别无票） |
| `bsKey` | `t.trainNo`（买短乘长结果的键） |

### 层 A：卡片头部 —— `.ticket-main` 第 1 列

| # | 渲染项 | 文案模板 | 数据来源 | 显示条件 |
|---|---|---|---|---|
| A1 | 车次号（`<strong>`，16px / 600） | `{trainCode}`，如「G531」 | `Train.trainCode`（leftTicket 第 3 列） | 无条件 |
| A2 | 副标题（`<span>`，12px 灰） | 「直达列车」（字面量） | 常量 | 无条件 |

### 层 B：卡片主体 —— `.ticket-main` 第 2 列（`JourneyTimes` 组件）

| # | 渲染项 | 文案模板 | 数据来源 | 显示条件 |
|---|---|---|---|---|
| B0 | 容器 | `role="group"` `aria-label="行程时间"` | — | 无条件 |
| B1 | 出发时刻（27px / 600 / tabular-nums / nowrap） | `{startTime}` | `Train.startTime`（第 8 列） | 无条件（原样输出，异常值可能为 `'----'`） |
| B2 | 出发站名（13px 灰） | `{fromStation}` | `nameOf(t.fromStation, stationMap)`（第 6 列站码） | 无条件 |
| B3 | 历时（`<span aria-label="历时">`） | `{duration}`，如「4时18分」或 `04:18` 原值 | `Train.duration`（第 10 列，`HH:MM`，可超 24h，如 `27:05`） | 无条件 |
| B4 | 历时下方连接线 | `<i aria-hidden="true" />`（1px 横线） | 纯装饰 | 无条件 |
| B5 | 到达时刻（27px / 600） | `{arriveTime}` | `Train.arriveTime`（第 9 列） | 无条件 |
| B6 | 跨天上标 | `+{days}` | `dayOffset(startTime, arriveTime, duration)` | **仅 `days > 0`** |
| B7 | 到达站名（13px 灰，右对齐） | `{toStation}` | `nameOf(t.toStation, stationMap)`（第 7 列） | 无条件 |

### 层 C：卡片主体 —— `.ticket-main` 第 3 列（席别余票）

| # | 渲染项 | 文案模板 | 数据来源 | 显示条件 |
|---|---|---|---|---|
| C1 | 席别标签 × N | 见 §3 | `t.seats` → `seatLabel(s.name, s.raw)` | `seats.length > 0` |
| C2 | 无票占位 | 「无票」 | 常量 | `seats.length === 0`（8 个席别全被过滤） |

### 层 D：卡片底部 —— `.ticket-main` 第 4 列（`.ticket-actions`，flex 右对齐）

| # | 渲染项 | 文案模板 | 数据来源 | 显示条件 |
|---|---|---|---|---|
| D1 | 价格条目 × N | `{席别名} {价格}`，如「二等座 ¥626」 | `seatPrices(prices[key])` | `priceItems.length > 0` |
| D2 | 查价按钮（`type="link"`） | 「查价」 | — | `priceItems.length === 0` |
| D2a | 查价按钮 loading 态 | 文案不变，加转圈图标，不可点 | `loadingPrice.has(key)` | 查价请求进行中 |
| D2b | 查价按钮 disabled 态 | 文案不变，置灰 | `!key \|\| !t.seatTypes` | 站序或席别码串缺失 |
| D3 | 买短乘长按钮（`type="link"`，可 loading） | 「买短乘长」 | 触发 `onQueryBuyShort(t, bsKey)` | **`soldOut && !buyShort[bsKey]`** |

组合关系：D1 与 D3 可同时出现；D2 与 D3 可同时出现；D1/D2 互斥。

### 层 E：`.ticket-main` 之下 —— 始发 / 终到标注

| # | 渲染项 | 文案模板 | 数据来源 | 显示条件 |
|---|---|---|---|---|
| E1 | antd `Tag`（`className="wrapping-tag ticket-note"`） | `{via.join(' · ')}`，如「始发 北京 · 终到 杭州东」 | `viaTags(nameOf(t.startStation), nameOf(t.endStation), from, to)`（第 4/5 列 vs 第 6/7 列） | `via.length > 0` |

`viaTags` 规则（`view.ts:30-40`）：
- `startStation && startStation !== fromStation` → 追加「始发 {startStation}」；
- `endStation && endStation !== toStation` → 追加「终到 {endStation}」；
- 顺序固定：先「始发」后「终到」；两者都不同时用 ` · ` 连接；都为同一站时整条 Tag 不渲染。

### 层 F：卡片内最底部 —— 买短乘长内联结果区 `.buy-short-result`

外层条件：`soldOut === true`（`TrainList.tsx:158`）。
组件内再判：`!loading && !result` → `return null`（未查询时不占位）。
五种状态的文案见 §5。

---

## 3. 席别展示完整规则

### 3.1 数据来源与顺序

`parseTrainRow`（`parse.ts:24-53`）按 `SEAT_COLUMNS` 顺序逐列读 `raw`，生成 `SeatAvailability[]`：

| 顺序 | 列索引 | 席别码 | 中文名 | 是否实测确认 |
|---|---|---|---|---|
| 1 | 26 | `WZ` | 无座 | 是 |
| 2 | 29 | `YZ` | 硬座 | 否（经典映射推测） |
| 3 | 28 | `YW` | 硬卧 | 否（经典映射推测） |
| 4 | 23 | `GR` | 高级软卧 | 否（经典映射推测） |
| 5 | 33 | `TZ` | 特等座 | 否（经典映射推测） |
| 6 | 32 | `SWZ` | 商务座 | 是 |
| 7 | 31 | `ZY` | 一等座 | 是 |
| 8 | 30 | `ZE` | 二等座 | 是 |

**展示顺序 = 上表顺序**（不是「有票优先」，也不是按余票多少排序）。
`available` 的判定：`raw !== '' && raw !== '无'`；`count` 仅当 `raw` 为纯数字时有值。

### 3.2 `seatLabel(name, raw)` 全部分支

`TrainList.tsx:119` 调用时**未传第三个参数 `highlight`**，故 `highlight` 恒为 `false`。

| `raw` 取值 | 返回 | 文案 | `state` | 生成的类名 | 颜色语义 |
|---|---|---|---|---|---|
| `'--'` | `null` | — | — | 被 `.filter` 丢弃 | 不渲染 |
| `''`（空串，含列缺失） | `null` | — | — | 被 `.filter` 丢弃 | 不渲染 |
| `undefined` | `null` | — | — | 被 `.filter` 丢弃 | 不渲染 |
| `'无'` | `SeatLabel` | `{席别名} 无`，如「二等座 无」 | `off` | `seat-label seat-off` | `var(--rail-secondary)` 灰色 |
| 纯数字（`/^\d+$/`，如 `'12'`） | `SeatLabel` | `{席别名} {N} 张`，如「二等座 12 张」 | `on` | `seat-label seat-on` | `var(--rail-green)` 绿色 |
| 其他非空值（如 `'有'`） | `SeatLabel` | `{席别名} 有`，如「二等座 有」 | `on` | `seat-label seat-on` | 绿色 |
| 同上，且 `highlight=true` | `SeatLabel` | 同上 | `hl` | `seat-label seat-hl` | 绿色（CSS 与 `seat-on` 同色） |

补充说明：
- 前后空白先 `trim()` 再判定（`String(raw ?? '').trim()`）。
- `state` 只有 `off` / `on` / `hl` 三种；`hl` 语义是「有票且为用户所选席别」，但**当前直达与中转卡片都没有传入 `highlight=true`，因此 `seat-hl` 目前是死代码**（仅 `web/tests/view.test.ts` 覆盖）。
- 中文名直接取 `SEAT_COLUMNS[].name`（`parse` 阶段写入 `SeatAvailability.name`）。

### 3.3 过滤规则与数量上限

| 问题 | 结论 |
|---|---|
| 哪些席别会被过滤 | `raw` 为 `'--'` 或空串（含缺失）的席别，`seatLabel` 返回 `null`，被 `.filter(x => x.label)` 丢弃 |
| 是否有数量上限 | **无显式上限**；上限天然为 8（`SEAT_COLUMNS` 长度）。不截断、不分页、不折叠 |
| 是否按有票优先排序 | 否，严格按 `SEAT_COLUMNS` 顺序 |
| 空态判定 | `seats.length === 0`，即 8 个席别**全部**为 `'--'` 或空 |

### 3.4 「无票」占位

| 项 | 内容 |
|---|---|
| 文案 | 「无票」 |
| 类名 | `seat-label seat-off` |
| 触发条件 | `seats.length === 0`，即全部 8 个席别 raw 均为 `'--'` / 空 |
| 与「全部显示 X 无」的区别 | 若 8 个席别 raw 全为 `'无'`，则渲染 8 个「X 无」标签（`seat-off`），**不显示**「无票」占位 |

---

## 4. 查价三种状态

| 状态 | 判定条件 | 渲染内容 |
|---|---|---|
| **未查** | `prices[key]` 不存在（含 `key === null`） | `priceItems = []` → 只渲染「查价」按钮，`loading=false`；`key` 或 `seatTypes` 缺失时按钮 disabled |
| **查询中** | `loadingPrice.has(key)` | 仍是「查价」按钮，`loading=true`：antd 转圈图标，文案不变，不可点。**无骨架屏、无「查询中」文字、席别区不变化** |
| **已查到** | `prices[key]` 存在 | 价格条目**整体替换**「查价」按钮（`priceItems.length ? 条目 : 按钮`） |

### 4.1 已查到的价格条目排布

| 项 | 说明 |
|---|---|
| 容器 | `.ticket-actions` 内的多个 `<span className="price-item">`，flex 换行、右对齐，`gap: 6px 10px` |
| 单项文案 | `{name} {label}`，如「二等座 ¥626」「一等座 ¥1033」「商务座 ¥2315」 |
| 席别集合 | 价格接口返回的**全部有价席别**（`parsePrice` 只收 `¥` 前缀值，且键必须在 `SEAT_CODE_NAME` 中） |
| 排序 | `SEAT_PRICE_ORDER`：`9, P, M, D, S, O, 6, I, J, F, A, 4, 3, 2, 1, WZ, W`；表外未知码排末尾，保持接口原序 |
| 席别名 | `SEAT_CODE_NAME[code] ?? code`（未知码回退显示码本身） |
| 金额格式 | `priceLabel`：整数 `¥626`；非整数保留一位小数 `¥177.5`；`null`/非有限数返回空串 |
| 参考席别高亮 | **直达卡片不高亮**。`.price-row--ref` 蓝字高亮只存在于中转详情 `.leg-price` 表格（`TransferList.tsx:150`） |
| 查价失败/空表 | `App.tsx:128` 不写入 `prices`，按钮恢复为可点的「查价」，用户无失败提示 |
| 不会出现的东西 | 无总价、无「参考价」、无「价格加载失败」文案、无展开区 |

### 4.2 查价请求参数（供改版核对）

`onQueryPrice(trainNo, fromStationNo, toStationNo, date, seatTypes)`，其中 `seatTypes` 必须是该车自己的席别码串（leftTicket 第 35 列），缺失则按钮 disabled。

---

## 5. 买短乘长结果状态（5 种 + 未查）

外层条件：仅 `soldOut === true` 的车次渲染结果区。
`soldOut = isSoldOut(t)`：基准席别存在且 `available === false`。
基准席别判定：`seatTypes` 含 `O` → `ZE`（二等座）；否则 → `YZ`（硬座）。

| # | 状态 | 判定条件 | 渲染文案 | 样式 |
|---|---|---|---|---|
| 0 | 未查 | `!loading && !result` | **不渲染**（返回 `null`） | — |
| 1 | loading | `buyShortLoading.has(trainNo)` | 「查询中… 已查 {progress ?? 0} 站，均无票」 | 灰字 13px（内联 `HINT_STYLE`） |
| 2 | found（有价） | `kind === 'found' && price != null` | 主句：「**买短乘长**：买「{from} → {stationName}」{seatName} ¥{price}，上车后补票至 {to}」<br>次行：「需车上补票，超员时可能被要求下车」 | 「买短乘长」四字 `type="success" strong` 绿色加粗；次行灰字 |
| 3 | found（无价） | `kind === 'found' && price == null` | 主句同上，价格位置改为「有票」：「…{seatName} 有票，上车后补票至 {to}」<br>次行风险提示同上 | 同上 |
| 4 | noCandidate | `kind === 'noCandidate'` | 「该车无中途可买站」 | 灰字 |
| 5 | error | `kind === 'error'` | 「查询失败：{error}」 | 灰字 |
| 6 | none（沿途全无票） | 其余（`kind === 'none'`） | 「该车沿途各站均无票」 | 灰字 |

补充说明：
- `state.from` / `state.to` 是**站名**（`nameOf` 结果），`result.stationName` 来自经停接口的 `station_name`（可能是城市名）。
- `result.seatName` 是基准席别中文名（「二等座」或「硬座」）。
- 有价时价格用模板字符串 `¥${price}` 直出，**不走 `priceLabel`**，与卡片其他价格格式可能不一致（如 `¥156` vs `¥156.0`）。
- 按钮在 `buyShort[trainNo]` 存在后**永久隐藏**（含 error / noCandidate），无重试入口。
- 结果区结构：`.buy-short-result` 上边框 + `margin-top: 12px` + `padding-top: 12px`。
- error 文案可能来自 `buyshort.ts` 的固定串：「缺少站序，无法查询经停」「该车次无可用基准席别」，或上游错误。

---

## 6. 跨天 `+N` 上标

| 项 | 内容 |
|---|---|
| 判定函数 | `dayOffset(startTime, arriveTime, duration)`（`view.ts:137-144`） |
| 算法 | 优先：`days = floor((发车分钟 + 历时分钟) / 1440)`；缺历时或历时不跨天时，回退「到达 < 发车 → 1」；否则 0 |
| 渲染条件 | `days > 0` |
| 位置 | `JourneyTimes` 第三个 `.journey-end` 内，紧跟在到达时刻文本之后、到达站名 `<span>` 之前 |
| 结构 | `<strong>{arriveTime}<sup class="day-offset" aria-label="跨{N}天">+{N}</sup></strong>` |
| 文案 | `+{days}`，如 `+1`、`+2` |
| 样式 | 12px / 600 / `var(--rail-secondary)` / `margin-left: 1px` / `vertical-align: super` |
| 发车侧 | 永不显示 `+N` |

注意：不能只看「到达时刻 < 发车时刻」，否则会漏判历时超 24h 但到达时刻数值更大的长途车（如 10:00 发、历时 27:05 → 次日 13:05 到）。

---

## 7. 全部 CSS 类名清单及语义

### 7.1 直达卡片直接使用的类名

| 类名 | 承载语义 / 作用 | 定义处 |
|---|---|---|
| `train-list` | 卡片列表容器，`display: grid`，`min-width: 0` | `styles.css:43` |
| `ticket-card` | 卡片根（与 antd Card 合并），底距 12px、无阴影 | `styles.css:44` |
| `ticket-main` | 卡片主体网格：桌面 4 列 `120px / minmax(190px,1.3fr) / minmax(150px,1fr) / minmax(100px,.8fr)`；≤959px 3 列；≤767px 单列 | `styles.css:45-50, 108, 120` |
| `train-identity` | 车次号 + 副标题；桌面纵向 grid，≤767px 横向两端对齐 | `styles.css:51-53, 122` |
| `journey-times` | 时刻三栏网格（出发 / 历时 / 到达），`role="group"` | `styles.css:55` |
| `journey-end` | 单端（时刻 + 站名）纵向 grid；末列右对齐 | `styles.css:56-59` |
| `journey-duration` | 中间历时列；子元素 `i` 为下方 1px 连接线 | `styles.css:62-63` |
| `day-offset` | 跨天 `+N` 上标 | `styles.css:61` |
| `seat-list` | 席别标签 flex 换行容器 | `styles.css:64` |
| `seat-label` | 单个席别标签基类（13px） | `styles.css:65` |
| `seat-on` | 席别有票（绿色） | `styles.css:66` |
| `seat-hl` | 有票且为用户所选席别（绿色，**当前未被触发**） | `styles.css:66` |
| `seat-off` | 席别无票 / 「无票」占位（灰色） | `styles.css:67` |
| `ticket-actions` | 操作区 flex，右对齐；价格条目与按钮共用 | `styles.css:68-69` |
| `price-item` | 已查到的单个「席别名 + 价格」 | `styles.css:70` |
| `wrapping-tag` | antd Tag 允许换行（始发/终到标注） | `styles.css:83` |
| `ticket-note` | 该 Tag 的 12px 上边距 | `styles.css:84` |
| `buy-short-result` | 买短乘长结果区：上边框 + 分隔留白 | `styles.css:85` |
| `muted` | 通用灰字（直达卡片未直接使用；HINT_STYLE 为内联等价样式） | `styles.css:15` |
| `query-status` | 查询状态条（页面级） | `styles.css:15-16` |
| `results-title` | 结果标题（页面级） | `styles.css:14` |

### 7.2 无类名但参与渲染的样式

| 载体 | 内容 | 定义处 |
|---|---|---|
| 内联 `HINT_STYLE` | `color: var(--rail-secondary); fontSize: 13` | `TrainList.tsx:48` |
| Card `styles.body` | `padding: var(--card-padding, 20px)` | `TrainList.tsx:131` |

### 7.3 antd 自带类名（改版时应保留）

`ant-card`、`ant-card-body`、`ant-btn`、`ant-btn-link`、`ant-btn-loading`、`ant-btn-disabled`、
`ant-typography`、`ant-typography-success`、`ant-tag`、`ant-empty`、`ant-alert`。

### 7.4 CSS 变量

| 变量 | 用途 | 定义处 |
|---|---|---|
| `--rail-green` | 有票席别 | `AppTheme.tsx:23` |
| `--rail-secondary` | 无票席别 / 灰字提示 | `AppTheme.tsx:20` |
| `--rail-line` | 分隔线 | `AppTheme.tsx:21` |
| `--rail-text` | 正文 | `AppTheme.tsx:19` |
| `--card-padding` | 卡片内边距（桌面 22px，≤767px 16px） | `styles.css:7, 114` |

---

## 8. 改版时容易踩的隐含事实

1. **`Train.price` 字段完全未被直达卡片使用**——价格只来自 `prices[priceKey]` 缓存。
2. **`secretStr` / `trainDate` / `seatTypes` 不渲染**（`seatTypes` 仅作为查价请求参数）。
3. 除车次号外**没有任何车次属性**被展示；「直达列车」是写死的字面量。
4. 席别余票与价格是**两套独立信息、两套加载态**：席别来自 leftTicket，价格来自懒加载价格接口。不要合并成单一「席别 + 余票 + 价格」表而丢掉两套状态。
5. 买短乘长入口依赖「**基准席别**无票」而非「全部席别无票」；改版配色时不要误把 `soldOut` 做成「所有席别都灰」。
6. `seat-hl` 当前是死代码；保留类名可以，但不要假设它会出现。
7. 查价返回空表时无失败提示，按钮会恢复为可点状态。
8. 可访问性：`<span aria-label="历时">{duration}</span>` 与 `<sup aria-label="跨N天">+N</sup>` 的 `aria-label` 会覆盖可见文本的读屏内容，改版若保留结构需一并核对。
