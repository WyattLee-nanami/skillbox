import { useState } from 'react';
import Skills from './Skills';
import Stats from './Stats';
import History from './History';

type Tab = 'skills' | 'stats' | 'history';

export default function App() {
  const [tab, setTab] = useState<Tab>('skills');

  return (
    <div className="app-shell">
      <nav className="topbar">
        <div className="topbar-brand">
          <span className="brand-dot" /> Skillbox
        </div>
        <div className="topbar-tabs">
          <button className={tab === 'skills' ? 'active' : ''} onClick={() => setTab('skills')}>
            Skills
          </button>
          <button className={tab === 'stats' ? 'active' : ''} onClick={() => setTab('stats')}>
            统计
          </button>
          <button className={tab === 'history' ? 'active' : ''} onClick={() => setTab('history')}>
            历史
          </button>
        </div>
      </nav>
      <main className="content">
        {tab === 'skills' && <Skills />}
        {tab === 'stats' && <Stats />}
        {tab === 'history' && <History />}
      </main>
    </div>
  );
}
