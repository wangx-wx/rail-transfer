# 自研中转通路 UI 信息盘点（改版验收清单）

> 用途：UI 改版时逐条对照，确保不丢信息。
> 盘点范围：`自研中转` 按钮触发的完整交互链（阶段一枢纽选择 + 阶段二方案列表）。
> 依据源码（截至 2026-10-21 main 分支）：
> `web/App.tsx`、`web/components/HubPicker.tsx`、`web/components/SelfBuiltList.tsx`、
> `web/components/JourneyTimes.tsx`、`web/components/ConnectionPanel.tsx`、
> `web/components/StatusBar.tsx`、`web/lib/journeyView.ts`、`web/lib/journeys.ts`、
> `web/lib/selfbuilt.ts`、`web/lib/selfbuilt-query.ts`、`web/lib/selfbuilt-adapter.ts`、
> `web/lib/view.ts`、`web/lib/parse.ts`、`web/lib/detour.ts`、`web/styles.css`、
> `shared/types.ts`、`shared/constants.ts`。

---

## 0. 交互总览（视图状态机）

| 视图 | 触发 | 渲染 |
|---|---|---|
| `idle` | 初始 / HubPicker 点「返回」 | 无结果区（标题也不显示） |
| `hubs` | 点「自研中转」按钮 → `onSelfBuilt` | 标题「选择中转枢纽」+ `HubPicker` |
| `selfbuilt` | HubPicker 点「查询」→ `runSelfBuilt` | 标题「自研中转方案」+ 工具栏 + `SelfBuiltList` |

`App.tsx` 中的 `View = 'idle' | 'direct' | 'transfer' | 'selfbuilt' | 'hubs'`。

---

## 1. 页面级容器（App.tsx）

| # | 位置 | 信息 | 文案模板 | 数据来源 | 显示条件 |
|---|---|---|---|---|---|
| 1.1 | `<h2 class="results-title">` | 页面标题 | `选择中转枢纽`（`view === 'hubs'`）/ `自研中转方案`（`view === 'selfbuilt'`） | `view` | `view !== 'idle'` |
| 1.2 | `StatusBar`（`hubs` 视图） | 阶段一状态 | `候选枢纽（离线计算，未发起任何请求）` | `setStatus` in `onSelfBuilt` | 始终（info 态） |
| 1.3 | `StatusBar`（`selfbuilt` 视图，查询中） | 查询中状态 | `正在自研枚举中转…` | `runSelfBuilt` | 查询进行中 |
| 1.4 | `StatusBar`（`selfbuilt` 视图，完成） | 结果摘要 | `自研中转 {n} 条方案（经 {m} 个枢纽，扩展 {k} 条边）` | `r.journeys.length` / `r.hubs.length` / `r.edges` | 查询完成 |
| 1.5 | `StatusBar`（错误） | 查询出错 | `自研查询出错：{e}` | `catch (e)` | 抛错时（error 态，Alert） |
| 1.6 | `StatusBar`（取消） | 用户取消确认弹窗 | `已取消自研查询` | `runSelfBuilt` 中 `if (!ok)` 分支 | 弹窗点「取消」 |
| 1.7 | `.results-toolbar` | 工具栏按钮 | `重新选择枢纽`（`Button type="link"`） | `onClick`：清空 `journeys` + `setView('hubs')` | `view === 'selfbuilt'` |
| 1.8 | `Modal.confirm` | 请求量确认标题 | `请求量较大，确认发起？` | 硬编码 | `est.seconds >= 15` |
| 1.9 | `Modal.confirm` | 请求量确认正文 | `预计向 12306 发起约 {requests} 次请求（{hubs} 个枢纽），约需 {seconds} 秒。不含后续查价。` | `estimateSelfBuiltRequests()` → `RequestEstimate { hubs, requests, seconds, maxTransfers }` | 同上 |
| 1.10 | `Modal.confirm` | 确认按钮 | `继续` / `取消` | 硬编码 `okText` / `cancelText` | 同上 |

`StatusBar` 渲染规则：`kind === 'info'` → 纯文本 `<div class="query-status">`；`warn` / `error` → antd `Alert`（`type="warning"` / `"error"`，`showIcon`，`marginBottom: 12`）。

---

## 2. 阶段一「选择中转枢纽」页（HubPicker.tsx）

### 2.1 候选非空

| # | 位置 | 信息 | 文案模板 | 数据来源 | 显示条件 |
|---|---|---|---|---|---|
| 2.1.1 | `.hub-picker-hint` | 操作说明 | `选择中转城市（已选 {n}/2）：选 1 个 = 一次换乘；选 2 个 = 二次换乘（会一并给出经单个城市的方案）。` | 常量 `MAX_PICK = 2` | 始终 |
| 2.1.2 | `.hub-picker-hint > strong` | 已选计数（正文色、等宽数字） | `{selected.length}/2` | `selected: string[]` | 始终 |
| 2.1.3 | `.hub-card` | 候选城市名 | `{c.city}` | `HubCandidate.city`（= `cityOf(站码)`） | 每个候选一张卡 |
| 2.1.4 | `.hub-card-ratio` | 绕行比值 | `{ratio.toFixed(2)}`；`ratio == null` → `—` | `HubCandidate.ratio`（`detourRatio(coords, fromCity, toCity, city)`；缺坐标为 `null`） | 每个候选 |
| 2.1.5 | `.hub-card-ratio` 的 `title` | 悬停提示 | `绕行比值` | 硬编码 | 每个候选 |
| 2.1.6 | `.hub-card--on` + `aria-pressed` | 选中态 | 类名切换 + `aria-pressed="true"` | `picked.has(c.code)` | 已选中 |
| 2.1.7 | `.hub-card` `disabled` + `title` | 满员禁用 | `title="最多选 2 个"` | `full && !on`（`full = selected.length >= 2`） | 已选满 2 个且该卡未选中 |
| 2.1.8 | `.hub-picker-actions` | 查询按钮 | `查询`（primary） | `disabled={!selected.length}`、`loading={running}`、`onClick={onRun}` | 始终 |
| 2.1.9 | `.hub-picker-actions` | 返回按钮 | `返回` | `onClick={onCancel}` | 始终 |

约束（源码注释明确）：
- 卡片**只显示城市名，不显示站名**——`code` 是城市代表站，上游会展开全城，写站名会与结果实际站对不上。
- **不显示选中顺序号**——选中顺序对 `planJourneys` 无影响（两个方向都会探索）。
- 已选计数用 `<strong>` 加粗，比值用 `.hub-card-ratio`（次要色）。

### 2.2 候选为空

| # | 位置 | 信息 | 文案 | 组件 | 显示条件 |
|---|---|---|---|---|---|
| 2.2.1 | `.hub-picker` | 空态说明 | `没有合适的候选枢纽，建议改用『查中转』` | antd `Empty` | `candidates.length === 0` |
| 2.2.2 | `.hub-picker-actions` | 返回按钮 | `返回` | `Button` | 同上 |

**候选为空时没有「查询」按钮**（整块提前 return，只渲染 Empty + 返回）。

---

## 3. 阶段二「自研中转方案」页的层级结构（SelfBuiltList.tsx）

```
SelfBuiltList
├─ journeys 为空 → <Empty description="没有自研中转方案" />
└─ 非空
   ├─ .list-toolbar
   │   └─ <Segmented size="small">
   │        综合推荐（weighted） | 按总耗时（time）
   └─ <Collapse class="hub-list" defaultActiveKey={所有分组的 transfers}>
        └─ 每个分组（按 transfersCount 升序）
            ├─ 组头：<Space>{journeyTitle(transfers)} <Tag>{n} 条</Tag></Space>
            ├─ JourneyCard × min(5, n)      ← TOP_PER_GROUP = 5
            └─ <Button type="link" block>
                 未展开 → 展开更多（还有 {rest} 条）
                 已展开 → 收起
```

| # | 层级 | 信息 | 文案模板 / 取值 | 数据来源 | 显示条件 |
|---|---|---|---|---|---|
| 3.1 | 空态 | 无方案提示 | `没有自研中转方案` | antd `Empty` | `journeys.length === 0` |
| 3.2 | 工具栏 | 排序切换控件 | Segmented，两项：`综合推荐`（`weighted`，默认）/ `按总耗时`（`time`） | 组件内 `useState<SortMode>('weighted')` | 非空时 |
| 3.3 | 分组容器 | 折叠面板 | antd `Collapse`，`className="hub-list"` | `groups = groupByTransfers(sorted)` | 非空时 |
| 3.4 | 分组默认展开 | 全部组默认展开 | `defaultActiveKey={groups.map(g => String(g.transfers))}` | 分组结果 | 挂载时 |
| 3.5 | 组头 | 分组标题 | `一次换乘`（1）/ `两次换乘`（2）/ `{n} 次换乘`（其他） | `journeyTitle(g.transfers)`，映射表 `CN` | 每组 |
| 3.6 | 组头 | 条数标签 | `{n} 条`（antd `Tag`） | `g.journeys.length` | 每组 |
| 3.7 | 组内 | 卡片 | 默认只渲染前 5 条 | `TOP_PER_GROUP = 5` | 每组 |
| 3.8 | 组内底部 | 展开/收起按钮 | `展开更多（还有 {rest} 条）` / `收起` | `rest = g.journeys.length - visible.length`；`open = expanded.has(gkey)` | `rest > 0 || open` |

排序与分组规则（纯函数，已有单测）：

| 函数 | 文件 | 规则 |
|---|---|---|
| `sortJourneys(js, { mode })` | `web/lib/journeys.ts` | `time`：按 `totalMinutes` 升序；`weighted`：按 `totalMinutes + transfers×45 + (detour ? 60 : 0)` 升序（`TRANSFER_PENALTY_MINUTES = 45`、`DETOUR_PENALTY_MINUTES = 60`） |
| `groupByTransfers(js)` | `web/lib/journeyView.ts` | `Map<transfersCount>` 收集（组内保持传入顺序），组间按换乘次数升序 |
| 展开状态 | `SelfBuiltList` | `useState<Set<string>>`，键 = `String(transfers)`；**零请求**，数据已在内存 |

---

## 4. 单张自研行程卡片（JourneyCard）从上到下

外层容器：
```tsx
<Card className="ticket-card" size="small" variant="borderless"
      styles={{ body: { padding: 'var(--card-padding, 20px)' } }}>
```

### 4.1 `.ticket-caption`（卡片头部，两端对齐，13px 次要色）

| # | 信息 | 文案模板 | 数据来源 | 显示条件 |
|---|---|---|---|---|
| 4.1.1 | 起点 → 终点 | `{name(first.fromStation)} → {name(last.toStation)}` | `j.legs[0].fromStation`、`j.legs[len-1].toStation`；`name(code) = stationNames[code] ?? code`，`stationNames = STATION_NAMES`（3404 站） | 始终 |
| 4.1.2 | 总耗时 | `总耗时 {durationLabel(j.totalMinutes)}` | `ScoredJourney.totalMinutes`（各程历时之和 + 各换乘等待之和，`journeyFlags` 计算） | 始终 |

`durationLabel(minutes)`：`< 60` → `{m}分`；整点 → `{h}时`；否则 `{h}时{m}分`；`null`/非有限/负数 → 空串。

### 4.2 `.ticket-main`（4 列网格：`120px / minmax(190px,1.3fr) / minmax(150px,1fr) / minmax(100px,.8fr)`）

#### ① `.train-identity` —— 车次链

| # | 信息 | 文案模板 | 数据来源 | 显示条件 |
|---|---|---|---|---|
| 4.2.1 | 车次链（单行 `<strong>`，16px 600） | `{legs.map(l => l.trainCode).join(' → ')}`，如 `G1 → G2`、`G1 → G2 → G3` | `ScoredJourney.legs[].trainCode`（`Train.trainCode`） | 始终 |

**注意**：自研卡片的 `.train-identity` **只有一行**；官方卡片在此处还有第二行 `<span>`（`同车接续` / `换乘一次`），自研没有。

#### ② `JourneyTimes`（行程时间条）

| # | 信息 | 结构 / 文案 | 数据来源 | 显示条件 |
|---|---|---|---|---|
| 4.2.2 | 发车时刻 | `<strong>{startTime}</strong>`（27px 600，等宽数字） | `first.startTime`（首程发车） | 始终 |
| 4.2.3 | 出发站名 | `<span>{name(first.fromStation)}</span>`（13px 次要色） | `legs[0].fromStation` | 始终 |
| 4.2.4 | 历时 | `<span aria-label="历时">{durationLabel(j.totalMinutes)}</span>` + 下方横线 `<i aria-hidden>` | `j.totalMinutes` | 始终 |
| 4.2.5 | 到达时刻 | `<strong>{arriveTime}<sup class="day-offset" aria-label="跨{days}天">+{days}</sup></strong>` | `last.arriveTime`；`days = dayOffset(first.startTime, last.arriveTime, durationLabel(j.totalMinutes))` | 时刻始终；`+N` 仅 `days > 0` |
| 4.2.6 | 到达站名 | `<span>{name(last.toStation)}</span>`，右对齐 | `legs[len-1].toStation` | 始终 |
| 4.2.7 | 无障碍 | `role="group" aria-label="行程时间"` | 硬编码 | 始终 |

⚠️ 已知缺陷（供改版注意）：`duration` 传的是格式化后的 `5时10分`，`dayOffset` 的历时正则 `^\d{1,3}:\d{2}$` 无法命中，退化为「到达 < 发车 → +1 天」。跨 2 天以上的行程只会显示 `+1`。

#### ③ `.transfer-facts` —— 换乘事实（详见第 5 节）

#### ④ 标记区（`<Space size={4} wrap>`）

| # | 标记 | Tag 颜色 | 数据来源 | 判定（`journeyFlags` / `detour.ts`） | 显示条件 |
|---|---|---|---|---|---|
| 4.2.8 | `疑似绕远` | `warning` | `j.detour` | `totalMinutes > 同查询最优 × DETOUR_RATIO(1.5)`（`isDetour`，只标记不删除） | `j.detour` |
| 4.2.9 | `超长等待` | 默认（无 color） | `j.longWait` | 任一换乘 `waitMinutes > LONG_WAIT_THRESHOLD(120)` | `j.longWait` |
| 4.2.10 | `换乘紧张` | `warning` | `j.risky` | 任一换乘 `waitMinutes >= 下限(15/60)` 且 `< RISK_WAIT_THRESHOLD(20)` | `j.risky` |

顺序固定：绕远 → 超长等待 → 换乘紧张。整体容器条件：`j.detour || j.longWait || j.risky`。
**没有**「低于换乘下限」标记——低于下限的行程在 `connectLegs` 阶段已被剪掉（`belowMin` 仅存在于 `JourneyStats`）。

#### ⑤ `.ticket-actions` —— 参考价区（详见第 7 节）

| # | 状态 | 文案模板 | 数据来源 |
|---|---|---|---|
| 4.2.11 | 全部程已查到二等座价 | `二等座参考价 {priceLabel(total)}` + 分解 `{priceLabel(p1)} + {priceLabel(p2)}` | `prices[priceKey(...)]['O']` 求和 |
| 4.2.12 | 否则 | `展开两程查价`（muted） | 硬编码（三程行程文案仍是「两程」） |

### 4.3 余票：自研卡片**当前不渲染任何余票**（重点结论）

| 问题 | 结论 | 证据 |
|---|---|---|
| `SelfBuiltList.tsx` 是否读取 `Train.seats`？ | **否**。全文件无 `seats` 引用（`grep -n "seats" web/components/SelfBuiltList.tsx` 无结果） | `SelfBuiltList.tsx` 全文 |
| `Train.seats` 在自研链路里是否被填充？ | **否，恒为空数组**。自研取数走 `parseLeftTicket(r.data, { lite: true })` → `parseTrainRowLite()`，该函数显式 `seats: []`，注释写明「自研中转只用 trainNo / 站码 / 时刻 / 历时，从不读 seats」 | `web/lib/selfbuilt-adapter.ts:35`、`web/lib/parse.ts:63-82` |
| 自研链路是否读 `seatTypes`？ | **是**（查价需要）。`parseTrainRowLite` 保留了 `seatTypes: f[COL.seatTypes]`，用于 `onQueryPrice(..., l.seatTypes)` | `parse.ts:80` |
| 官方中转卡片是否有余票？ | **有**。`TransferLeg.seats` 来自 `fullList` 的 `ze_num/zy_num/swz_num/wz_num`，官方卡片渲染「第1程 …」行 | `TransferList.tsx:190-197`、`parse.ts:128-133` |
| 直达卡片是否有余票？ | **有**。`parseTrainRow` 构造 8 个 `SeatAvailability`，`TrainList` 渲染 `.seat-list` | `parse.ts:26-35`、`TrainList.tsx:118-139` |

**含义**：自研通路要补余票，必须同时改两处——① `selfbuilt-adapter.ts` 改用 `parseTrainRow`（非 lite）；② `SelfBuiltList` 增加余票行。仅改 UI 拿不到数据（`seats` 恒为 `[]`）。代价是解析量上升（单次查询数万趟车 × 8 个席别对象）。

---

## 5. `transfers` 数组的渲染（每个换乘点一行）

`ScoredJourney.transfers: JourneyTransfer[]`，长度 = `legs.length - 1`。类型定义：

| 字段 | 含义 | 来源（`connectLegs`） |
|---|---|---|
| `station` | 换乘站码（**上一程的到达站**） | `prev.toStation` |
| `toStation` | 下一程出发站码（同城异站时 ≠ `station`，T61） | `next.fromStation` |
| `waitMinutes` | 换乘等待（分钟） | `next.startTime - 上一程绝对到达时刻` |
| `sameStation` | 是否同站换乘 | `prev.toStation === next.fromStation` |

渲染结构：`j.transfers.map((t, i) => <div class="transfer-wait" key={`${t.station}-${i}`}> ... </div>)`，包在 `.transfer-facts` 内。

| # | 信息 | 文案模板 / 结构 | 数据来源 | 显示条件 |
|---|---|---|---|---|
| 5.1 | 换乘站 | `换乘 {name(t.station)}` | `t.station` | 每个换乘点 |
| 5.2 | 等待时长 | `　等待 {durationLabel(t.waitMinutes)}`（全角空格，与 5.1 同一行） | `t.waitMinutes` | 每个换乘点 |
| 5.3 | 同站/异站标记 | `<span class="muted">同站</span>` / `<span class="muted">同城异站</span>` | `t.sameStation` | 每个换乘点 |
| 5.4 | 接驳面板 | `<ConnectionPanel point={...} result={...} loading={...} onQuery={...} />` | 见第 6 节 | **仅 `!t.sameStation`**（同城异站） |

要点：
- **行内只报到达站**（`t.station`）；「到达站 → 下一程出发站」由接驳面板的 `.connection-pair` 说清（源码注释：两条通路一致）。
- 2 次换乘 = 2 个 `.transfer-wait` 行，每行各自独立带接驳入口（最多 2 个接驳面板）。
- 键 `key = \`${t.station}-${i}\``（站码 + 下标）。
- `.transfer-facts` 是 `display: grid; gap: 6px`。

---

## 6. 接驳面板（ConnectionPanel）在自研通路的接入点与传参

### 6.1 接入点与传参

| # | 项 | 自研取值 |
|---|---|---|
| 6.1.1 | 接入位置 | `SelfBuiltList.tsx:118-133`，嵌在每个 `.transfer-wait` 内 |
| 6.1.2 | 渲染条件 | `!t.sameStation`（同城异站） |
| 6.1.3 | `point.fromName` | `name(t.station)`（上一程到达站名） |
| 6.1.4 | `point.toName` | `name(t.toStation)`（下一程出发站名） |
| 6.1.5 | `point.fromCode` | `t.station`（直接来自算法，无需反查） |
| 6.1.6 | `point.toCode` | `t.toStation` |
| 6.1.7 | `point.waitMinutes` | `t.waitMinutes` |
| 6.1.8 | `result` | `connections?.[\`${t.station}>${t.toStation}\`] ?? null` |
| 6.1.9 | `loading` | `loadingConnection?.has(key) ?? false` |
| 6.1.10 | `onQuery` | `onQueryConnection?.(t.station, t.toStation, t.waitMinutes)` |

### 6.2 与官方通路的差异

| 维度 | 自研（SelfBuiltList） | 官方（TransferList `ConnectionEntry`） |
|---|---|---|
| 站码来源 | 直接取 `JourneyTransfer.station` / `.toStation` | 站名反查 `stationCodeOf(leg.toStation)`（`codeOfStation(name)?.code`） |
| 反查失败 | 不存在此分支 | 渲染 `{到达站} → {出发站} · 未识别换乘站`（muted）+ 禁用「查接驳」按钮 |
| 渲染位置 | 嵌在换乘行 `.transfer-wait` 内，紧跟同站/异站标记 | `.transfer-facts` 内独立一行，位于标记 Tag 之后 |
| 数量 | 每换乘点一个（最多 2 个） | 每方案固定 1 个 |
| 等待值来源 | `t.waitMinutes`（逐换乘点） | `p.waitMinutes`（方案级） |
| 组件 | 同一个 `ConnectionPanel` | 同一个 `ConnectionPanel` |

### 6.3 ConnectionPanel 自身渲染的全部形态（两通路一致）

| # | 分支 | 渲染 |
|---|---|---|
| 6.3.1 | 未查（`result === null`） | `<span class="muted">{from} → {to}</span>` + `Button size="small"` 文案 `查接驳`（`loading` 控制转圈） |
| 6.3.2 | 跨城（`kind === 'crossCity'`，`km > CROSS_CITY_KM(50)`） | `Tag color="default"` 文案 `跨城接驳` + `<span class="muted">{from} → {to}· 直线约 {Math.round(km)} 公里 · 不提供市内交通方案</span>`（无按钮） |
| 6.3.3 | 缺坐标（`kind === 'noCoord'`） | `<span class="muted">{from} → {to}· 未获取到站点位置</span>` + 禁用 `查接驳` 按钮 |
| 6.3.4 | 已查摘要行 | `.connection-summary`：`<span class="muted">{from} → {to}</span>` + `<Space size={4} wrap>` 标记 Tag |
| 6.3.5 | 接驳标记 Tag | `接驳时间不足`（error）/ `需打车`（warning）/ `接驳紧张`（warning）/ `无地铁`（default）/ `可能错过末班`·`首班未发`·`停运`（warning）；来自 `connectionFlags()` |
| 6.3.6 | 公交与打车都无方案 | `<div class="muted">暂未获取到接驳方案（直线 {kmLabel(km*1000)}）</div>` |
| 6.3.7 | 方式行（公交） | `.connection-mode`：`<strong>公交</strong>` + `{durationLabel(minutes)} · 余 {X}` 或 `· 超 {X}`（`summaryText`，`margin = waitMinutes - minutes`） |
| 6.3.8 | 方式行（打车） | `.connection-mode`：`<strong>打车</strong>` + 同上格式 |
| 6.3.9 | 错误行 | `.connection-errors`：`公交：{message}` / `打车：{message}`（muted）；`retriable` 时给 `重试` 按钮 |
| 6.3.10 | 展开按钮 | `Button type="link" size="small"`：`展开详情` / `收起详情`（任一方式有方案时显示） |
| 6.3.11 | 公交详情头 | `<strong>公共交通</strong>` + `{耗时} · {距离} · 步行 {N} 米 · 换乘 {N} 次 · ¥{票价}`（票价仅在 `fareFen != null` 时出现） |
| 6.3.12 | 公交逐段明细 | `.connection-lines` → `.connection-line`：`{线路名}` + `{上车站} → {下车站} · {N} 站`（站数仅在 `stationCount != null` 时） |
| 6.3.13 | 打车详情头 | `<strong>打车</strong>` + `{耗时} · {距离}` + `· ¥{价}（路况估算）`（仅在 `fare != null`） |
| 6.3.14 | 过路费 | `<div class="muted">过路费 ¥{tollYuan}</div>`（仅 `tollYuan > 0`） |
| 6.3.15 | 直线距离 | `<div class="muted">两站直线 {kmLabel(km*1000)}</div>`（详情区末尾） |

辅助格式化：
- `kmLabel(meters)`：`< 1000` → `{N} 米`；否则 `{(m/1000).toFixed(1)} 公里`。
- `yuanOfFen(fen)`：`fen / 100`（上游公交票价单位为分）。
- `summaryText`：`margin < 0` → `超 {durationLabel(-margin)}`，否则 `余 {durationLabel(margin)}`。
- 面板内部展开状态：`useState(false)`，本地状态，不跨卡片共享。

---

## 7. 价格展示的全部形态

### 7.1 卡片头参考价（`.ticket-actions`）

| # | 阶段 | 渲染 | 条件 |
|---|---|---|---|
| 7.1.1 | 未查 | `<span class="muted">展开两程查价</span>` | `total == null` |
| 7.1.2 | 部分程已查 | 同上（仍显示「展开两程查价」） | `legPrices.every(x => x != null)` 为假 |
| 7.1.3 | 全部程已查 | `<span class="ref-price"><strong class="total-price">二等座参考价 {priceLabel(total)}</strong><span class="price-breakdown">{priceLabel(p1)} + {priceLabel(p2)}</span></span>` | `legPrices.length > 0 && every != null` |
| 7.1.4 | 查询中 | **卡片头无 loading 指示**（只有详情内按钮转圈） | — |
| 7.1.5 | 查价失败/返回空 | 不写入 `prices`，按钮静默恢复为普通态，**无任何错误提示** | — |

计算：
```ts
const legPrices = j.legs.map(l => {
  const key = priceKey(l.trainNo, l.fromStationNo, l.toStationNo);
  return key ? prices[key]?.[REFERENCE_SEAT_CODE] : undefined;
});
const total = legPrices.length > 0 && legPrices.every(x => x != null)
  ? legPrices.reduce((a, b) => a! + b!, 0) : null;
```
- `REFERENCE_SEAT_CODE = 'O'`（**价格接口**的二等座码，非界面码 `ZE`）。
- `priceKey(trainNo, fromStationNo, toStationNo)` = `\`${trainNo}|${fromStationNo}|${toStationNo}\``；任一项缺失返回 `null`（无法查价）。
- 接驳费用**不并入**参考价（D72）。

### 7.2 详情内每程价格块（`.leg-prices > .leg-price`）

| # | 阶段 | 渲染 | 条件 |
|---|---|---|---|
| 7.2.1 | 已查到 | `.price-list`（`aria-label="{trainCode} 各席别价格"`）→ 每席别一行 `.price-row`：`.price-name`（席别名）+ `.price-amount`（价格） | `seatPrices(map).length > 0` |
| 7.2.2 | 二等座行高亮 | `.price-row.price-row--ref`（蓝色 + 600） | `p.code === REFERENCE_SEAT_CODE` |
| 7.2.3 | 未查 | `Button type="link"` 文案 `{trainCode} 查价` | 无价格 |
| 7.2.4 | 查询中 | 同上按钮 `loading={loadingPrice.has(key)}` | 键在 `loadingPrice` 中 |
| 7.2.5 | 无法查价 | 同上按钮 `disabled={!key || !l.seatTypes}` | 缺站序或缺席别码串 |
| 7.2.6 | 每块标题 | `.leg-price-code`：仅 `{l.trainCode}`（**无上下车站**） | 始终 |

### 7.3 格式化规则

| 函数 | 规则 |
|---|---|
| `priceLabel(price)` | `null` / 非有限 → `''`；整数 → `¥626`；非整数 → `¥177.5`（保留一位） |
| `seatPrices(map)` | 按 `SEAT_PRICE_ORDER = ['9','P','M','D','S','O','6','I','J','F','A','4','3','2','1','WZ','W']` 固定排序；表外未知码排末尾；席别名取 `SEAT_CODE_NAME[code] ?? code` |
| `SEAT_CODE_NAME` | `9`商务座 / `P`特等座 / `M`一等座 / `O`二等座 / `D`优选一等座 / `S`二等包座 / `6`高级软卧 / `I`一等卧 / `J`二等卧 / `4`软卧 / `3`硬卧 / `F`动卧 / `A`高级动卧 / `2`软座 / `1`硬座 / `H`其他 / `WZ`·`W`无座 |

---

## 8. 展开详情区（`<details class="journey-details">`）

| # | 层级 | 信息 | 文案 / 结构 | 数据来源 | 显示条件 |
|---|---|---|---|---|---|
| 8.1 | `summary` | 折叠条文字 | `完整行程` | 硬编码 | 始终 |
| 8.2 | `summary::after` | 展开指示符 | `+`（收起时）/ `−`（`[open]` 时） | CSS `content` | 始终 |
| 8.3 | `.transfer-legs` | 各程容器 | `j.legs.map((l, i) => <Leg no={i+1} />)` | `legs` | 始终 |
| 8.4 | `.leg-index` | 圆形序号 | `{i + 1}` | 数组下标 | 每程 |
| 8.5 | `.leg-heading` | 车次 | `<strong>{train.trainCode}</strong>` | `Train.trainCode` | 每程 |
| 8.6 | `JourneyTimes` | 上车站名 | `{name(train.fromStation)}` | `Train.fromStation` | 每程 |
| 8.7 | `JourneyTimes` | 下车站名 | `{name(train.toStation)}` | `Train.toStation` | 每程 |
| 8.8 | `JourneyTimes` | 发车时刻 | `{train.startTime}` | `Train.startTime` | 每程 |
| 8.9 | `JourneyTimes` | 到达时刻 + 跨天 | `{train.arriveTime}` + `+N` | `Train.arriveTime` + `dayOffset(startTime, arriveTime, duration)` | 每程；`+N` 仅 `days > 0` |
| 8.10 | `JourneyTimes` | 历时 | `{train.duration}`（原始 `HH:MM`） | `Train.duration` | 每程 |
| 8.11 | `.leg-prices` | 价格块容器 | auto-fit 网格（`minmax(200px, 1fr)`） | `legs.map` | 始终 |
| 8.12 | `.leg-price-code` | 车次号 | `{l.trainCode}` | `Train.trainCode` | 每程 |
| 8.13 | `.price-list` | 席别价格小表 | 见 7.2 | `seatPrices(prices[key])` | 已查到 |
| 8.14 | `.leg-price` 查价按钮 | 查价 | `{trainCode} 查价` | `onQueryPrice(trainNo, fromStationNo, toStationNo, date, seatTypes)` | 未查到 |

**详情内每程不渲染**：余票列表（官方有 `.leg-tools > .seat-list`）、始发/终到标注（`viaTags`）、价格嵌在 `.leg-content` 内（自研价格在 `.leg-prices` 独立块）。

⚠️ `.leg-content` 的 CSS grid 定义了 `heading / seats / times / price` 四个区域，但自研 Leg 只用 `heading` + `times`，`seats` / `price` 区域空置。

---

## 9. 全部 CSS 类名及语义

### 9.1 SelfBuiltList 子树

| 类名 | 语义 | styles.css 定义 |
|---|---|---|
| `list-toolbar` | 排序切换条容器 | **无定义**（仅挂载点） |
| `hub-list` | 分组 Collapse 类名（与官方同名） | **无定义**（官方靠 `ghost` 属性区分外观） |
| `ticket-card` | 行程卡片：`margin-bottom: 12px`、无阴影 | ✓ |
| `ticket-caption` | 卡片头：起终点 + 总耗时；两端对齐、13px 次要色 | ✓ |
| `ticket-main` | 4 列主网格 | ✓ |
| `train-identity` | 车次链容器（`display: grid; gap: 6px`） | ✓ |
| `journey-times` | 时刻条 3 列网格（发车 / 历时 / 到达） | ✓ |
| `journey-end` | 一端：时刻 + 站名；最后一个 `text-align: right` | ✓ |
| `journey-duration` | 中间历时文字 + 下方横线 | ✓ |
| `day-offset` | 跨天上标 `+N`（12px 600 次要色） | ✓ |
| `transfer-facts` | 换乘事实列表（`display: grid; gap: 6px`） | ✓ |
| `transfer-wait` | 单个换乘行（13px 次要色） | ✓ |
| `muted` | 次要文字（同站/异站、占位提示、接驳详情） | ✓ |
| `ticket-actions` | 卡片右下价格区（右对齐、可换行） | ✓ |
| `ref-price` | 参考价行（inline-flex，基线对齐，右对齐） | ✓ |
| `total-price` | 参考价主数字（15px 600，等宽数字） | ✓ |
| `price-breakdown` | 价格分解 `¥a + ¥b`（12px 次要色） | ✓ |
| `journey-details` | 详情 `<details>`：上边框 + `margin-top: 18px` | ✓ |
| `transfer-legs` | 各程容器（`grid; gap: 16px`） | ✓ |
| `transfer-leg` | 单程：24px 序号列 + 内容列 | ✓ |
| `leg-index` | 圆形序号徽标（24px，蓝字浅底） | ✓ |
| `leg-content` | 单程内容网格（`heading / seats / times / price` 区域） | ✓ |
| `leg-heading` | 车次标题行（flex wrap） | ✓ |
| `leg-prices` | 多程价格块容器（auto-fit ≥200px） | ✓ |
| `leg-price` | 单程价格卡（浅底 + 边框 + 圆角 12px） | ✓ |
| `leg-price-code` | 价格卡顶部车次号（13px 600 次要色） | ✓ |
| `price-list` | 席别价格小表（`display: grid`） | ✓ |
| `price-row` | 一行「席别名 / 价格」，行间上分隔线 | ✓ |
| `price-row--ref` | 二等座参考行高亮（蓝色 + 600） | ✓ |
| `price-name` | 席别名（13px 次要色） | ✓ |
| `price-amount` | 价格数字（右对齐、600、等宽数字） | ✓ |
| `connection-panel` | 接驳面板容器（`grid; gap: 6px`） | ✓ |
| `connection-summary` | 接驳摘要行（flex wrap） | ✓ |
| `connection-pair` | 站对 `A → B`（正文色） | ✓ |
| `connection-modes` | 公交/打车方式行容器 | ✓ |
| `connection-mode` | 单个方式（`inline-flex`，等宽数字） | ✓ |
| `connection-errors` | 错误行容器 | ✓ |
| `connection-details` | 接驳详情区（上分隔线） | ✓ |
| `connection-detail` | 单个方式详情块 | ✓ |
| `connection-lines` | 公交逐段明细容器 | ✓ |
| `connection-line` | 单条线路（flex wrap） | ✓ |
| `connection-line-title` | 线路名（500） | ✓ |

### 9.2 HubPicker 子树

| 类名 | 语义 | styles.css 定义 |
|---|---|---|
| `hub-picker` | 选择页容器（`grid; gap: 16px`） | ✓ |
| `hub-picker-hint` | 顶部说明 + 已选计数（13px 次要色，行高 1.6） | ✓ |
| `hub-picker-hint strong` | 已选计数加粗（正文色、等宽数字） | ✓ |
| `hub-grid` | 候选卡片网格（auto-fill ≥150px） | ✓ |
| `hub-card` | 候选卡按钮（基线两端对齐、圆角 12px、过渡动画）；`:hover:not(:disabled)` 变蓝边；`:disabled` 半透明 + `not-allowed` | ✓ |
| `hub-card--on` | 选中态（蓝边 + 蓝色调底 12%） | ✓ |
| `hub-card--on .hub-card-city` | 选中时城市名变蓝 | ✓ |
| `hub-card-city` | 城市名（600） | ✓ |
| `hub-card-ratio` | 绕行比值（13px 次要色、等宽数字） | ✓ |
| `hub-picker-actions` | 底部按钮行（flex gap 10px） | ✓ |

### 9.3 App 级（与自研通路相关）

| 类名 | 语义 | styles.css 定义 |
|---|---|---|
| `app-theme` | 主题容器，定义 `--rail-*` CSS 变量与 `--card-padding` | ✓ |
| `app-shell` | 主容器（max-width 1160px） | ✓ |
| `results-title` | 结果区标题（20px 600） | ✓ |
| `results-toolbar` | 「重新选择枢纽」工具栏（右对齐） | ✓ |
| `query-status` | 状态条（13px 次要色 / Alert） | ✓ |

### 9.4 复用但属于公共组件的类

`journey-times` / `journey-end` / `journey-duration` / `day-offset` 来自 `JourneyTimes.tsx`（直达、官方中转、自研共用）；`connection-*` 来自 `ConnectionPanel.tsx`（官方中转、自研共用）。

---

## 10. 与官方中转通路的信息项差异对比

### 10.1 自研**多出**的信息

| # | 项 | 说明 |
|---|---|---|
| 10.1.1 | 按换乘次数分组 | 组头「一次换乘 / 两次换乘」+ `{n} 条`；官方按枢纽分组（组头为枢纽名 + `{n} 个方案`） |
| 10.1.2 | 排序切换控件 | `综合推荐 / 按总耗时`；官方无排序控件（组内固定按耗时） |
| 10.1.3 | 组内 Top-5 + 「展开更多（还有 N 条）」 | 官方是「同车次其他方案（N）」二级折叠 |
| 10.1.4 | 多换乘点（2 次换乘 = 3 程） | 换乘行可多行；官方固定 2 程 1 换乘点 |
| 10.1.5 | 每换乘点独立接驳入口 | 官方每方案仅 1 个 |
| 10.1.6 | `疑似绕远` 标记 | 官方无（官方有 `低于换乘下限`，自研无） |
| 10.1.7 | 任意程数车次链 | `G1 → G2 → G3`；官方恒两程 `G1 → G2` |
| 10.1.8 | 详情摘要文案 | `完整行程`（官方：`两程详情`） |
| 10.1.9 | 查价按钮带车次 | `{车次} 查价`（官方：`查价`） |
| 10.1.10 | 价格卡标题仅车次 | `.leg-price-code` = `{trainCode}`；官方 `.leg-price-head` = `{车次} · {上车站} → {下车站}` |
| 10.1.11 | 请求量确认弹窗 | 预估请求数 + 秒数（官方通路无） |
| 10.1.12 | 枢纽候选页 | 城市 + 绕行比值，最多选 2 个（官方通路无此阶段） |

### 10.2 自研**缺少**的信息（官方有）

| # | 项 | 官方文案 / 来源 |
|---|---|---|
| 10.2.1 | **余票行**（每程） | `.seat-list` 内：`第{index+1}程 {label}`；`label` 优先取 `ZE`，否则取第一个非 `--` 的席别；文案 `二等座 12 张` / `二等座 有` / `二等座 无`；全无 → `暂无余票信息`（`TransferList.tsx:190-197`） |
| 10.2.2 | 车次行副标题 | `.train-identity > span`：`同车接续` / `换乘一次`（`TransferList.tsx:185`） |
| 10.2.3 | 始发/终到标注 | `viaTags` → `<Tag class="wrapping-tag">始发 {站} · 终到 {站}</Tag>`（`TransferList.tsx:133`） |
| 10.2.4 | 详情内每程余票 | `.leg-tools > .seat-list` 的 `.seat-label seat-on/seat-hl/seat-off`（`TransferList.tsx:136-140`） |
| 10.2.5 | `低于换乘下限` 标记 | `planFlags` 的 `belowMin`（error 色）；自研行程在算法层已剪掉 |
| 10.2.6 | 「同车次其他方案」二级折叠 | 同车次组合的多枢纽/多方案变体（`TransferList.tsx:261-273`） |
| 10.2.7 | 每程价格卡的上下车站 | `.leg-price-head` 含 `{from} → {to}` |
| 10.2.8 | 官方评分 `score` | 存在于数据，两通路均未展示 |

### 10.3 同源但表现不同

| # | 项 | 自研 | 官方 |
|---|---|---|---|
| 10.3.1 | 分组维度 | 换乘次数 | 换乘枢纽 |
| 10.3.2 | Collapse 外观 | 默认（有边框），`defaultActiveKey` 全开 | `ghost` 无边框，受控 `activeKey` 流式自动展开 |
| 10.3.3 | 分组条数标签 | `{n} 条` | `{n} 个方案` |
| 10.3.4 | 同站/异站文案位置 | 与「换乘 X　等待 Y」同一行（`.transfer-wait` 内） | 独立 `<span class="muted">` 行 |
| 10.3.5 | 接驳入口位置 | 换乘行内 | 标记 Tag 之后的独立行 |
| 10.3.6 | 站码获取 | 直接来自 `Train`（`JourneyTransfer`） | 站名反查 `stationCodeOf`，失败给「未识别换乘站」 |
| 10.3.7 | 参考价合计 | 完全一致（`REFERENCE_SEAT_CODE='O'`、全部程齐备才显示） | 同 |
| 10.3.8 | 每程价格小表 | 完全一致（同一 `seatPrices` + `SEAT_PRICE_ORDER` + `.price-row--ref` 高亮） | 同 |
| 10.3.9 | 时刻条 | 同一 `JourneyTimes` 组件 | 同 |
| 10.3.10 | 标记来源 | `ScoredJourney.detour/longWait/risky` | `AnnotatedPlan.flags`（`belowMin/risky/longWait/sameTrain`） |
| 10.3.11 | 标记 Tag 颜色映射 | 硬编码在 JSX（`warning` / 默认） | `FLAG_COLOR` 映射表（`bad→error`、`risky→warning`、`long→default`、`ok→success`） |
| 10.3.12 | 每程价格块容器 | `.leg-prices`（多列 auto-fit 网格） | 直接放在 `.leg-content` 的 `price` 区域 |

---

## 11. 改版需注意的已知问题（仅记录，不代表要求修改）

| # | 问题 | 位置 |
|---|---|---|
| 11.1 | 三程行程的未查价提示仍写「展开**两程**查价」 | `SelfBuiltList.tsx:152` |
| 11.2 | 卡片头 `JourneyTimes` 的 `duration` 传格式化字符串，导致跨 2 天以上只标 `+1` | `SelfBuiltList.tsx:108` + `view.ts dayOffset` |
| 11.3 | `.list-toolbar`、`.hub-list` 在 `styles.css` 中无任何定义 | `styles.css` |
| 11.4 | `.leg-content` 的 `seats` / `price` grid 区域在自研 Leg 中空置 | `SelfBuiltList.tsx:49-63` |
| 11.5 | 查价失败（返回空表）无用户可见反馈，按钮静默恢复 | `App.tsx fetchPrice` |
| 11.6 | 自研通路 `Train.seats` 恒为空（`lite` 解析），补余票需同时改适配层与组件 | `selfbuilt-adapter.ts:35` |
