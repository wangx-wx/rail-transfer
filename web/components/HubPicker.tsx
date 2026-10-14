/**
 * 中转枢纽选择（D68）——先出候选、用户选 1~2 个再查
 *
 * 候选由纯离线计算得出（零请求）。用户从候选中最多选 2 个：
 *   选 1 个 = 一次换乘；选 2 个 = 二次换乘（并一并给出经单个城市的方案）。
 *
 * ⚠️ 选中顺序对算法无影响（`planJourneys` 两个方向都会探索），故**不显示顺序号**。
 * ⚠️ 卡片只显示城市名，不显示站名——`code` 是城市代表站，上游会展开全城，
 *    写站名会与结果里的实际站对不上。
 */

import { Button, Empty } from 'antd';

import type { HubCandidate } from '../lib/selfbuilt-query.ts';

/** 最多可选的中转城市数（= 最多换乘次数） */
const MAX_PICK = 2;

interface Props {
  candidates: HubCandidate[];
  /** 已选站码（顺序无关） */
  selected: string[];
  onChange: (next: string[]) => void;
  onRun: () => void;
  onCancel: () => void;
  running: boolean;
}

/** 绕行比值 → 展示文案（缺坐标为「—」，不出现 NaN） */
function ratioLabel(ratio: number | null): string {
  return ratio == null ? '—' : ratio.toFixed(2);
}

export default function HubPicker({ candidates, selected, onChange, onRun, onCancel, running }: Props) {
  if (!candidates.length) {
    return (
      <div className="hub-picker">
        <Empty description="没有合适的候选枢纽，建议改用『查中转』" />
        <div className="hub-picker-actions">
          <Button onClick={onCancel}>返回</Button>
        </div>
      </div>
    );
  }

  const picked = new Set(selected);
  const full = selected.length >= MAX_PICK;

  function toggle(code: string): void {
    if (picked.has(code)) {
      onChange(selected.filter((c) => c !== code));
      return;
    }
    if (full) return; // 已满，忽略（按钮已 disabled）
    onChange([...selected, code]);
  }

  return (
    <div className="hub-picker">
      <p className="hub-picker-hint">
        选择中转城市（已选 <strong>{selected.length}/{MAX_PICK}</strong>）：
        选 1 个 = 一次换乘；选 2 个 = 二次换乘（会一并给出经单个城市的方案）。
      </p>
      <div className="hub-grid">
        {candidates.map((c) => {
          const on = picked.has(c.code);
          const disabled = full && !on;
          return (
            <button
              key={c.code}
              type="button"
              className={`hub-card${on ? ' hub-card--on' : ''}`}
              aria-pressed={on}
              disabled={disabled}
              title={disabled ? `最多选 ${MAX_PICK} 个` : undefined}
              onClick={() => toggle(c.code)}
            >
              <span className="hub-card-city">{c.city}</span>
              <span className="hub-card-ratio" title="绕行比值">{ratioLabel(c.ratio)}</span>
            </button>
          );
        })}
      </div>
      <div className="hub-picker-actions">
        <Button type="primary" disabled={!selected.length} loading={running} onClick={onRun}>
          查询
        </Button>
        <Button onClick={onCancel}>返回</Button>
      </div>
    </div>
  );
}
