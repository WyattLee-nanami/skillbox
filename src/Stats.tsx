import { useEffect, useMemo, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { UsageStats } from './types';

const WINDOWS = [
  { d: 7, label: '近 7 天' },
  { d: 14, label: '近 14 天' },
  { d: 30, label: '近 30 天' },
  { d: 90, label: '近 90 天' },
];

function fmtNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toString();
}

function shortDate(iso: string): string {
  return iso.slice(5); // MM-DD
}

export default function Stats() {
  const [days, setDays] = useState(14);
  const [data, setData] = useState<UsageStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<'token' | 'message'>('token');

  useEffect(() => {
    setData(null);
    setError(null);
    invoke<UsageStats>('scan_usage', { windowDays: days })
      .then(setData)
      .catch((e) => setError(String(e)));
  }, [days]);

  const max = useMemo(() => {
    if (!data) return 1;
    return Math.max(
      1,
      ...data.daily.map((d) => (mode === 'token' ? d.total : d.messages)),
    );
  }, [data, mode]);

  if (error) return <div className="empty">统计失败：{error}</div>;
  if (!data) return <div className="empty">扫描中…</div>;

  const todayBucket = data.daily[data.daily.length - 1];
  const todayValue = todayBucket
    ? mode === 'token'
      ? todayBucket.total
      : todayBucket.messages
    : 0;

  return (
    <div className="stats-pane">
      <div className="stats-head">
        <h2>Claude Code 统计</h2>
        <div className="window-tabs">
          {WINDOWS.map((w) => (
            <button
              key={w.d}
              className={days === w.d ? 'active' : ''}
              onClick={() => setDays(w.d)}
            >
              {w.label}
            </button>
          ))}
        </div>
      </div>

      <div className="kpi-row">
        <div className="kpi-card k1">
          <div className="kpi-label"><span className="kpi-icon">🔥</span>总 TOKEN</div>
          <div className="kpi-value">{fmtNum(data.total_tokens)}</div>
          <div className="kpi-sub">{data.session_count} 个会话</div>
        </div>
        <div className="kpi-card k2">
          <div className="kpi-label"><span className="kpi-icon">💬</span>消息数</div>
          <div className="kpi-value">{data.total_messages}</div>
          <div className="kpi-sub">AI 回复</div>
        </div>
      </div>

      <div className="panel-card">
        <div className="panel-title">TOKEN 明细</div>
        <div className="breakdown-grid">
          <div>
            <div className="bd-label">输入</div>
            <div className="bd-value">{fmtNum(data.input_tokens)}</div>
          </div>
          <div>
            <div className="bd-label">输出</div>
            <div className="bd-value">{fmtNum(data.output_tokens)}</div>
          </div>
          <div>
            <div className="bd-label">缓存读</div>
            <div className="bd-value">{fmtNum(data.cache_read_tokens)}</div>
          </div>
          <div>
            <div className="bd-label">缓存写</div>
            <div className="bd-value">{fmtNum(data.cache_create_tokens)}</div>
          </div>
        </div>
      </div>

      <div className="panel-card">
        <div className="panel-row">
          <div className="panel-title">每日 {mode === 'token' ? 'TOKEN' : '消息'} ({WINDOWS.find((w) => w.d === days)?.label})</div>
          <div className="seg">
            <button className={mode === 'token' ? 'active' : ''} onClick={() => setMode('token')}>Token</button>
            <button className={mode === 'message' ? 'active' : ''} onClick={() => setMode('message')}>消息</button>
          </div>
        </div>
        {todayBucket && (
          <div className="today-pill">今天 {fmtNum(todayValue)}</div>
        )}
        <div className="bar-chart">
          <div className="bar-axis">
            <span>{mode === 'token' ? `${fmtNum(max)}` : max}</span>
            <span>{fmtNum(max / 2)}</span>
            <span>0</span>
          </div>
          <div className="bars">
            {data.daily.map((d, i) => {
              const v = mode === 'token' ? d.total : d.messages;
              const h = max === 0 ? 0 : (v / max) * 100;
              const isLast = i === data.daily.length - 1;
              return (
                <div
                  key={d.date}
                  className={`bar${isLast ? ' today' : ''}`}
                  style={{ height: `${h}%` }}
                  title={`${d.date}: ${fmtNum(v)}${mode === 'token' ? ' tokens' : ' msgs'}`}
                />
              );
            })}
          </div>
          <div className="bar-xaxis">
            <span>{shortDate(data.daily[0]?.date ?? '')}</span>
            {data.daily.length > 7 && (
              <span>{shortDate(data.daily[Math.floor(data.daily.length / 2)]?.date ?? '')}</span>
            )}
            <span>{shortDate(data.daily[data.daily.length - 1]?.date ?? '')}</span>
          </div>
        </div>
      </div>

      {data.by_model.length > 0 && (
        <div className="panel-card">
          <div className="panel-title">按模型</div>
          <table className="model-table">
            <thead>
              <tr>
                <th>模型</th>
                <th>输入</th>
                <th>输出</th>
                <th>缓存读</th>
                <th>缓存写</th>
                <th>消息</th>
                <th>合计</th>
              </tr>
            </thead>
            <tbody>
              {data.by_model.map((m) => (
                <tr key={m.model}>
                  <td>{m.model}</td>
                  <td>{fmtNum(m.input)}</td>
                  <td>{fmtNum(m.output)}</td>
                  <td>{fmtNum(m.cache_read)}</td>
                  <td>{fmtNum(m.cache_create)}</td>
                  <td>{m.messages}</td>
                  <td>{fmtNum(m.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
