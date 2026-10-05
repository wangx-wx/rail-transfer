/**
 * 状态条 —— 展示查询进度 / 错误 / 警告
 */

import { Alert } from 'antd';

export type StatusKind = 'info' | 'warn' | 'error';

interface Props {
  text: string;
  kind: StatusKind;
}

export default function StatusBar({ text, kind }: Props) {
  if (!text) return null;
  if (kind === 'info') {
    // 普通进度不占版面，用浅色文本
    return <div style={{ color: '#64748b', fontSize: 13, marginBottom: 12 }}>{text}</div>;
  }
  return (
    <Alert
      type={kind === 'warn' ? 'warning' : 'error'}
      title={text}
      showIcon
      style={{ marginBottom: 12 }}
    />
  );
}
