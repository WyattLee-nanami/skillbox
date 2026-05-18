import { useEffect, useMemo, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { HistoryMessage, ProjectInfo, SearchHit, SessionInfo } from './types';

function shortTime(ts: string): string {
  if (!ts) return '';
  return ts.slice(5, 16).replace('T', ' ');
}

function fmtKB(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

export default function History() {
  const [projects, setProjects] = useState<ProjectInfo[]>([]);
  const [activeProject, setActiveProject] = useState<string | null>(null);
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [activeSession, setActiveSession] = useState<string | null>(null);
  const [messages, setMessages] = useState<HistoryMessage[] | null>(null);
  const [search, setSearch] = useState('');
  const [searchResults, setSearchResults] = useState<SearchHit[] | null>(null);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    invoke<ProjectInfo[]>('list_projects').then((p) => {
      setProjects(p);
      if (p[0]) setActiveProject(p[0].id);
    });
  }, []);

  useEffect(() => {
    if (!activeProject) return;
    setSessions([]);
    setActiveSession(null);
    setMessages(null);
    invoke<SessionInfo[]>('list_sessions', { projectId: activeProject }).then((ss) => {
      setSessions(ss);
      if (ss[0]) setActiveSession(ss[0].session_id);
    });
  }, [activeProject]);

  useEffect(() => {
    if (!activeProject || !activeSession) return;
    setMessages(null);
    invoke<HistoryMessage[]>('read_session', {
      projectId: activeProject,
      sessionId: activeSession,
    })
      .then(setMessages)
      .catch(() => setMessages([]));
  }, [activeProject, activeSession]);

  const runSearch = async () => {
    const q = search.trim();
    if (!q) {
      setSearchResults(null);
      return;
    }
    setSearching(true);
    try {
      const r = await invoke<SearchHit[]>('search_history', { query: q, maxHits: 200 });
      setSearchResults(r);
    } finally {
      setSearching(false);
    }
  };

  const jumpToHit = (hit: SearchHit) => {
    setActiveProject(hit.project_id);
    setActiveSession(hit.session_id);
    setSearchResults(null);
    setSearch('');
  };

  const projectLabel = useMemo(() => {
    return projects.find((p) => p.id === activeProject)?.label ?? '';
  }, [projects, activeProject]);

  return (
    <div className="history-pane">
      <aside className="hist-sidebar">
        <div className="hist-search-wrap">
          <input
            placeholder="🔎 搜索所有历史对话…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') runSearch();
              if (e.key === 'Escape') {
                setSearch('');
                setSearchResults(null);
              }
            }}
          />
        </div>

        {searchResults ? (
          <div className="hist-list">
            <div className="hist-section-label">
              {searching ? '搜索中…' : `命中 ${searchResults.length} 条`}
            </div>
            {searchResults.map((h, i) => (
              <button key={i} className="hist-hit" onClick={() => jumpToHit(h)}>
                <div className="hit-meta">
                  <span className={`role ${h.role}`}>{h.role}</span>
                  <span className="ts">{shortTime(h.timestamp)}</span>
                </div>
                <div className="hit-snippet">{h.snippet}</div>
              </button>
            ))}
            {searchResults.length === 0 && !searching && (
              <div className="empty" style={{ padding: 20 }}>没有命中</div>
            )}
          </div>
        ) : (
          <>
            <div className="hist-section-label">项目 ({projects.length})</div>
            <div className="hist-list">
              {projects.map((p) => (
                <button
                  key={p.id}
                  className={`hist-proj${activeProject === p.id ? ' active' : ''}`}
                  onClick={() => setActiveProject(p.id)}
                  title={p.label}
                >
                  <div className="proj-label">{p.label}</div>
                  <div className="proj-meta">{p.session_count} 会话</div>
                </button>
              ))}
            </div>
          </>
        )}
      </aside>

      <section className="hist-main">
        {!searchResults && activeProject && (
          <>
            <div className="hist-sub-bar">
              <div className="proj-path">{projectLabel}</div>
              <div className="sess-count">{sessions.length} 会话</div>
            </div>
            <div className="hist-body">
              <div className="sess-col">
                {sessions.map((s) => (
                  <button
                    key={s.session_id}
                    className={`sess-item${activeSession === s.session_id ? ' active' : ''}`}
                    onClick={() => setActiveSession(s.session_id)}
                  >
                    <div className="sess-preview">
                      {s.first_user_text || <span className="muted">(空会话)</span>}
                    </div>
                    <div className="sess-meta">
                      {shortTime(new Date(s.last_modified * 1000).toISOString())} · {s.message_count} 条 · {fmtKB(s.bytes)}
                    </div>
                  </button>
                ))}
                {sessions.length === 0 && <div className="empty" style={{ padding: 20 }}>无会话</div>}
              </div>

              <div className="msg-col">
                {messages == null ? (
                  <div className="empty">加载中…</div>
                ) : messages.length === 0 ? (
                  <div className="empty">空会话</div>
                ) : (
                  messages.map((m, i) => <Message key={i} m={m} />)
                )}
              </div>
            </div>
          </>
        )}
        {searchResults && (
          <div className="empty" style={{ padding: 40, color: 'var(--muted)' }}>
            点左侧搜索结果跳转到对应会话
          </div>
        )}
      </section>
    </div>
  );
}

function Message({ m }: { m: HistoryMessage }) {
  if (m.type === 'tool_use') {
    return (
      <div className="msg msg-tool">
        <div className="msg-head">
          <span className="role tool">tool · {m.tool_name}</span>
          <span className="ts">{shortTime(m.timestamp)}</span>
        </div>
        {m.text && <div className="msg-body">{m.text}</div>}
        <details>
          <summary>input</summary>
          <pre>{tryPretty(m.tool_input)}</pre>
        </details>
      </div>
    );
  }
  if (m.type === 'tool_result') {
    return (
      <div className="msg msg-result">
        <div className="msg-head">
          <span className="role result">tool result</span>
          <span className="ts">{shortTime(m.timestamp)}</span>
        </div>
        <pre className="msg-body">{m.tool_output}</pre>
      </div>
    );
  }
  return (
    <div className={`msg msg-${m.type}`}>
      <div className="msg-head">
        <span className={`role ${m.type}`}>{m.type}</span>
        {m.model && <span className="model">{m.model}</span>}
        <span className="ts">{shortTime(m.timestamp)}</span>
      </div>
      <div className="msg-body">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.text}</ReactMarkdown>
      </div>
    </div>
  );
}

function tryPretty(s: string): string {
  try {
    return JSON.stringify(JSON.parse(s), null, 2);
  } catch {
    return s;
  }
}
