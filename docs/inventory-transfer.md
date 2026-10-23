# 官方 lcquery 中转方案页面 —— 渲染信息全量清单

> 用途：UI 改版验收清单。逐项对照源码，一条不漏。
> 覆盖范围：`view === 'transfer'`（官方 lcquery 通路）的页面外壳、结果列表、中转卡片、两程详情、价格、接驳面板。
> 自研通路（`SelfBuiltList`）复用同一套 `ConnectionPanel`，但不属于本清单主体。

## 0. 数据链路

| 环节 | 位置 | 说明 |
|---|---|---|
| 上游解析 | `web/lib/parse.ts` `parseTransferItem` | `middleList` → `TransferPlan[]`；`same_station` 为字符串 `"0"`（同站）/`"1"`（同城异站），`same_train` 为 `"Y"`/`"N"` |
| 打标记 | `web/lib/plans.ts` `annotatePlan(s)` | 生成 `PlanFlags`：`belowMin` / `risky` / `longWait` / `sameTrain` |
| 合并 | `web/lib/plans.ts` `mergePlans` | 按 `firstTrainCode|secondTrainCode` 合成 `PlanGroup`；`best` 取组内 `totalMinutes` 最小者；重复行程去重后进 `plans` |
| 排序 | `web/lib/plans.ts` `sortPlans` | 默认按 `best.totalMinutes` 升序（D17） |
| 入口 | `web/App.tsx:263` | `setGroups(processPlans(plansRef.current))`，流式到达时反复刷新 |
| 二次分组 | `web/lib/view.ts` `groupByHub` | 按 `plan.middleStation` 拆成枢纽 → `[枢纽名, PlanGroup[]]`，每个枢纽内重新 `mergePlans + sortPlans`。同一车次组合可出现在多个枢纽下 |

---

## 1. 页面层级结构 L0~L9

| 层级 | 组件 / DOM | 文案模板 | 数据来源 | 显示条件 |
|---|---|---|---|---|
| L0 应用外壳 | `App.tsx` `header.app-header` | `<h1>12306 查票助手</h1>`；`<p>比官方网页给出更多选择方案</p>` | 硬编码 | 始终 |
| L1 结果标题 | `App.tsx:440-448` `h2.results-title` | `中转方案`（本通路）；`直达车次` / `自研中转方案` / `选择中转枢纽` 为其他视图 | `view` state | `view !== 'idle'` |
| L1.5 状态栏 | `App.tsx:450` `<StatusBar text kind>` | 见 §1.1 | `status` state | 始终渲染组件（text 为空时不显示文字） |
| L2 空态 | `TransferList.tsx:234` `<Empty description="没有中转方案" />` | `没有中转方案` | `groups.length === 0` | 替代 L3 及以下整块 |
| L3 枢纽折叠面板 | `TransferList.tsx:277` `<Collapse ghost className="hub-list">`，items 来自 `hubGroups` | header 左侧：`{hub}`；右侧 `<Tag>{list.length} 个方案</Tag>` | `groupByHub(groups)`；`hub` = `plan.middleStation`（官方通路可能形如 `北京西-北京南` 的站对串）；`list.length` = 该枢纽下的**车次组合数**（`PlanGroup` 数），非方案总数 | 始终 |
| L4 车次组合容器 | `TransferList.tsx:258-260` `<div key={firstTrainCode-secondTrainCode}>` | 无文案 | `PlanGroup` | 每个组合一个 |
| L5 代表卡片 | `TransferCard`（`g.best`） | 见 §2 | `PlanGroup.best`（组内 `totalMinutes` 最小） | 始终 |
| L6 同车次其他方案 | `TransferList.tsx:261-272` 内层 `<Collapse size="small" ghost>` | 折叠标题：`同车次其他方案（{g.plans.length - 1}）` | `g.plans.filter(p => p !== g.best)` | `g.plans.length > 1` |
| L7 两程详情 | `TransferList.tsx:212-217` `<details className="journey-details">` | `<summary>两程详情</summary>`，CSS `::after` 追加 `+`，展开时 `−` | `p.legs` | 始终，默认折叠 |
| L8 每程 | `TransferList.tsx:106-164` `Leg` | 见 §3 | `TransferLeg` | 每个 leg 一条 |
| L9 接驳面板 | `TransferList.tsx:55-95` `ConnectionEntry` → `ConnectionPanel`，嵌在 `.transfer-facts` 内 | 见 §6 | `connections[`${fromCode}>${toCode}`]` | `p.sameStation === false` |

### 1.1 状态栏全部文案（`App.tsx` 中转流程）

| 时机 | 文案模板 | kind |
|---|---|---|
| 发起查询 | `正在查询官方基线…` | info |
| 基线失败 | `官方基线查询失败：{error}，改用内置枢纽兜底…` | warn |
| 每段完成 | `已查 {i+1}/{total} 段，累计 {n} 条方案`；该段有错时追加 `（查询失败：{error}）` | info / warn |
| 全部完成且有错 | `{hasSuccess ? '查询部分完成' : '中转查询失败'}：中转 {n} 条方案；{错误列表}`，错误项格式 `官方基线：{error}` / `第 {i+1} 段：{error}` | warn / error |
| 全部完成无错 | `完成：中转 {n} 条方案` | info |
| 查询抛异常 | `查询出错：{e}` | error |

### 1.2 折叠状态行为

- 枢纽面板为受控 `activeKey`（`TransferList.tsx:229-232`）。
- `useEffect` 依赖 `allKeys.join('\u0000')`，每次枢纽集合变化就把**全部** `allKeys` 并入 `activeKeys`。
- 结果：流式新到的枢纽自动展开（符合注释意图），但用户已手动折叠的枢纽也会被重新展开（与注释描述不符，验收时注意）。
- 外层与内层 `Collapse` 的 header 最小高度均为 44px。

---

## 2. 单张中转卡片完整渲染顺序

外层：`<Card className="ticket-card" size="small" variant="borderless" styles={{ body: { padding: 'var(--card-padding, 20px)' } }}>`。

### 2.1 `.ticket-caption`（顶部两端对齐，13px 次要色）

| 位置 | 文案模板 | 数据来源 | 显示条件 |
|---|---|---|---|
| 左 | `{p.fromStation} → {p.endStation}` | `TransferPlan.fromStation` / `endStation` | 始终 |
| 右 | `总耗时 {durationLabel(p.totalMinutes)}` | `totalMinutes`（分钟 → `x时x分`） | 始终 |

`durationLabel` 规则：`< 60` → `{n}分`；整点 → `{h}时`；否则 `{h}时{m}分`；`null` / 非有限 / 负数 → 空串。

### 2.2 `.ticket-main` 第 1 列 `.train-identity`

| 项 | 文案模板 | 数据来源 | 显示条件 |
|---|---|---|---|
| 车次对 | `<strong>{p.firstTrainCode} → {p.secondTrainCode}</strong>` | `fullList[i].station_train_code`（显示车次，非内部编号） | 始终 |
| 接续方式 | `<span>{p.sameTrain ? '同车接续' : '换乘一次'}</span>` | `sameTrain` | 始终（**`sameTrain` 文案位 1/2**） |

### 2.3 `.ticket-main` 第 2 列 `JourneyTimes`

| 位置 | 渲染内容 | 数据来源 |
|---|---|---|
| 左端 | `<strong>{p.startTime}</strong>` + `<span>{p.fromStation}</span>` | `TransferPlan.startTime` / `fromStation` |
| 中间 | `<span aria-label="历时">{duration}</span>` + 一条横线 `<i aria-hidden="true" />` | 传入的是 `durationLabel(p.totalMinutes)`（如 `6时`），**不是** `HH:MM` |
| 右端 | `<strong>{p.arriveTime}{days > 0 && <sup className="day-offset" aria-label="跨{N}天">+{N}</sup>}</strong>` + `<span>{p.endStation}</span>` | `arriveTime` / `endStation`；`days = dayOffset(startTime, arriveTime, durationLabel(...))` |
| 容器 | `<div className="journey-times" role="group" aria-label="行程时间">` | — |

跨天 `+N` 判定（`view.ts` `dayOffset`）：
1. 若 `startTime` 与 `duration` 都能解析成时间 → `days = floor((发车分钟 + 历时分钟) / 1440)`。
2. 否则回退：`arrive < start` → 1，否则 0。

**注意**：卡片摘要传入的 `duration` 是 `durationLabel` 产物（`6时`），匹配不上 `HH:MM` 正则，因此摘要层实际只走回退分支。超过 24 小时但到达时刻数值更大的长途（如 10:00 发、历时 27:05、次日 13:05 到）在摘要层不会标 `+1`；单程详情传 `HH:MM` 历时，判定正确。

### 2.4 `.transfer-facts`（纵向堆叠，gap 6px）

| 顺序 | 元素 | 文案模板 | 数据来源 | 显示条件 |
|---|---|---|---|---|
| a | `.transfer-wait` | `换乘 {p.middleStation}　等待 {durationLabel(p.waitMinutes)}`（中间为全角空格 U+3000） | `middleStation` / `waitMinutes` | 始终 |
| b | `.muted` | `{p.sameStation ? '同站' : '同城异站'}` | `sameStation` | **始终**（`sameStation` 唯一文案位） |
| c | `.seat-list` 内每程一个 `.seat-label` | `第{i+1}程 {label.text}` 或 `第{i+1}程 暂无余票信息` | 见 §3.1 | 始终（legs 为空时为空容器） |
| d | `<Space size={4} wrap>` 内若干 `<Tag className="wrapping-tag" color=...>` | `planFlags(p.flags)` 的 `label` | `PlanFlags` | `flags.length > 0` |
| e | `ConnectionEntry` → `ConnectionPanel` | 见 §6 | `connections` / `loadingConnection` | `p.sameStation === false` |

### 2.5 `.ticket-actions`（第 4 列，右对齐，可换行）

| 条件 | 渲染 |
|---|---|
| 两程 `O` 码价格都拿到 | `<span className="ref-price"><strong className="total-price">二等座参考价 {priceLabel(total)}</strong><span className="price-breakdown">{priceLabel(p1)} + {priceLabel(p2)}</span></span>` |
| 其余情况（未查 / 只查到一程 / 缺站序 / 查询中） | `<span className="muted">展开两程查价</span>` |

### 2.6 `details.journey-details`

- `<summary>两程详情</summary>`（CSS 追加 `+` / `−`）。
- 展开后 `.transfer-legs` 内按 `p.legs` 顺序渲染 `Leg`，`key = `${trainCode}-${index}``。

---

## 3. 展开详情区（每程 `Leg`）

结构：`.transfer-leg`（24px 序号列 + `.leg-content` 内容列）。

| 项 | 元素 / 文案模板 | 数据来源 | 显示条件 |
|---|---|---|---|
| 序号 | `.leg-index` 圆形徽标，文本 `{index + 1}` | `p.legs` 下标 | 始终 |
| 车次 | `.leg-heading > strong`：`{leg.trainCode}` | `TransferLeg.trainCode` | 始终 |
| 始发/终到标注 | `.leg-heading > <Tag className="wrapping-tag">`：`via.join(' · ')` | `viaTags(leg.startStation, leg.endStation, leg.fromStation, leg.toStation)` | `via.length > 0` |
| 时刻/站名 | `JourneyTimes`：`{leg.startTime}` `{leg.fromStation}` ／ `{leg.duration}`（`HH:MM` 原样）／ `{leg.arriveTime}[+N]` `{leg.toStation}` | `TransferLeg` 各字段；`dayOffset` 用 `HH:MM` 历时判定 | 始终 |
| 余票列表 | `.leg-tools > .seat-list`，每席别一个 `<span className="seat-label seat-{state}">{label.text}</span>` | `Object.entries(leg.seats)` → `seatLabel(LEG_SEAT_NAMES[code] ?? code, raw)`，`null` 丢弃 | 至少一个非空、非 `--` 的席别 |
| 价格小表 | `.leg-price`（见 §5.3） | `prices[priceKey(...)]` | `seatPrices(...).length > 0` |
| 查价按钮 | `.leg-price-cta > <Button type="link">查价</Button>` | — | 无价格小表时 |

### 3.1 `viaTags` 规则（`view.ts:30-40`）

| 条件 | 输出 |
|---|---|
| `startStation && startStation !== fromStation` | 追加 `始发 {startStation}` |
| `endStation && endStation !== toStation` | 追加 `终到 {endStation}` |
| 两者都满足 | 以 ` · ` 连接：`始发 X · 终到 Y` |
| 都不满足 | 空数组，不渲染 Tag |

出现位置：**仅**每程标题旁，卡片摘要层不显示。

### 3.2 每程余票列表（详情区）

- 遍历 `Object.entries(leg.seats)` 全量（解析顺序固定 `ZE → ZY → SWZ → WZ`）。
- `seatLabel(name, raw)` 返回 `null` 的项被 `.filter(x => x.label)` 丢弃。
- 未传 `highlight`，状态只会是 `on` / `off`，不会产生 `hl`。

### 3.3 查价按钮状态

| 属性 | 规则 |
|---|---|
| 文案 | `查价`（恒定） |
| `disabled` | `!key \|\| !leg.seatTypes`；`key = priceKey(trainNo, fromStationNo, toStationNo)`，任一缺失即 `null` |
| `loading` | `key ? loadingPrice.has(key) : false` |
| 点击 | `onQueryPrice(leg.trainNo, leg.fromStationNo, leg.toStationNo, date, leg.seatTypes ?? '')` |

补充：价格已查询但解析结果为空 map 时，空结果不会写入 `prices`，按钮保持可用（可再次点击）。

---

## 4. 第 1/2 程余票行的完整拼装规则（卡片摘要 `.seat-list`）

源码：`TransferList.tsx:190-197`。

| 步骤 | 规则 | 说明 |
|---|---|---|
| 1 | 遍历 `Object.entries(leg.seats)` | 键为席别码 `ZE` / `ZY` / `SWZ` / `WZ` |
| 2 | `.filter(([, raw]) => raw && raw !== '--')` | **只**剔除空串与 `'--'`；`'无'` 保留；`'0'` 保留 |
| 3 | `entries.find(([code]) => code === 'ZE') ?? entries[0]` | **ZE（二等座）优先**；无 ZE 时取过滤后第一个（即解析顺序 `ZY → SWZ → WZ`） |
| 4 | `seatLabel(LEG_SEAT_NAMES[seat[0]] ?? seat[0], seat[1])` | 席别名映射见下表；未知码回退码本身 |
| 5 | 无可用席别 | 文案 `第{i+1}程 暂无余票信息`，class `seat-off` |
| 6 | 有可用席别 | 文案 `第{i+1}程 {label.text}`，class `seat-{label.state}` |

### 4.1 `seatLabel` 文案与状态（`view.ts:55-61`）

| 原始值 | 文案 | `state` | CSS 颜色 |
|---|---|---|---|
| 空串 / `'--'` | 不渲染（返回 `null`） | — | — |
| `'无'` | `{席别名} 无` | `off` | 次要色 |
| 纯数字 `N`（`/^\d+$/`） | `{席别名} {N} 张` | `on`（或 `hl`，但本页不传 highlight） | 绿色 |
| 其他任意非空值（`'有'` 等） | `{席别名} 有` | `on`（或 `hl`） | 绿色 |

### 4.2 `LEG_SEAT_NAMES` 映射（`view.ts:14-19`）

| 码 | 名称 |
|---|---|
| `ZE` | 二等座 |
| `ZY` | 一等座 |
| `SWZ` | 商务座 |
| `WZ` | 无座 |

注意：这是**余票码**映射，与价格表的 `SEAT_CODE_NAME`（`O`=二等座、`M`=一等座、`9`=商务座）不是同一套编码。

---

## 5. 价格展示的全部形态

### 5.1 卡片级参考价计算

```
key      = priceKey(leg.trainNo, leg.fromStationNo, leg.toStationNo)
         = `${trainNo}|${fromStationNo}|${toStationNo}`；任一缺失返回 null
legPrices = p.legs.map(leg => key ? prices[key]?.[REFERENCE_SEAT_CODE] : undefined)
total     = legPrices.length > 0 && legPrices.every(x => x != null)
          ? legPrices.reduce((a, b) => a + b, 0)
          : null
```

- `REFERENCE_SEAT_CODE = 'O'`（价格接口的二等座码，**不是**余票码 `ZE`）。
- 两程价格都拿到才出合计；只拿到一程、缺站序、未查价均不出合计。

### 5.2 三种状态的渲染

| 状态 | 卡片 `.ticket-actions` | 每程详情 |
|---|---|---|
| 未查 | `.muted` `展开两程查价` | `.leg-price-cta` + `查价` 按钮（可点） |
| 查询中 | `.muted` `展开两程查价`（**无 loading 提示**） | `查价` 按钮 `loading`（antd 转圈），仍可见 |
| 已查到（有价格） | `.ref-price`：`二等座参考价 ¥X` + `¥A + ¥B` | `.leg-price` 价格小表 |
| 查询失败 / 返回空 | 维持 `展开两程查价` | 仍显示 `查价` 按钮 |

### 5.3 参考价拼装规则

| 部分 | 模板 | 说明 |
|---|---|---|
| 前缀 | `二等座参考价 ` | 写死文案，不随席别变化 |
| 合计金额 | `{priceLabel(total)}` | 整数 `¥626`；非整数一位小数 `¥177.5` |
| 分解 | `{priceLabel(p1)} + {priceLabel(p2)}` | ` + ` 连接；按 `p.legs` 顺序 |
| 容器 | `.ref-price`（inline-flex，baseline 对齐，右对齐，可换行） | — |
| 合计 | `.total-price`（15px / 600 / 等宽数字） | — |
| 分解 | `.price-breakdown`（12px 次要色 / 等宽数字） | — |

`priceLabel`：`null` / 非有限数 → 空串。

### 5.4 每程价格小表排布

| 元素 | 内容 |
|---|---|
| 容器 | `.leg-price`（浅底 `--rail-panel`、1px 边框、12px 圆角、10px/12px 内边距、纵向 6px 间距） |
| 头部 | `.leg-price-head`：`{leg.trainCode} · {leg.fromStation} → {leg.toStation}` |
| 列表 | `.price-list`，`aria-label="各席别价格"`，CSS Grid |
| 行 | `.price-row`：两列网格 `minmax(0,1fr) auto`，行间顶部 1px 分隔线，首行无分隔线 |
| 席别名 | `.price-name`：`SEAT_CODE_NAME[code] ?? code`，13px 次要色 |
| 金额 | `.price-amount`：`priceLabel(price)`，14px / 600 / 右对齐 / 等宽数字 / 不换行 |
| 参考行 | `code === 'O'` 时追加 `.price-row--ref`：名称与金额均为蓝色加粗 |

### 5.5 固定席别序 `SEAT_PRICE_ORDER`（`view.ts:175-177`）

| 序号 | 码 | 名称 |
|---|---|---|
| 1 | `9` | 商务座 |
| 2 | `P` | 特等座 |
| 3 | `M` | 一等座 |
| 4 | `D` | 优选一等座 |
| 5 | `S` | 二等包座 |
| 6 | `6` | 高级软卧 |
| 7 | `I` | 一等卧 |
| 8 | `J` | 二等卧 |
| 9 | `F` | 动卧 |
| 10 | `A` | 高级动卧 |
| 11 | `4` | 软卧 |
| 12 | `3` | 硬卧 |
| 13 | `2` | 软座 |
| 14 | `1` | 硬座 |
| 15 | `WZ` | 无座 |
| 16 | `W` | 无座 |

- **未知码位置**：不在列表内的码统一排在**末尾**，并保持 `Object.entries` 原序（稳定排序），名称回退为码本身。
- 实际数据中几乎不出现未知码：`parsePrice` 已丢弃不在 `SEAT_CODE_NAME` 中的键，并把 `A9` / `A1` 这类前缀归一为 `9` / `1`。

---

## 6. 接驳面板（`ConnectionPanel.tsx`）

### 6.1 入口前置判定（`ConnectionEntry`）

| 条件 | 行为 |
|---|---|
| `p.sameStation === true` | 返回 `null`，整个接驳区不渲染 |
| `stationCodeOf(leg.toStation)` 或 `stationCodeOf(next.fromStation)` 返回 `null`，或 `leg`/`next` 缺失 | 降级分支 0 |
| 否则 | 渲染 `ConnectionPanel`，`key = `${fromCode}>${toCode}``，`waitMinutes = p.waitMinutes` |

### 6.2 全部降级分支

| # | 分支 | 结构 | 文案模板 |
|---|---|---|---|
| 0 | 站码反查失败（T62） | `.connection-panel` > `.muted` + `<Button size="small" disabled>查接驳</Button>` | `{leg?.toStation} → {next?.fromStation} · 未识别换乘站` |
| 1 | 未查询（`result === null`） | `.connection-panel` > `.muted` + `<Button size="small" loading={loading}>查接驳</Button>` | `{point.fromName} → {point.toName}` |
| 2 | 跨城（`kind === 'crossCity'`） | `<Tag color="default">跨城接驳</Tag>` + `.muted`，**无按钮** | `{fromName} → {toName}· 直线约 {Math.round(km)} 公里 · 不提供市内交通方案` |
| 3 | 缺坐标（`kind === 'noCoord'`） | `.muted` + `<Button size="small" disabled>查接驳</Button>` | `{fromName} → {toName}· 未获取到站点位置` |
| 4 | 正常（`kind === 'ok'`） | 见 §6.3 | 见 §6.3 |

注意分支 2、3 中 `header` 与后缀之间**没有空格**，实际渲染为 `南京南 → 南京· 直线约…`。

### 6.3 正常分支结构

#### a. `.connection-summary`

| 元素 | 文案 / 数据 |
|---|---|
| `.muted` > `.connection-pair` | `{point.fromName} → {point.toName}` |
| `<Space size={4} wrap>` 内 `<Tag>` | 每条 `ConnectionFlag` 的 `label`；颜色 `bad → error`、`risky → warning`、`info → default` |

#### b. 两类都空（`transit.kind === 'empty' && driving.kind === 'empty'`）

| 元素 | 文案 |
|---|---|
| `.muted` | `暂未获取到接驳方案（直线 {kmLabel(km * 1000)}）` |

#### c. `.connection-modes`（每侧一条，仅该侧 `kind === 'plan'` 时出现）

| 方式 | 渲染 |
|---|---|
| 公交 | `<strong>公交</strong>` + `<span>{durationLabel(分钟)} · {超\|余} {durationLabel(差值)}</span>` |
| 打车 | `<strong>打车</strong>` + `<span>{durationLabel(分钟)} · {超\|余} {durationLabel(差值)}</span>` |

余量算法：`margin = point.waitMinutes - plan.durationMinutes`；`margin < 0` → `超 {durationLabel(-margin)}`，否则 `余 {durationLabel(margin)}`。

#### d. `.connection-errors`（任一侧 `kind === 'error'`）

| 元素 | 文案 |
|---|---|
| 公交失败 | `.muted`：`公交：{transit.message}` |
| 打车失败 | `.muted`：`打车：{driving.message}` |
| 可重试 | `<Button size="small" loading={loading}>重试</Button>` |

可重试判定：`(transit.kind === 'error' && transit.retriable) || (driving.kind === 'error' && driving.retriable)`。
「一端报错」时：错误行、另一侧的 `.connection-mode` 摘要、展开详情按钮同时存在。

#### e. 展开开关（任一侧 `kind === 'plan'` 时出现）

| 状态 | 文案 |
|---|---|
| 收起 | `展开详情` |
| 展开 | `收起详情` |

#### f. `.connection-details`（展开后）

| 段 | 内容 |
|---|---|
| 公交标题 | `<strong>公共交通</strong>` + `.muted`：` {durationLabel} · {kmLabel(distanceMeters)} · 步行 {Math.round(walkMeters)} 米 · 换乘 {transfers} 次`，`fareFen != null` 时追加 ` · {priceLabel(fareFen / 100)}` |
| 公交线路 | `.connection-lines` 每条一行 `.connection-line`：`.connection-line-title` = `{l.title}`；`.muted` = `{l.geton} → {l.getoff}`，`stationCount != null` 时追加 ` · {n} 站` |
| 打车标题 | `<strong>打车</strong>` + `.muted`：` {durationLabel} · {kmLabel(distanceMeters)}`，`fare != null` 时追加 ` · {priceLabel(fare)}（路况估算）` |
| 过路费 | `tollYuan > 0` 时单独一行 `.muted`：`过路费 {priceLabel(tollYuan)}` |
| 直线距离 | 末尾固定 `.muted`：`两站直线 {kmLabel(km * 1000)}` |

#### g. 距离格式化 `kmLabel`

| 条件 | 输出 |
|---|---|
| `meters < 1000` | `{Math.round(meters)} 米` |
| `meters >= 1000` | `{(meters / 1000).toFixed(1)} 公里` |

跨城分支例外：直接用 `Math.round(km)` 给整公里，不带小数。

#### h. 失败原因文案（`classifyTencentStatus` 产出，经 `message` 渲染）

| 状态码类别 | 文案 | 可重试 |
|---|---|---|
| `retriable`（120/121/500/510/520/530/531/600） | `上游繁忙` | 是 |
| `unsupportedCity`（335） | `腾讯不支持该城市的公交查询` | 否 |
| `noResult`（327/328/329/344/347/387/393） | `无可达路线` | 否（归为 `empty`，不显示错误行） |
| `config`（110/111/112/113/190/199/311） | `接驳服务未配置` | 否 |
| `error`（326/365/366/373） | `站点位置异常` | 否 |
| 其他非 0 状态码 | `上游错误（{status}）` | 否 |
| 网络层 / Worker 失败 | `接驳查询失败`（或 Worker 返回的原文，含「未配置」时不可重试） | 默认是；含「未配置」则否 |

---

## 7. 全部标记的文案与颜色映射

### 7.1 `planFlags`（`view.ts:73-80`，顺序固定；颜色表在 `TransferList.tsx:98-103`）

| 顺序 | 文案 | kind | antd Tag color | 判定条件（`plans.ts:22-37`） |
|---|---|---|---|---|
| 1 | `低于换乘下限` | bad | `error` | `!sameTrain && waitMinutes < minWait`；`minWait = sameStation ? 15 : 60` |
| 2 | `换乘紧张` | risky | `warning` | `!sameTrain && minWait <= waitMinutes < 20`（异站时 `minWait = 60 > 20`，实际不会触发） |
| 3 | `超长等待` | long | `default` | `waitMinutes > 120` |
| 4 | `同车接续` | ok | `success` | `sameTrain === true` |

渲染位置：`.transfer-facts` 内 `<Space size={4} wrap>`，每个 `<Tag className="wrapping-tag" key={flag.label}>`。
「同车接续」在卡片上出现两次：`.train-identity > span` 与这里的 Tag。

### 7.2 `connectionFlags`（`connectionFlags.ts:51-83`）

| 顺序 | 文案 | kind | Tag color | 判定条件 |
|---|---|---|---|---|
| 0 | `跨城接驳` | info | `default` | `km > 50` 时短路返回，**只**返回这一条 |
| 1 | `接驳时间不足` | bad | `error` | `waitMinutes - fastest < 0` |
| 2 | `需打车` | risky | `warning` | 公交赶不上但打车赶得上：公交与打车方案都存在，`wait - transit.duration < 0` 且 `margin >= 0` |
| 3 | `接驳紧张` | risky | `warning` | 非上两者且 `margin < 20`（`RISK_WAIT_THRESHOLD`） |
| 4 | `无地铁` | info | `default` | 有公交方案且 `!transit.hasSubway` |
| 5 | `可能错过末班` | risky | `warning` | 公交线路最严重 `running_status === 301` |
| 6 | `首班未发` | risky | `warning` | 最严重 `running_status === 302` |
| 7 | `停运` | risky | `warning` | 最严重 `running_status === 303` |

说明：
- 严格计数是 8 条 label（1 条跨城 + 4 条时间/地铁 + 3 条运行状态）。
- 运行状态取所有线路中严重度最高者（`301 < 302 < 303`）；`300` 正常、无状态码均不标。
- `跨城接驳` 在 `ConnectionPanel` 中实际由分支 2 的硬编码 Tag 渲染（`crossCity` 提前 return，不会走到 flags 渲染）。
- 标记只用于展示，不删方案、不改排序（D12）。

---

## 8. 全部参与渲染的 CSS 类名及语义

来源：`web/styles.css`。仅列本通路实际会出现的类（直达通路独有类单列在 §8.2）。

### 8.1 本通路使用的类

| 类名 | 语义 / 关键样式 |
|---|---|
| `.results-title` | 结果区标题，20px / 600，上 24px 下 12px |
| `.muted` | 次要文字，13px，`--rail-secondary` |
| `.hub-list` | 枢纽折叠列表标识类；**CSS 中无对应规则**，仅作语义标记（与 `SelfBuiltList` 共用） |
| `.ticket-card` | 中转卡片，`margin-bottom: 12px`，无阴影，`min-width: 0` |
| `.ticket-caption` | 卡片顶部：起终点 + 总耗时，两端对齐、可换行，13px 次要色 |
| `.ticket-main` | 卡片主网格：`120px / minmax(190px,1.3fr) / minmax(150px,1fr) / minmax(100px,.8fr)`，gap 20px |
| `.train-identity` | 第 1 列：车次对（16px / 600）+ 接续方式（12px 次要色），纵向 6px |
| `.transfer-facts` | 第 3 列：换乘信息纵向堆叠，gap 6px |
| `.transfer-wait` | 换乘站 + 等待时长行，13px 次要色，可换行 |
| `.seat-list` | 余票标签横向换行容器，gap `6px 12px` |
| `.seat-label` | 单个余票标签，13px，可换行 |
| `.seat-on` | 有票，绿色 `--rail-green` |
| `.seat-hl` | 有票且高亮，绿色；**本通路不产生**（`seatLabel` 调用均未传 `highlight`） |
| `.seat-off` | 无票 / 无余票信息，次要色 |
| `.ticket-actions` | 第 4 列：价格区，右对齐、可换行，gap `6px 10px` |
| `.ref-price` | 参考价整体，inline-flex、baseline 对齐、右对齐、可换行 |
| `.total-price` | `二等座参考价 ¥X`，15px / 600 / 等宽数字 |
| `.price-breakdown` | `¥A + ¥B` 分解，12px 次要色 / 等宽数字 |
| `.journey-times` | 三栏时间网格：`1fr auto 1fr`，gap 10px |
| `.journey-end` | 单端（时刻 + 站名），纵向 3px；右端 `text-align: right` |
| `.journey-duration` | 中间历时 + 横线，最小 48px，12px 次要色，居中 |
| `.day-offset` | 跨天上标 `+N`，12px / 600 / 次要色 |
| `.wrapping-tag` | 允许换行的 antd Tag（始发/终到标注、方案标记），`white-space: normal` |
| `.journey-details` | 两程详情容器，顶部 1px 分隔线，上外边距 18px |
| `.journey-details summary` | 44px 最小高度、两端对齐、隐藏原生三角、蓝色 13px、`+` / `−` 指示 |
| `.transfer-legs` | 两程容器，纵向 gap 16px |
| `.transfer-leg` | 单程：`24px + 1fr` 两列，gap 10px |
| `.leg-index` | 圆形序号徽标，24×24，蓝色字、页面底色 |
| `.leg-content` | 单程内容网格，区域 `heading seats / times / price`，gap `10px 16px` |
| `.leg-heading` | 车次 + 始发/终到 Tag，横向换行，gap 6px |
| `.leg-tools` | 余票区（`grid-area: seats`） |
| `.leg-price` | 单程价格卡：浅底、1px 边框、12px 圆角、10px/12px 内边距、纵向 6px |
| `.leg-price-head` | 价格卡标题：`车次 · 上车站 → 下车站`，13px / 600 / 次要色 |
| `.leg-price-cta` | 查价按钮容器，右对齐 |
| `.price-list` | 价格小表网格容器 |
| `.price-row` | 一行两列 `1fr auto`，行间顶部 1px 分隔线（首行无），padding `5px 0` |
| `.price-row--ref` | 参考席别（`O` 二等座）行，名称与金额均蓝色加粗 |
| `.price-name` | 席别名，13px 次要色，可换行 |
| `.price-amount` | 金额，14px / 600 / 右对齐 / 等宽数字 / 不换行 |
| `.connection-panel` | 接驳面板根容器，13px，纵向 6px，上外边距 6px |
| `.connection-summary` | 站对 + 标记 Tag 一行，横向换行 |
| `.connection-pair` | 换乘站对文本，主文字色 `--rail-text` |
| `.connection-modes` | 公交 / 打车摘要一行，横向换行，gap `4px 14px` |
| `.connection-mode` | 单个方式：inline-flex，名称 + 耗时/余量，等宽数字 |
| `.connection-errors` | 错误原因 + 重试按钮，横向换行 |
| `.connection-details` | 展开详情容器，顶部 1px 分隔线，纵向 8px |
| `.connection-detail` | 单种方式的详情块，纵向 4px |
| `.connection-lines` | 公交线路列表，纵向 2px |
| `.connection-line` | 单条线路，横向换行，gap 6px |
| `.connection-line-title` | 线路名，500 字重 |
| `.app-shell` / `.app-header` | 页面外壳与页头（标题 28px、副标题 13px 次要色） |
| `.app-theme` | 主题根，定义 `--card-padding` 等 |

### 8.2 定义于样式表但本通路不渲染的类（避免验收误判）

| 类名 | 实际使用方 |
|---|---|
| `.price-item` | `TrainList.tsx`（直达） |
| `.leg-prices` / `.leg-price-code` | `SelfBuiltList.tsx`（自研通路） |
| `.ticket-note` | `TrainList.tsx` |
| `.buy-short-result` | `TrainList.tsx`（买短乘长） |
| `.train-list` | `TrainList.tsx` |
| `.results-toolbar` | `App.tsx` 自研通路工具栏 |
| `.hub-picker*` / `.hub-grid` / `.hub-card*` | `HubPicker.tsx`（D68 中间态） |

### 8.3 响应式断点影响

| 断点 | 变化 |
|---|---|
| `max-width: 959px` | `.ticket-main` 变三列 `100px / 1.3fr / 1fr`；`.ticket-actions` 跨 `grid-column: 2 / -1` |
| `max-width: 767px` | `.app-theme` 的 `--card-padding` 降为 16px；`.app-shell` padding 收窄并适配安全区；`.ticket-main` 变单列；`.ticket-actions` 左对齐；`.train-identity` 变横向两端对齐；`.leg-content` 单列，区域顺序 `heading → times → seats → price` |

### 8.4 CSS 变量

`--rail-page`、`--rail-surface`、`--rail-panel`、`--rail-line`、`--rail-text`、`--rail-secondary`、`--rail-blue`、`--rail-green`、`--card-padding`（默认 22px，≤767px 为 16px）。

---

## 9. 验收时需留意的渲染事实

| # | 事实 | 位置 |
|---|---|---|
| 1 | `sameStation` 只有一处文案（`同站` / `同城异站`），且无条件显示；同时控制接驳面板是否出现 | `TransferList.tsx:189`、`:61` |
| 2 | `sameTrain` 有两处文案：`.train-identity` 的 `同车接续` / `换乘一次`，以及 flags 里的 `同车接续` Tag | `TransferList.tsx:185`、`view.ts:78` |
| 3 | `viaTags` 只出现在展开详情的每程标题旁，摘要层不显示 | `TransferList.tsx:133` |
| 4 | 卡片摘要的跨天 `+N` 可能漏标：传给 `JourneyTimes` 的 `duration` 是 `durationLabel` 产物，无法匹配 `HH:MM` 正则，退化为「到达 < 发车」判断 | `TransferList.tsx:186`、`view.ts:137-144` |
| 5 | 枢纽面板自动展开逻辑会把**全部**枢纽并入 `activeKeys`，用户手动折叠的枢纽在新数据到达时会被重新展开（与代码注释描述不一致） | `TransferList.tsx:229-232` |
| 6 | `waitSeverity`（`view.ts:83`）有单测但无调用点，当前不参与渲染 | `web/lib/view.ts` |
| 7 | `seat-hl` 样式在本通路不可达（`seatLabel` 调用均未传 `highlight`） | `TransferList.tsx:120`、`:194` |
| 8 | 接驳分支 2、3 的站对与后缀之间无空格，渲染为 `A → B· 直线约…` | `ConnectionPanel.tsx:87`、`:97` |
| 9 | 卡片级「查询中」无专属形态，仍显示 `展开两程查价` | `TransferList.tsx:202-209` |
| 10 | 枢纽面板标题的 `{n} 个方案` 统计的是车次组合数（`PlanGroup` 数），不是行程条数 | `TransferList.tsx:255` |
