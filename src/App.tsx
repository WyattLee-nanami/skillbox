import { useEffect, useMemo, useRef, useState } from 'react';
import Fuse from 'fuse.js';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { invoke } from '@tauri-apps/api/core';

type Skill = {
  name: string;
  dir: string;
  description: string;
  triggers: string[];
  body: string;
  usageCount: number;
  bytes: number;
};

type ScanResult = {
  generatedAt: string;
  skillsDir: string;
  skills: Skill[];
};

const GROUPS: { id: string; label: string; match: (s: Skill) => boolean }[] = [
  { id: 'all', label: '全部 / All', match: () => true },
  { id: 'hot', label: '常用', match: (s) => s.usageCount >= 3 },
  { id: 'unused', label: '从未使用', match: (s) => s.usageCount === 0 },
  { id: 'meta', label: '元 / 工具类', match: (s) => /skill|create|forge|update|init|nuwa/i.test(s.name) },
  { id: 'design', label: '设计 / UI', match: (s) => /(design|ui|banner|brand|slides|architecture|icon)/i.test(s.name) },
  { id: 'life', label: '生活场景', match: (s) => /(团建|聚餐|外卖|搬家|购物|旅游|周边|健身|预约|City|手艺|找优惠|taobao|waimai|shopping)/i.test(s.name) },
];

function highlight(text: string, query: string): React.ReactNode {
  if (!query) return text;
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return text;
  return (
    <>
      {text.slice(0, idx)}
      <mark>{text.slice(idx, idx + query.length)}</mark>
      {text.slice(idx + query.length)}
    </>
  );
}

export default function App() {
  const [data, setData] = useState<ScanResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [group, setGroup] = useState('all');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [present, setPresent] = useState(false);
  const [copied, setCopied] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    invoke<ScanResult>('scan_skills')
      .then((r) => {
        setData(r);
        setSelected(r.skills[0]?.name ?? null);
      })
      .catch((e) => setError(String(e)));
  }, []);

  const refresh = () => {
    setError(null);
    invoke<ScanResult>('scan_skills')
      .then((r) => {
        setData(r);
        setSelected((cur) => cur ?? r.skills[0]?.name ?? null);
      })
      .catch((e) => setError(String(e)));
  };

  const skills = data?.skills ?? [];

  const fuse = useMemo(
    () =>
      new Fuse(skills, {
        keys: [
          { name: 'name', weight: 0.4 },
          { name: 'description', weight: 0.4 },
          { name: 'triggers', weight: 0.2 },
        ],
        threshold: 0.4,
        ignoreLocation: true,
      }),
    [skills],
  );

  const filtered = useMemo(() => {
    let list = skills.filter((s) => GROUPS.find((g) => g.id === group)!.match(s));
    if (query.trim()) {
      const found = new Set(fuse.search(query.trim()).map((r) => r.item.name));
      list = list.filter((s) => found.has(s.name));
    }
    return list;
  }, [skills, group, query, fuse]);

  const current = skills.find((s) => s.name === selected) ?? filtered[0];

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'd') {
        e.preventDefault();
        setPresent((p) => !p);
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'r') {
        e.preventDefault();
        refresh();
      }
      if (e.key === 'Escape') {
        setPresent(false);
        if (document.activeElement === inputRef.current) {
          inputRef.current?.blur();
          setQuery('');
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const copy = (cmd: string) => {
    navigator.clipboard.writeText(cmd);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };

  if (error) {
    return (
      <div className="empty" style={{ flexDirection: 'column', padding: 40, textAlign: 'center' }}>
        <div style={{ fontSize: 18, marginBottom: 12 }}>扫描失败 / Scan failed</div>
        <div style={{ fontSize: 13, fontFamily: 'monospace', color: '#ff8a8a' }}>{error}</div>
        <button
          onClick={refresh}
          style={{
            marginTop: 18,
            background: 'var(--panel)',
            border: '1px solid var(--line)',
            borderRadius: 8,
            padding: '8px 16px',
            cursor: 'pointer',
            color: 'var(--text)',
          }}
        >
          重试
        </button>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="empty" style={{ flexDirection: 'column' }}>
        <div>扫描你的 skill 库… / Scanning…</div>
        <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 6 }}>~/.claude/skills/</div>
      </div>
    );
  }

  if (skills.length === 0) {
    return (
      <div className="empty" style={{ flexDirection: 'column', textAlign: 'center', padding: 40 }}>
        <div style={{ fontSize: 18, marginBottom: 8 }}>没有找到 skill</div>
        <div style={{ fontSize: 13, color: 'var(--muted)' }}>
          目录：{data.skillsDir}
          <br />
          请确认 ~/.claude/skills/ 下至少有一个含 SKILL.md 的子目录
        </div>
        <button
          onClick={refresh}
          style={{
            marginTop: 18,
            background: 'var(--panel)',
            border: '1px solid var(--line)',
            borderRadius: 8,
            padding: '8px 16px',
            cursor: 'pointer',
            color: 'var(--text)',
          }}
        >
          重新扫描
        </button>
      </div>
    );
  }

  const groupCounts = GROUPS.map((g) => ({ ...g, count: skills.filter(g.match).length }));

  return (
    <div className={`app${present ? ' present' : ''}`}>
      <aside className="sidebar">
        <h1>Skillbox</h1>
        {groupCounts.map((g) => (
          <button
            key={g.id}
            className={group === g.id ? 'active' : ''}
            onClick={() => setGroup(g.id)}
          >
            <span>{g.label}</span>
            <span className="count">{g.count}</span>
          </button>
        ))}
        <div className="group" style={{ marginTop: 24 }}>快捷键</div>
        <div style={{ padding: '4px 10px', color: 'var(--muted)', fontSize: 12 }}>
          ⌘K 搜索<br />
          ⌘R 重新扫描<br />
          ⌘D 演示模式<br />
          Esc 退出
        </div>
        <div className="group" style={{ marginTop: 24 }}>数据</div>
        <div style={{ padding: '4px 10px', color: 'var(--muted)', fontSize: 11 }}>
          {skills.length} 个 skill<br />
          <span style={{ wordBreak: 'break-all' }}>{data.skillsDir}</span>
        </div>
      </aside>

      <section className="list-pane">
        <div className="search-wrap">
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索：技能名、描述、触发词……  ⌘K"
          />
          <div className="search-meta">
            {filtered.length} / {skills.length} 个匹配
          </div>
        </div>
        <div className="cards">
          {filtered.map((s) => (
            <div
              key={s.name}
              className={`card${current?.name === s.name ? ' selected' : ''}${s.usageCount === 0 ? ' unused' : ''}`}
              onClick={() => setSelected(s.name)}
            >
              <div className="row1">
                <h3>{highlight(s.name, query)}</h3>
                {s.usageCount > 0 ? (
                  <span className="badge hot">{s.usageCount}×</span>
                ) : (
                  <span className="badge">未用</span>
                )}
              </div>
              <p>{highlight(s.description, query)}</p>
            </div>
          ))}
          {filtered.length === 0 && (
            <div className="empty">没有匹配的 skill</div>
          )}
        </div>
      </section>

      <section className="detail-pane">
        {current ? (
          <>
            <div className="head">
              <h2>{current.name}</h2>
              <button
                className={`copy${copied ? ' copied' : ''}`}
                onClick={() => copy(`/${current.name}`)}
                title="复制 slash 命令"
              >
                {copied ? '✓ 已复制' : `/${current.name}`}
              </button>
            </div>
            <div className="meta">
              <span>📦 {(current.bytes / 1024).toFixed(1)} KB</span>
              <span>🔥 调用 {current.usageCount} 次</span>
              {current.triggers.length > 0 && (
                <span>🎯 触发词 {current.triggers.length} 个</span>
              )}
            </div>
            <div className="desc">{current.description}</div>
            <div className="body">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{current.body}</ReactMarkdown>
            </div>
          </>
        ) : (
          <div className="empty">选一个 skill</div>
        )}
      </section>
    </div>
  );
}
