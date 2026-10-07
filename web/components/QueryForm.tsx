/**
 * 查询表单（D26 / D39）
 *
 * 城市用 AutoComplete 联想（替代原生 datalist），日期用 DatePicker，
 * 起终点之间可一键对调，查询按钮居右。
 */

import { useMemo } from 'react';
import { AutoComplete, Button, DatePicker, Form, Input, Tooltip } from 'antd';
import { SwapOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import type { Dayjs } from 'dayjs';

import { resolveCity, allCityNames } from '../lib/city.ts';
import type { ResolvedCity } from '../lib/city.ts';
import { defaultDate, checkDate } from '../lib/date.ts';

/** 表单字段值 */
interface FormValues {
  from: string;
  to: string;
  date: Dayjs;
  token?: string;
}

/** 校验通过的查询上下文 */
export interface QueryContext {
  from: ResolvedCity;
  to: ResolvedCity;
  date: string;
  token: string;
}

interface Props {
  querying: boolean;
  onDirect: (ctx: QueryContext) => void;
  onTransfer: (ctx: QueryContext) => void;
}

export default function QueryForm({ querying, onDirect, onTransfer }: Props) {
  const [form] = Form.useForm<FormValues>();

  const cityOptions = useMemo(() => allCityNames().map((n) => ({ value: n })), []);

  /** 对调出发与到达城市 */
  function swapCities(): void {
    form.setFieldsValue({ from: form.getFieldValue('to'), to: form.getFieldValue('from') });
  }

  /** 校验并转成 QueryContext；任一项不合法则提示并返回 null */
  function buildContext(v: FormValues): QueryContext | null {
    const dateErr = checkDate(v.date.format('YYYY-MM-DD'));
    if (dateErr) {
      form.setFields([{ name: 'date', errors: [dateErr] }]);
      return null;
    }
    const from = resolveCity(v.from);
    if (!from) {
      form.setFields([{ name: 'from', errors: [`未识别的城市：${v.from}`] }]);
      return null;
    }
    const to = resolveCity(v.to);
    if (!to) {
      form.setFields([{ name: 'to', errors: [`未识别的城市：${v.to}`] }]);
      return null;
    }
    return { from, to, date: v.date.format('YYYY-MM-DD'), token: (v.token ?? '').trim() };
  }

  /** 两个按钮共用的提交入口 */
  async function submit(run: (ctx: QueryContext) => void): Promise<void> {
    let v: FormValues;
    try {
      v = await form.validateFields();
    } catch {
      return; // 校验失败，antd 已在字段上展示错误
    }
    const ctx = buildContext(v);
    if (ctx) run(ctx);
  }

  return (
    <Form
      form={form}
      layout="vertical"
      className="query-form"
      initialValues={{ date: dayjs(defaultDate()) }}
    >
      <Form.Item className="query-from" name="from" label="出发城市" rules={[{ required: true, message: '请输入出发城市' }]}>
        <AutoComplete
          options={cityOptions}
          filterOption={(input, option) => (option?.value ?? '').includes(input)}
          placeholder="北京"
          style={{ width: '100%' }}
        />
      </Form.Item>

      <div className="query-swap">
        <Tooltip title="对调出发与到达城市">
          <Button
            type="text"
            shape="circle"
            icon={<SwapOutlined />}
            aria-label="对调出发与到达城市"
            onClick={swapCities}
          />
        </Tooltip>
      </div>

      <Form.Item className="query-to" name="to" label="到达城市" rules={[{ required: true, message: '请输入到达城市' }]}>
        <AutoComplete
          options={cityOptions}
          filterOption={(input, option) => (option?.value ?? '').includes(input)}
          placeholder="上海"
          style={{ width: '100%' }}
        />
      </Form.Item>

      <Form.Item className="query-date" name="date" label="日期" rules={[{ required: true, message: '请选择日期' }]}>
        <DatePicker placeholder="选择日期" style={{ width: '100%' }} />
      </Form.Item>

      <div className="query-actions">
        <Button type="primary" htmlType="button" loading={querying} onClick={() => submit(onDirect)}>
          查直达
        </Button>
        <Button htmlType="button" loading={querying} onClick={() => submit(onTransfer)}>
          查中转
        </Button>
      </div>
      <details className="query-access">
        <summary>访问口令（可选）</summary>
        <Form.Item name="token" label="口令">
          <Input type="password" placeholder="可选" autoComplete="off" />
        </Form.Item>
      </details>
    </Form>
  );
}
