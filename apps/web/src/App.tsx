import { useState } from "react";

type PageKey =
  | "Overview"
  | "Time entries"
  | "Projects"
  | "Reports"
  | "Clients"
  | "Settings";

const workspaceItems: Array<{ label: PageKey; icon: string; badge?: string }> = [
  { label: "Overview", icon: "▦" },
  { label: "Time entries", icon: "◷", badge: "13" },
  { label: "Projects", icon: "▤" },
  { label: "Reports", icon: "▥" },
];

const manageItems: Array<{ label: PageKey; icon: string }> = [
  { label: "Clients", icon: "♙" },
  { label: "Settings", icon: "⚙" },
];

const pageCopy: Record<Exclude<PageKey, "Overview">, { eyebrow: string; title: string; detail: string }> = {
  "Time entries": {
    eyebrow: "TRACK YOUR WORK",
    title: "Time entries",
    detail: "Your logged time will live here.",
  },
  Projects: {
    eyebrow: "WORKSPACE",
    title: "Projects",
    detail: "Projects, budgets, and progress will appear here.",
  },
  Reports: {
    eyebrow: "INSIGHTS",
    title: "Reports",
    detail: "A clear view of time, capacity, and value will appear here.",
  },
  Clients: {
    eyebrow: "MANAGE",
    title: "Clients",
    detail: "Client relationships and project activity will appear here.",
  },
  Settings: {
    eyebrow: "PREFERENCES",
    title: "Settings",
    detail: "Workspace settings and preferences will appear here.",
  },
};

function PlaceholderPage({ page }: { page: Exclude<PageKey, "Overview"> }) {
  const copy = pageCopy[page];

  return (
    <>
      <section className="page-heading">
        <p className="eyebrow">{copy.eyebrow}</p>
        <h1>{copy.title}</h1>
        <p className="page-subtitle">{copy.detail}</p>
      </section>

      <section className="placeholder-card">
        <div className="placeholder-icon" aria-hidden="true">+</div>
        <h2>{copy.title} placeholder</h2>
        <p>This space is ready for the next implementation pass.</p>
      </section>
    </>
  );
}

function OverviewPage() {
  return (
    <>
      <section className="page-heading overview-heading">
        <p className="eyebrow">MONDAY, MARCH 10, 2025</p>
        <h1>Good morning, Maia</h1>
        <p className="page-subtitle">Your week is moving with intention. Here&apos;s the shape of your work so far.</p>
      </section>

      <div className="overview-toolbar">
        <button className="week-control" type="button" aria-label="Select week">
          <span>‹</span><span className="calendar-glyph">▣</span> Mar 10 – 16, 2025 <span>›</span>
        </button>
        <button className="primary-button" type="button">+&nbsp; Log time</button>
      </div>

      <section className="metric-grid" aria-label="Weekly time summary placeholders">
        <article className="metric-card metric-card--dark">
          <span>This week</span>
          <strong>--h --m</strong>
          <small>↗ Awaiting time entries</small>
        </article>
        <article className="metric-card">
          <span>Billable time</span>
          <strong>--h --m</strong>
          <div className="metric-line"><i /></div>
          <small>of total</small>
        </article>
        <article className="metric-card">
          <span>Utilization</span>
          <strong>--%</strong>
          <small>Set a weekly target to track this</small>
        </article>
        <article className="metric-card metric-card--gold">
          <span>Tracked value</span>
          <strong>R --</strong>
          <small>Set project rates to calculate value</small>
        </article>
      </section>

      <section className="overview-grid">
        <article className="timer-card">
          <div className="timer-card__top"><span><i /> READY TO TRACK</span><button type="button" aria-label="Timer options">•••</button></div>
          <p>What are you working on?</p>
          <div className="timer-clock">00:00:00 <button type="button" aria-label="Start timer">▶</button></div>
          <div className="timer-card__bottom"><span>▤&nbsp; No project selected</span><button type="button">◷&nbsp; Add manual time</button></div>
        </article>

        <article className="content-card distribution-card">
          <div className="card-heading"><div><p className="eyebrow">TIME DISTRIBUTION</p><h2>Hours by day</h2></div><button type="button">This week⌄</button></div>
          <div className="chart-summary"><strong>--h --m</strong><span>↗ Your weekly view will appear here</span></div>
          <div className="bar-chart" aria-label="Empty weekly hours chart">
            {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((day, index) => <div className="bar-column" key={day}><i style={{ height: `${index > 4 ? 8 : 22 + index * 8}%` }} /><span>{day}</span></div>)}
          </div>
          <div className="chart-legend"><span><i className="dot dot--gold" /> Billable <b>--h --m</b></span><span><i className="dot dot--sage" /> Non-billable <b>--h --m</b></span></div>
        </article>
      </section>

      <section className="bottom-grid">
        <article className="content-card activity-card">
          <div className="card-heading"><div><p className="eyebrow">RECENT ACTIVITY</p><h2>Latest entries</h2></div><button type="button">See all</button></div>
          <div className="empty-table"><span>◷</span><p>Recent time entries will appear here.</p></div>
        </article>
        <article className="content-card pulse-card">
          <div className="card-heading"><div><p className="eyebrow">PROJECT PULSE</p><h2>Where time is landing</h2></div><button type="button">View all</button></div>
          <div className="empty-projects"><span>▤</span><p>Your active projects will show their progress here.</p></div>
        </article>
      </section>
    </>
  );
}

export default function App() {
  const [activePage, setActivePage] = useState<PageKey>("Overview");
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const selectPage = (page: PageKey) => {
    setActivePage(page);
    setSidebarOpen(false);
  };

  const renderItems = (items: Array<{ label: PageKey; icon: string; badge?: string }>) => items.map((item) => (
    <button key={item.label} className={`nav-item ${activePage === item.label ? "nav-item--active" : ""}`} type="button" onClick={() => selectPage(item.label)}>
      <span className="nav-item__icon">{item.icon}</span><span>{item.label}</span>{item.badge && <b>{item.badge}</b>}
    </button>
  ));

  return (
    <div className="app-shell">
      <aside className={`sidebar ${sidebarOpen ? "sidebar--open" : ""}`}>
        <div className="brand"><span className="brand-mark">▥</span><strong>tempo<span>ledger</span></strong></div>
        <button className="workspace-switcher" type="button"><span>T</span><div><strong>Tempo Studio</strong><small>Personal workspace</small></div><i>⌄</i></button>
        <nav aria-label="Main navigation"><p className="nav-label">WORKSPACE</p>{renderItems(workspaceItems)}<div className="nav-divider" /><p className="nav-label">MANAGE</p>{renderItems(manageItems)}</nav>
        <div className="sidebar-pro"><strong>Make your time count.</strong><p>Unlock deeper reporting and team capacity.</p><button type="button">Explore Pro</button></div>
        <footer><span>?</span> Help center <small>TempoLedger v1.0</small></footer>
      </aside>

      {sidebarOpen && <button className="sidebar-scrim" type="button" aria-label="Close navigation" onClick={() => setSidebarOpen(false)} />}

      <main className="main-content">
        <header className="topbar">
          <button className="mobile-menu" type="button" aria-label="Open navigation" onClick={() => setSidebarOpen(true)}>☰</button>
          <div className="topbar-actions"><button type="button" aria-label="Search">⌘ K</button><button type="button" aria-label="Notifications">♧</button><button className="user-menu" type="button"><span>MC</span> Maia Chen <i>⌄</i></button></div>
        </header>
        <div className="page-content">{activePage === "Overview" ? <OverviewPage /> : <PlaceholderPage page={activePage} />}</div>
      </main>
    </div>
  );
}
