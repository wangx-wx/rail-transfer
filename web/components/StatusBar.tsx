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
    return <div className="query-status">{text}</div>;
  }
  return (
    <Alert
      className="query-status"
      type={kind === 'warn' ? 'warning' : 'error'}
      title={text}
      showIcon
      style={{ marginBottom: 12 }}
    />
  );
}
