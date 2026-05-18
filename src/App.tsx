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
  disabled: boolean;
};

type ScanResult = {
  generatedAt: string;
  skillsDir: string;
  skills: Skill[];
};

type BackupResult = { path: string; bytes: number; items: string[] };
type RestoreResult = { restored: string[]; conflictsRenamed: string[] };

const GROUPS: { id: string; label: string; match: (s: Skill) => boolean }[] = [
  { id: 'all', label: '全部 / All', match: (s) => !s.disabled },
  { id: 'hot', label: '常用', match: (s) => !s.disabled && s.usageCount >= 3 },
  { id: 'unused', label: '从未使用', match: (s) => !s.disabled && s.usageCount === 0 },
  { id: 'meta', label: '元 / 工具类', match: (s) => !s.disabled && /skill|create|forge|update|init|nuwa/i.test(s.name) },
  { id: 'design', label: '设计 / UI', match: (s) => !s.disabled && /(design|ui|banner|brand|slides|architecture|icon)/i.test(s.name) },
  { id: 'life', label: '生活场景', match: (s) => !s.disabled && /(团建|聚餐|外卖|搬家|购物|旅游|周边|健身|预约|City|手艺|找优惠|taobao|waimai|shopping)/i.test(s.name) },
  { id: 'disabled', label: '已禁用', match: (s) => s.disabled },
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
  const [confirmDelete, setConfirmDelete] = useState<Skill | null>(null);
  const [confirmText, setConfirmText] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [multiMode, setMultiMode] = useState(false);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [batchBusy, setBatchBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    invoke<ScanResult>('scan_skills')
      .then((r) => {
        setData(r);
        setSelected(r.skills.find((s) => !s.disabled)?.name ?? r.skills[0]?.name ?? null);
      })
      .catch((e) => setError(String(e)));
  }, []);

  const refresh = () => {
    setError(null);
    invoke<ScanResult>('scan_skills').then(setData).catch((e) => setError(String(e)));
  };

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3500);
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
        if (multiMode) {
          setMultiMode(false);
          setChecked(new Set());
        }
        if (document.activeElement === inputRef.current) {
          inputRef.current?.blur();
          setQuery('');
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [multiMode]);

  const copy = (cmd: string) => {
    navigator.clipboard.writeText(cmd);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };

  const askDelete = (s: Skill) => {
    setConfirmDelete(s);
    setConfirmText('');
    setDeleteError(null);
  };
  const cancelDelete = () => {
    setConfirmDelete(null);
    setConfirmText('');
    setDeleteError(null);
    setDeleting(false);
  };
  const doDelete = async () => {
    if (!confirmDelete || confirmText !== confirmDelete.name) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await invoke<void>('trash_skill', { dirName: confirmDelete.dir });
      cancelDelete();
      refresh();
    } catch (e) {
      setDeleteError(String(e));
      setDeleting(false);
    }
  };

  const toggleSkill = async (s: Skill) => {
    try {
      const cmd = s.disabled ? 'enable_skill' : 'disable_skill';
      await invoke<void>(cmd, { dirName: s.dir });
      showToast(s.disabled ? `已启用 ${s.name}` : `已禁用 ${s.name}`);
      refresh();
    } catch (e) {
      showToast(`操作失败：${String(e)}`);
    }
  };

  const toggleCheck = (dir: string) => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(dir)) next.delete(dir);
      else next.add(dir);
      return next;
    });
  };

  const checkAllInView = () => {
    setChecked(new Set(filtered.map((s) => s.dir)));
  };
  const clearChecked = () => setChecked(new Set());

  const checkUnused = () => {
    setChecked(new Set(skills.filter((s) => !s.disabled && s.usageCount === 0).map((s) => s.dir)));
  };

  const batchDisable = async () => {
    if (checked.size === 0) return;
    setBatchBusy(true);
    let ok = 0;
    let fail = 0;
    for (const dir of checked) {
      const s = skills.find((x) => x.dir === dir);
      if (!s || s.disabled) continue;
      try {
        await invoke<void>('disable_skill', { dirName: dir });
        ok++;
      } catch {
        fail++;
      }
    }
    setBatchBusy(false);
    setChecked(new Set());
    setMultiMode(false);
    refresh();
    showToast(`已禁用 ${ok} 个${fail > 0 ? `，失败 ${fail} 个` : ''}`);
  };

  const batchEnable = async () => {
    if (checked.size === 0) return;
    setBatchBusy(true);
    let ok = 0;
    let fail = 0;
    for (const dir of checked) {
      const s = skills.find((x) => x.dir === dir);
      if (!s || !s.disabled) continue;
      try {
        await invoke<void>('enable_skill', { dirName: dir });
        ok++;
      } catch {
        fail++;
      }
    }
    setBatchBusy(false);
    setChecked(new Set());
    setMultiMode(false);
    refresh();
    showToast(`已启用 ${ok} 个${fail > 0 ? `，失败 ${fail} 个` : ''}`);
  };

  const doBackup = async () => {
    try {
      const r = await invoke<BackupResult>('backup_config');
      const sizeMb = (r.bytes / 1024 / 1024).toFixed(2);
      showToast(`已备份 ${r.items.length} 项 (${sizeMb} MB) → ${r.path}`);
    } catch (e) {
      showToast(`备份失败：${String(e)}`);
    }
  };

  const doRestore = async () => {
    const path = window.prompt(
      '输入备份文件完整路径（.tar.gz）。\n冲突会自动重命名为 *.before-restore.<时间戳>，不会删数据。',
      '',
    );
    if (!path) return;
    try {
      const r = await invoke<RestoreResult>('restore_config', { archivePath: path });
      let msg = `已恢复 ${r.restored.length} 项`;
      if (r.conflictsRenamed.length > 0) {
        msg += `，原有 ${r.conflictsRenamed.length} 项已改名保存`;
      }
      showToast(msg);
      refresh();
    } catch (e) {
      showToast(`恢复失败：${String(e)}`);
    }
  };

  if (error) {
    return (
      <div className="empty" style={{ flexDirection: 'column', padding: 40, textAlign: 'center' }}>
        <div style={{ fontSize: 18, marginBottom: 12 }}>扫描失败 / Scan failed</div>
        <div style={{ fontSize: 13, fontFamily: 'monospace', color: '#ff8a8a' }}>{error}</div>
        <button onClick={refresh} className="btn" style={{ marginTop: 18 }}>重试</button>
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
        <button onClick={refresh} className="btn" style={{ marginTop: 18 }}>重新扫描</button>
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

        <div className="group" style={{ marginTop: 20 }}>批量操作</div>
        <button onClick={() => { setMultiMode((v) => !v); setChecked(new Set()); }}>
          <span>{multiMode ? '✓ 退出选择' : '☐ 进入选择模式'}</span>
        </button>

        <div className="group" style={{ marginTop: 20 }}>配置</div>
        <button onClick={doBackup}><span>📦 一键备份</span></button>
        <button onClick={doRestore}><span>↩ 恢复备份</span></button>

        <div className="group" style={{ marginTop: 20 }}>快捷键</div>
        <div style={{ padding: '4px 10px', color: 'var(--muted)', fontSize: 12 }}>
          ⌘K 搜索<br />
          ⌘R 重新扫描<br />
          ⌘D 演示模式<br />
          Esc 退出
        </div>

        <div className="group" style={{ marginTop: 20 }}>数据</div>
        <div style={{ padding: '4px 10px', color: 'var(--muted)', fontSize: 11 }}>
          {skills.filter((s) => !s.disabled).length} active · {skills.filter((s) => s.disabled).length} disabled
          <br />
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
            {multiMode && (
              <span style={{ marginLeft: 12, color: 'var(--accent)' }}>
                已选 {checked.size}
              </span>
            )}
          </div>
        </div>

        {multiMode && (
          <div className="batch-bar">
            <button onClick={checkAllInView}>全选当前视图</button>
            <button onClick={checkUnused}>选未使用</button>
            <button onClick={clearChecked}>清空</button>
            <span style={{ flex: 1 }} />
            <button
              className="btn-primary"
              disabled={batchBusy || checked.size === 0 || group === 'disabled'}
              onClick={batchDisable}
              title="把选中的活跃 skill 移到 skills.disabled/"
            >
              {batchBusy ? '处理中…' : `禁用选中 (${checked.size})`}
            </button>
            <button
              className="btn-primary"
              disabled={batchBusy || checked.size === 0 || group !== 'disabled'}
              onClick={batchEnable}
              title="把选中的禁用 skill 移回 skills/"
            >
              启用选中
            </button>
          </div>
        )}

        <div className="cards">
          {filtered.map((s) => (
            <div
              key={s.dir}
              className={`card${current?.name === s.name ? ' selected' : ''}${s.usageCount === 0 && !s.disabled ? ' unused' : ''}${s.disabled ? ' disabled' : ''}`}
              onClick={(e) => {
                if (multiMode) {
                  e.preventDefault();
                  toggleCheck(s.dir);
                } else {
                  setSelected(s.name);
                }
              }}
            >
              <div className="row1">
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                  {multiMode && (
                    <input
                      type="checkbox"
                      checked={checked.has(s.dir)}
                      onChange={() => toggleCheck(s.dir)}
                      onClick={(e) => e.stopPropagation()}
                    />
                  )}
                  <h3>{highlight(s.name, query)}</h3>
                </div>
                {s.disabled ? (
                  <span className="badge muted">禁用</span>
                ) : s.usageCount > 0 ? (
                  <span className="badge hot">{s.usageCount}×</span>
                ) : (
                  <span className="badge">未用</span>
                )}
              </div>
              <p>{highlight(s.description, query)}</p>
            </div>
          ))}
          {filtered.length === 0 && <div className="empty">没有匹配的 skill</div>}
        </div>
      </section>

      <section className="detail-pane">
        {current ? (
          <>
            <div className="head">
              <h2>{current.name} {current.disabled && <span style={{ fontSize: 14, color: 'var(--muted)', marginLeft: 8 }}>(已禁用)</span>}</h2>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  className={`copy${copied ? ' copied' : ''}`}
                  onClick={() => copy(`/${current.name}`)}
                  disabled={current.disabled}
                  title={current.disabled ? '禁用中,无法调用' : '复制 slash 命令'}
                >
                  {copied ? '✓ 已复制' : `/${current.name}`}
                </button>
                <button className="copy" onClick={() => toggleSkill(current)}>
                  {current.disabled ? '↻ 启用' : '⏸ 禁用'}
                </button>
                <button className="copy danger" onClick={() => askDelete(current)} title="移到废纸篓">
                  🗑 删除
                </button>
              </div>
            </div>
            <div className="meta">
              <span>📦 {(current.bytes / 1024).toFixed(1)} KB</span>
              <span>🔥 调用 {current.usageCount} 次</span>
              {current.triggers.length > 0 && (<span>🎯 触发词 {current.triggers.length} 个</span>)}
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

      {confirmDelete && (
        <div className="modal-backdrop" onClick={cancelDelete}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>移到废纸篓</h3>
            <p>即将把整个 skill 文件夹移到 macOS 废纸篓：</p>
            <pre className="modal-target">~/.claude/{confirmDelete.disabled ? 'skills.disabled' : 'skills'}/{confirmDelete.dir}</pre>
            <p style={{ color: 'var(--muted)', fontSize: 13 }}>
              文件夹的全部内容（SKILL.md、references、scripts 等）都会一起进废纸篓。删错了？去废纸篓拖回来即可。
            </p>
            <p style={{ marginTop: 14 }}>输入 <code>{confirmDelete.name}</code> 确认：</p>
            <input
              autoFocus
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder={confirmDelete.name}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && confirmText === confirmDelete.name) doDelete();
                if (e.key === 'Escape') cancelDelete();
              }}
              className="modal-input"
            />
            {deleteError && <div className="modal-error">删除失败：{deleteError}</div>}
            <div className="modal-actions">
              <button onClick={cancelDelete} disabled={deleting}>取消</button>
              <button className="danger" disabled={confirmText !== confirmDelete.name || deleting} onClick={doDelete}>
                {deleting ? '处理中…' : '移到废纸篓'}
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
