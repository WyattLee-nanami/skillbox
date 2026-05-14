import { useEffect, useMemo, useRef, useState } from 'react';
import Fuse from 'fuse.js';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import data from './skills.json';

type Skill = {
  name: string;
  dir: string;
  description: string;
  triggers: string[];
  body: string;
  usageCount: number;
  bytes: number;
};

const skills: Skill[] = (data as any).skills;
const generatedAt: string = (data as any).generatedAt;

const GROUPS: { id: string; label: string; match: (s: Skill) => boolean }[] = [
  { id: 'all', label: '全部', match: () => true },
  { id: 'hot', label: '常用 (近期)', match: (s) => s.usageCount >= 3 },
  { id: 'unused', label: '从未使用', match: (s) => s.usageCount === 0 },
  { id: 'meta', label: '元 / 工具类', match: (s) => /skill|create|forge|update|init|nuwa/i.test(s.name) },
  { id: 'meituan', label: '美团内部', match: (s) => /(meituan|dx|km|citadel|mrn|bi-|pde|aihot|decision|webauto|ldh|daxiang)/i.test(s.name) },
  { id: 'design', label: '设计 / UI', match: (s) => /(design|ui|banner|brand|slides|architecture|icon)/i.test(s.name) },
  { id: 'life', label: '生活场景', match: (s) => /(团建|聚餐|外卖|搬家|购物|旅游|周边|健身|预约|City|手艺|找优惠|taobao)/i.test(s.name) },
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
  const [group, setGroup] = useState('all');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string | null>(skills[0]?.name ?? null);
  const [present, setPresent] = useState(false);
  const [copied, setCopied] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

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
    [],
  );

  const filtered = useMemo(() => {
    let list = skills.filter((s) => GROUPS.find((g) => g.id === group)!.match(s));
    if (query.trim()) {
      const found = new Set(fuse.search(query.trim()).map((r) => r.item.name));
      list = list.filter((s) => found.has(s.name));
    }
    return list;
  }, [group, query, fuse]);

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
          ⌘D 演示模式<br />
          Esc 退出
        </div>
        <div className="group" style={{ marginTop: 24 }}>数据</div>
        <div style={{ padding: '4px 10px', color: 'var(--muted)', fontSize: 11 }}>
          {skills.length} 个 skill<br />
          {new Date(generatedAt).toLocaleString('zh-CN')}
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
