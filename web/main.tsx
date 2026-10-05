/**
 * 前端入口
 *
 * 挂载 React 根节点，并配置 antd 的中文语言包与 dayjs locale
 * （DatePicker 的星期/月份文案依赖它们）。
 */

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import dayjs from 'dayjs';
import 'dayjs/locale/zh-cn';
import 'antd/dist/reset.css';

import App from './App.tsx';

dayjs.locale('zh-cn');

const root = document.getElementById('root');
if (!root) throw new Error('缺少挂载节点 #root');

createRoot(root).render(
  <StrictMode>
    <ConfigProvider locale={zhCN}>
      <App />
    </ConfigProvider>
  </StrictMode>,
);
