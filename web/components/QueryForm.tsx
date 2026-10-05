/**
 * 查询表单（D26 / D39）
 *
 * 城市用 AutoComplete 联想（替代原生 datalist），日期用 DatePicker，
 * 席别选项直接取自 shared/constants.ts 的 SEAT_OPTIONS（单一数据源）。
 */

import { useMemo } from 'react';
import { AutoComplete, Button, DatePicker, Form, Input, Select, Space } from 'antd';
import dayjs from 'dayjs';
import type { Dayjs } from 'dayjs';

import { SEAT_OPTIONS } from '../../shared/constants.ts';
import { resolveCity, allCityNames } from '../lib/city.ts';
import type { ResolvedCity } from '../lib/city.ts';
import { defaultDate, checkDate } from '../lib/date.ts';

/** 表单字段值 */
interface FormValues {
  from: string;
  to: string;
  date: Dayjs;
  seat: string;
  token?: string;
}

/** 校验通过的查询上下文 */
export interface QueryContext {
  from: ResolvedCity;
  to: ResolvedCity;
  date: string;
  seat: string;
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
  const seatOptions = useMemo(() => SEAT_OPTIONS.map((s) => ({ value: s.code, label: s.name })), []);

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
    return { from, to, date: v.date.format('YYYY-MM-DD'), seat: v.seat, token: (v.token ?? '').trim() };
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
      layout="inline"
      initialValues={{ date: dayjs(defaultDate()), seat: 'ZE' }}
      style={{ rowGap: 12, marginBottom: 16, padding: 16, background: '#fff', borderRadius: 12 }}
    >
      <Form.Item name="from" label="出发城市" rules={[{ required: true, message: '请输入出发城市' }]}>
        <AutoComplete
          options={cityOptions}
          filterOption={(input, option) => (option?.value ?? '').includes(input)}
          placeholder="北京"
          style={{ width: 140 }}
        />
      </Form.Item>

      <Form.Item name="to" label="到达城市" rules={[{ required: true, message: '请输入到达城市' }]}>
        <AutoComplete
          options={cityOptions}
          filterOption={(input, option) => (option?.value ?? '').includes(input)}
          placeholder="上海"
          style={{ width: 140 }}
        />
      </Form.Item>

      <Form.Item name="date" label="日期" rules={[{ required: true, message: '请选择日期' }]}>
        <DatePicker placeholder="选择日期" />
      </Form.Item>

      <Form.Item name="seat" label="席别">
        <Select options={seatOptions} style={{ width: 110 }} />
      </Form.Item>

      <Form.Item name="token" label="口令">
        <Input placeholder="可选" autoComplete="off" style={{ width: 120 }} />
      </Form.Item>

      <Form.Item>
        <Space>
          <Button type="primary" htmlType="button" loading={querying} onClick={() => submit(onDirect)}>
            查直达
          </Button>
          <Button htmlType="button" loading={querying} onClick={() => submit(onTransfer)}>
            查中转
          </Button>
        </Space>
      </Form.Item>
    </Form>
  );
}
