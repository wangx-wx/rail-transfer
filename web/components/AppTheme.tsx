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
    page: dark ? '#101012' : '#f5f5f7',
    surface: dark ? '#1c1c1e' : '#ffffff',
    text: dark ? '#f5f5f7' : '#1d1d1f',
    secondary: dark ? '#aaaab0' : '#68686e',
    line: dark ? '#38383d' : '#e8e8ed',
    blue: dark ? '#75b9ff' : '#0066cc',
    green: dark ? '#79d69a' : '#267b48',
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
