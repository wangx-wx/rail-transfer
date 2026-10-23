# UI 改版 · 已确认的功能缺口（改造前必须修）

> 本文档是改版的**验收清单**。每一条都是「当前实现已经丢了的用户可见信息」，
> 改版必须补回，不能以「UI 优化」为名进一步削减。
> 生成于 2026-10-21，来源：用户指出 + 代码核对。

## 1. 中转席别：解析层就只留了 4 个（最严重）

**位置**：`web/lib/parse.ts:127-132`

```ts
seats: {
  ZE: leg.ze_num ?? '',
  ZY: leg.zy_num ?? '',
  SWZ: leg.swz_num ?? '',
  WZ: leg.wz_num ?? '',
},
```

**现状**：中转响应 `fullList` 里每程有 `gr_num`（高级软卧）、`rw_num`（软卧）、
`yw_num`（硬卧）、`rz_num`（软座）、`yz_num`（硬座）、`qt_num`（其他）、
`gg_num`（?）、`srrb_num`、`bed_level_info` 等十余个余票字段，
解析时**只取 4 个高铁席别，其余全部丢弃**。

**后果**：普速车中转（大量存在）在界面上只能看到「暂无余票信息」，
因为它的票都在 `yw_num` / `yz_num` / `rw_num` 里，而这三个字段从没被读。

**这不是渲染问题**：数据在解析阶段就没了，改 UI 修不了，必须先改 `parseTransfer`。

**直达对照**：`TrainList` 走 `SEAT_COLUMNS` 全列解析，行为正确。

---

## 1b. 中转卡片：即使有 4 个席别，也只渲染 1 个

**位置**：`web/components/TransferList.tsx:191-196`

```ts
const entries = Object.entries(leg.seats).filter(([, raw]) => raw && raw !== '--');
const seat = entries.find(([code]) => code === 'ZE') ?? entries[0];  // ← 只取一个
```

**现状**：每程只渲染 **1 个**席别（优先二等座 `ZE`，没有就取第一个）。
修完第 1 条后，这里也必须改成全渲染。

**直达对照**：`TrainList.tsx:118` 是全渲染的，行为正确。

---

## 2. 自研中转卡片：完全不显示余票

**位置**：`web/components/SelfBuiltList.tsx`（`JourneyCard`）

**现状**：整个卡片没有任何余票信息。`ScoredJourney.legs` 是 `Train[]`，
`Train.seats: SeatAvailability[]` 数据齐全，但渲染时一次都没用到。

**影响**：用户只能看到「展开两程查价」或已查到的价格，看不到有没有票。

---

## 3. 中转席别名映射表只有 4 种

**位置**：`web/lib/view.ts:14`

```ts
export const LEG_SEAT_NAMES: Record<string, string> = {
  ZE: '二等座', ZY: '一等座', SWZ: '商务座', WZ: '无座',
};
```

**现状**：中转 `fullList` 的席别码不止这 4 种。普速车会返回 `3`（硬卧）、
`1`（硬座）、`4`（软卧）等，未映射时回退成原始码，界面显示成「第1程 3 有」。

**已有完整表**：`shared/constants.ts:112` 的 `SEAT_CODE_NAME` 有 18 种席别
（含普速车数字码）。中转通路应复用它，或补全 `LEG_SEAT_NAMES`。

**注意**：两套码不同——`LEG_SEAT_NAMES` 是界面码（`ZE`/`ZY`/`SWZ`/`WZ`），
`SEAT_CODE_NAME` 是价格接口码（`O`/`M`/`9`/`WZ`/`W`/`1`/`3`…）。不能直接合并，
需要先确认中转 `seats` 的键到底是哪一套。

---

## 4. 接驳：公交逐段时长在数据层就丢了

**位置**：`web/lib/transitParse.ts`

- `TencentTransitLine.duration`（上游有，单位分钟）**没有映射**到 `TransitLine`
- `TencentTransitWalking.duration` 只用于累加距离，时长被丢弃

**影响**：换乘公交时无法展示「每一段各需多久」。用户明确要求：
「如果是公共交通，需要换乘，每一段都需展示时间」。

**修复**：`TransitLine` 增加 `durationMinutes`；`TransitPlan` 增加步行段数组
（含 distance 与 duration），供逐段渲染。

---

## 5. 接驳：过路费显示条件

**位置**：`web/components/ConnectionPanel.tsx:200`

现有实现是 `driving.plan.tollYuan > 0` 才显示，**行为正确**。
原型曾错误地写成「过路费 ¥0」，已修正。改版时保持「> 0 才出现」。

---

## 6. 接驳摘要缺里程与票价

**位置**：`web/components/ConnectionPanel.tsx:142-155`

**现状**：摘要行只有「公交 48分 · 余 47分」，没有里程、没有票价。
里程与票价只在展开详情里。

**用户需求**（原始需求 D69）：接驳方案要给出「时间、价格、公里数」。
三项应在摘要层就能看到，不必展开。

---

## 7. 中转/自研卡片的跨天标识最多只到 +1

**位置**：`web/components/TransferList.tsx:186`、`web/components/SelfBuiltList.tsx:108`

```tsx
<JourneyTimes ... duration={durationLabel(p.totalMinutes)} />
//                              ^^^^^^^^^^^^^^ 产出「6时20分」
```

`dayOffset` 的历时解析只认 `HH:MM`：

```ts
function durationMinutes(dur) {
  const m = /^(\d{1,3}):(\d{2})$/.exec((dur ?? '').trim());
  if (!m) return null;          // ←「6时20分」不匹配
  ...
}
```

**后果**：正则失配 → 走回退分支「到达 < 发车 → 1」。所以跨 2 天及以上的中转行程
永远只显示 `+1`。直达通路传的是 `Train.duration`（`HH:MM`），不受影响。

**修复方向**：`JourneyTimes` 应接受分钟数，内部自己格式化；或 `dayOffset` 支持
「x时x分」格式。

---

## 8. 自研卡片缺「同车接续 / 换乘一次」副标题

**位置**：`web/components/SelfBuiltList.tsx` `JourneyCard` 的 `.train-identity`

官方中转卡片有第二行副标题（`同车接续` / `换乘一次`），自研卡片只有车次链
`G1 → G2`，没有这一行。信息量上不影响（换乘次数已由分组标题表达），
但两条通路的视觉语言不一致。改版时统一即可。

---

## 信息完整性红线

改版**不得删除**以下任何一项（已逐条核对现有实现）：

### 直达卡片
车次号、始发/终到标签、上下车站、发车时刻、到达时刻、跨天 +N、
历时、全部席别余票（含「无票」占位）、查价按钮/价格、买短乘长入口、
买短乘长 5 种结果状态

### 中转卡片
起终点、总耗时、车次链、同车接续标记、换乘站、等待时长、同站/同城异站、
每程余票、4 种 planFlags、接驳入口、二等座参考价 + 分解、
展开后：每程车次、始发/终到标签、上下车站、时刻、历时、全部席别、
价格小表（固定席别序）、查价按钮

### 自研卡片
起终点、总耗时、车次链、换乘点（含同站/同城异站）、疑似绕远/超长等待/换乘紧张、
二等座参考价 + 分解、展开后每程详情与查价、接驳入口、
排序切换、按换乘次数分组、Top-5 + 展开更多

### 接驳面板
换乘对名、7 种标记、公交/打车的时间 + 里程 + 票价 + 余量、
逐段线路（线路名、上下车站、站数、时长）、步行合计、换乘次数、
线路状态（可能错过末班/首班未发/停运）、打车费（有才显示）、
过路费（>0 才显示）、两站直线距离、
9 种降级分支（跨城/缺坐标/查无/网络失败可重试/业务失败不可重试/一端报错/
需打车/接驳紧张/时间不足）
