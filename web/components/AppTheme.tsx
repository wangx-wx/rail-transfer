import { useSyncExternalStore } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { ConfigProvider, theme } from 'antd';
import zhCN from 'antd/locale/zh_CN';

const DARK_QUERY = '(prefers-color-scheme: dark)';
function subscribe(onChange: () => void): () => void {
  const media = window.matchMedia(DARK_QUERY);
  media.addEventListener('change', onChange);
  return () => media.removeEventListener('change', onChange);
}

/** 控件和自有布局共用同一套颜色，系统主题变化不重建页面。 */
export default function AppTheme({ children }: { children: ReactNode }) {
  const dark = useSyncExternalStore(subscribe, () => window.matchMedia(DARK_QUERY).matches, () => false);
  const colors = {
    page: dark ? '#0e0f11' : '#eff0f2',
    surface: dark ? '#17181b' : '#ffffff',
    text: dark ? '#f2f3f5' : '#16171a',
    secondary: dark ? '#989aa1' : '#67696f',
    line: dark ? '#2a2c31' : '#e2e3e7',
    // 行间细线：比 line 更浅，用于同一块面内的行分隔（D79）
    hairline: dark ? '#212328' : '#eef0f2',
    blue: dark ? '#5aa0f5' : '#0b5fd0',
    green: dark ? '#4fc98a' : '#0f7a46',
    // 琥珀 = 紧张 / 超长等待；红 = 无票 / 来不及（D79 色彩语义）
    amber: dark ? '#e0a24a' : '#9a5b00',
    red: dark ? '#f0736a' : '#be2d22',
    panel: dark ? '#212328' : '#f6f7f9',
  };
  const variables = Object.fromEntries(Object.entries(colors).map(([key, value]) => [`--rail-${key}`, value]));
  return (
    <ConfigProvider locale={zhCN} theme={{
      algorithm: dark ? theme.darkAlgorithm : theme.defaultAlgorithm,
      token: {
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", sans-serif',
        colorPrimary: dark ? '#0a84ff' : '#007aff',
        colorBgLayout: colors.page, colorBgContainer: colors.surface,
        colorText: colors.text, colorTextSecondary: colors.secondary,
        colorBorderSecondary: colors.line,
        borderRadius: 12, borderRadiusLG: 20,
        // 小尺寸也是日期单元格的计算基准，触控按钮单独在组件 token 放大。
        controlHeight: 44, controlHeightSM: 24, controlHeightLG: 44,
      },
      components: {
        Form: { itemMarginBottom: 0, labelColor: colors.secondary },
        Button: { controlHeightSM: 44 },
        Input: { inputFontSize: 16 },
        Select: { fontSize: 16 },
        DatePicker: { inputFontSize: 16 },
        Card: { bodyPaddingSM: 20 },
        Collapse: { headerBg: 'transparent', contentBg: colors.surface },
      },
    }}>
      <div className="app-theme" data-theme={dark ? 'dark' : 'light'} style={{ ...variables, colorScheme: dark ? 'dark' : 'light' } as CSSProperties}>
        {children}
      </div>
    </ConfigProvider>
  );
}
