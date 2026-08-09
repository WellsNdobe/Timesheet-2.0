import { useEffect, useMemo, useState } from "react";
import { AuthExperience } from "./auth/AuthExperience";

type PageKey = "Overview" | "Time entries" | "Projects" | "Reports" | "Clients" | "Settings";
type ViewMode = "grid" | "list";
type IconName = "grid" | "clock" | "folder" | "chart" | "users" | "settings" | "search" | "filter" | "list" | "more" | "chevron" | "calendar" | "play" | "pause" | "arrow" | "check" | "warning" | "plus";

const workspaceItems: Array<{ label: PageKey; icon: IconName; badge?: string }> = [
  { label: "Overview", icon: "grid" },
  { label: "Time entries", icon: "clock", badge: "13" },
  { label: "Projects", icon: "folder" },
  { label: "Reports", icon: "chart" },
];

const manageItems: Array<{ label: PageKey; icon: IconName }> = [
  { label: "Clients", icon: "users" },
  { label: "Settings", icon: "settings" },
];

const projects = [
  { name: "Northstar redesign", client: "Northstar Labs", code: "NS-2401", hours: "18h 20m", budget: "32h", progress: 57, color: "blue", status: "On track" },
  { name: "Cedar & Co. website", client: "Cedar & Co.", code: "CED-108", hours: "12h 45m", budget: "24h", progress: 53, color: "green", status: "On track" },
  { name: "Atlas product audit", client: "Atlas Ventures", code: "AT-031", hours: "8h 10m", budget: "16h", progress: 51, color: "purple", status: "Needs review" },
  { name: "Juniper campaign", client: "Juniper House", code: "JUN-082", hours: "5h 25m", budget: "20h", progress: 27, color: "orange", status: "On track" },
  { name: "Internal operations", client: "Tempo Studio", code: "INT-001", hours: "3h 40m", budget: "—", progress: 0, color: "gray", status: "Non-billable" },
  { name: "Lumen mobile app", client: "Lumen Health", code: "LUM-444", hours: "2h 55m", budget: "40h", progress: 11, color: "pink", status: "On track" },
];

const pageCopy: Record<Exclude<PageKey, "Overview">, { eyebrow: string; title: string; detail: string }> = {
  "Time entries": { eyebrow: "WORKSPACE", title: "Time entries", detail: "Review, edit, and approve the hours your team has logged." },
  Projects: { eyebrow: "WORKSPACE", title: "Projects", detail: "Keep budgets, clients, and project progress in one place." },
  Reports: { eyebrow: "INSIGHTS", title: "Reports", detail: "A clear view of time, capacity, and value will appear here." },
  Clients: { eyebrow: "MANAGE", title: "Clients", detail: "Client relationships and project activity will appear here." },
  Settings: { eyebrow: "PREFERENCES", title: "Settings", detail: "Workspace settings and preferences will appear here." },
};

function Icon({ name, size = 17 }: { name: IconName; size?: number }) {
  const glyphs: Record<IconName, string> = {
    grid: "▦", clock: "◷", folder: "□", chart: "⌁", users: "♧", settings: "⚙", search: "⌕", filter: "≡", list: "☷", more: "···", chevron: "⌄", calendar: "▣", play: "▶", pause: "Ⅱ", arrow: "↗", check: "✓", warning: "!", plus: "+",
  };
  return <span className="icon" aria-hidden="true" style={{ fontSize: size }}>{glyphs[name]}</span>;
}

function ProjectCard({ project, viewMode }: { project: typeof projects[number]; viewMode: ViewMode }) {
  return (
    <article className={`project-card ${viewMode === "list" ? "project-card--list" : ""}`}>
      <div className="project-card__top">
        <span className={`project-logo project-logo--${project.color}`}>{project.name.charAt(0)}</span>
        <div className="project-card__identity"><strong>{project.name}</strong><span>{project.client}</span></div>
        <button className="bare-button" type="button" aria-label={`More options for ${project.name}`}><Icon name="more" /></button>
      </div>
      <div className="project-card__meta"><span>{project.code}</span><span className={`project-status project-status--${project.status === "Needs review" ? "review" : "active"}`}><i />{project.status}</span></div>
      <div className="project-card__summary"><strong>{project.hours}</strong><span>of {project.budget}</span></div>
      <div className="progress-track"><i style={{ width: `${project.progress}%` }} /></div>
      <div className="project-card__footer"><span>{project.progress ? `${project.progress}% of budget` : "No budget set"}</span><button type="button">Open project <Icon name="arrow" size={13} /></button></div>
    </article>
  );
}

function UsageCard() {
  return (
    <article className="panel usage-card">
      <div className="panel-heading"><div><p className="section-kicker">USAGE</p><h2>This week</h2></div><button className="subtle-button" type="button">Mar 10 – 16 <Icon name="chevron" size={13} /></button></div>
      <div className="usage-value"><strong>24h 40m</strong><span>of 40h target</span></div>
      <div className="progress-track progress-track--large"><i style={{ width: "62%" }} /></div>
      <div className="usage-stats"><span>Billable <b>18h 20m</b></span><span>Non-billable <b>6h 20m</b></span></div>
      <div className="usage-divider" />
      <div className="usage-detail"><span>Tracked value</span><strong>R 18,420</strong></div>
    </article>
  );
}

function ActivityCard() {
  const entries = [
    ["Northstar redesign", "Interface review", "2h 20m", "Today"],
    ["Cedar & Co. website", "Content system", "1h 45m", "Yesterday"],
    ["Atlas product audit", "Research synthesis", "3h 10m", "Yesterday"],
  ];
  return (
    <article className="panel activity-card">
      <div className="panel-heading"><div><p className="section-kicker">RECENT ACTIVITY</p><h2>Latest entries</h2></div><button className="link-button" type="button">See all</button></div>
      <div className="activity-list">{entries.map(([project, task, time, date]) => <div className="activity-row" key={`${project}-${task}`}><span className="activity-avatar">{project.charAt(0)}</span><div className="activity-row__copy"><strong>{task}</strong><span>{project}</span></div><div className="activity-row__time"><strong>{time}</strong><span>{date}</span></div></div>)}</div>
    </article>
  );
}

const overviewBreakdown = [
  { name: "Northstar redesign", client: "Northstar Labs", hours: "18h 20m", value: "R 9,200", share: 74, color: "blue" },
  { name: "Cedar & Co. website", client: "Cedar & Co.", hours: "12h 45m", value: "R 5,100", share: 52, color: "green" },
  { name: "Atlas product audit", client: "Atlas Ventures", hours: "8h 10m", value: "R 3,280", share: 34, color: "purple" },
  { name: "Juniper campaign", client: "Juniper House", hours: "5h 25m", value: "R 2,170", share: 23, color: "orange" },
];

function ActivityChart() {
  const bars = [{ day: "Mon", total: 62, billable: 45 }, { day: "Tue", total: 78, billable: 68 }, { day: "Wed", total: 48, billable: 34 }, { day: "Thu", total: 91, billable: 72 }, { day: "Fri", total: 70, billable: 58 }, { day: "Sat", total: 18, billable: 12 }, { day: "Sun", total: 8, billable: 0 }];
  return <div className="activity-chart"><div className="chart-axis"><span>8h</span><span>4h</span><span>0h</span></div><div className="chart-bars">{bars.map((bar) => <div className="chart-column" key={bar.day}><div className="chart-bar"><i style={{ height: `${bar.total}%` }} /><b style={{ height: `${bar.billable}%` }} /></div><span>{bar.day}</span></div>)}</div><div className="chart-legend"><span><i className="legend-total" />Total hours</span><span><i className="legend-billable" />Billable hours</span></div></div>;
}

function OverviewPage({ onLogTime }: { onLogTime: () => void }) {
  const [timerRunning, setTimerRunning] = useState(false);
  return <>
    <header className="content-header overview-header"><div><p className="breadcrumb">All workspaces <Icon name="chevron" size={13} /></p><h1>Overview</h1><p className="page-subtitle">A clear view of where your team’s time is going.</p></div><button className="bare-button" type="button" aria-label="More overview options"><Icon name="more" size={21} /></button></header>
    <div className="overview-toolbar"><button className="subtle-button" type="button"><Icon name="calendar" size={14} /> Mar 10 – 16 <Icon name="chevron" size={13} /></button><button className="subtle-button" type="button"><Icon name="filter" size={14} /> All projects <Icon name="chevron" size={13} /></button><button className="primary-button overview-log-button" type="button" onClick={onLogTime}><Icon name="plus" size={16} /> Log time</button></div>
    <section className="overview-kpis" aria-label="Time summary"><article className="panel overview-kpi"><span>Total hours</span><strong>24h 40m</strong><small>+8% from last week</small></article><article className="panel overview-kpi"><span>Billable hours</span><strong>18h 20m</strong><small>74% of total time</small></article><article className="panel overview-kpi"><span>Billable amount</span><strong>R 18,420</strong><small>Across 4 projects</small></article><article className="panel overview-kpi"><span>Project budget</span><strong>62%</strong><small>R 11,380 remaining</small></article></section>
    <section className="overview-report-grid"><article className="panel overview-panel activity-report"><div className="panel-heading"><div><p className="section-kicker">ACTIVITY</p><h2>Hours logged</h2></div><span className="report-caption">This week</span></div><ActivityChart /></article><article className="panel overview-panel distribution-report"><div className="panel-heading"><div><p className="section-kicker">DISTRIBUTION</p><h2>Time by project</h2></div><button className="link-button" type="button">View report <Icon name="arrow" size={13} /></button></div><div className="distribution-list">{overviewBreakdown.map((row) => <div className="distribution-row" key={row.name}><div className={`distribution-logo distribution-logo--${row.color}`}>{row.name.charAt(0)}</div><div className="distribution-copy"><strong>{row.name}</strong><span>{row.client}</span><div className="distribution-track"><i style={{ width: `${row.share}%` }} /></div></div><div className="distribution-value"><strong>{row.hours}</strong><span>{row.value}</span></div></div>)}</div></article></section>
    <section className="overview-lower-grid"><article className="panel overview-panel attention-report"><div className="panel-heading"><div><p className="section-kicker">ATTENTION</p><h2>Needs a closer look</h2></div></div><div className="attention-item"><span className="attention-icon attention-icon--warning"><Icon name="warning" size={13} /></span><div><strong>Atlas product audit is near its budget</strong><span>8h 10m of 16h used · 51%</span></div><button className="link-button" type="button">Open <Icon name="arrow" size={13} /></button></div><div className="attention-item"><span className="attention-icon attention-icon--success"><Icon name="check" size={13} /></span><div><strong>All entries are up to date</strong><span>Your week is ready for review.</span></div></div></article><ActivityCard /></section>
    <section className="timer-strip"><div className="timer-strip__status"><span className={timerRunning ? "status-dot status-dot--running" : "status-dot"} /><div><strong>{timerRunning ? "Timer running" : "Ready to track"}</strong><span>{timerRunning ? "Northstar redesign · Interface review" : "Start a timer for your next task"}</span></div></div><strong className="timer-strip__clock">{timerRunning ? "00:18:42" : "00:00:00"}</strong><button className={timerRunning ? "timer-button timer-button--stop" : "timer-button"} type="button" onClick={() => setTimerRunning((value) => !value)}><Icon name={timerRunning ? "pause" : "play"} size={14} />{timerRunning ? "Stop timer" : "Start timer"}</button></section>
  </>;
}

function LegacyOverviewPage({ onLogTime }: { onLogTime: () => void }) {
  const [query, setQuery] = useState("");
  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  const [timerRunning, setTimerRunning] = useState(false);
  const filteredProjects = useMemo(() => projects.filter((project) => `${project.name} ${project.client}`.toLowerCase().includes(query.toLowerCase())), [query]);

  return (
    <>
      <header className="content-header"><div><p className="breadcrumb">All workspaces <Icon name="chevron" size={13} /></p><h1>Overview</h1></div><button className="bare-button" type="button" aria-label="More overview options"><Icon name="more" size={21} /></button></header>
      <div className="workspace-toolbar">
        <label className="search-field"><Icon name="search" size={20} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search projects..." /></label>
        <button className="icon-button" type="button" aria-label="Filter projects"><Icon name="filter" size={19} /></button>
        <div className="view-switcher"><button className={viewMode === "grid" ? "is-selected" : ""} type="button" onClick={() => setViewMode("grid")} aria-label="Grid view"><Icon name="grid" /></button><button className={viewMode === "list" ? "is-selected" : ""} type="button" onClick={() => setViewMode("list")} aria-label="List view"><Icon name="list" /></button></div>
        <button className="primary-button" type="button" onClick={onLogTime}><Icon name="plus" size={16} /> Log time <Icon name="chevron" size={14} /></button>
      </div>

      <div className="dashboard-columns">
        <section className="dashboard-sidebar"><h2 className="section-title">Summary</h2><UsageCard /><article className="panel alert-card"><div className="alert-card__icon"><Icon name="check" size={16} /></div><div><strong>Everything is up to date</strong><p>Your entries are ready for review.</p></div><button className="bare-button" type="button"><Icon name="more" /></button></article><ActivityCard /></section>
        <section className="projects-section"><div className="section-row"><h2 className="section-title">Projects <span>{filteredProjects.length}</span></h2><button className="link-button" type="button">View all <Icon name="arrow" size={13} /></button></div><div className={`projects-grid ${viewMode === "list" ? "projects-grid--list" : ""}`}>{filteredProjects.map((project) => <ProjectCard key={project.code} project={project} viewMode={viewMode} />)}</div>{filteredProjects.length === 0 && <div className="panel no-results"><Icon name="search" size={23} /><strong>No projects found</strong><span>Try another project or client name.</span></div>}</section>
      </div>

      <section className="timer-strip"><div className="timer-strip__status"><span className={timerRunning ? "status-dot status-dot--running" : "status-dot"} /><div><strong>{timerRunning ? "Timer running" : "Ready to track"}</strong><span>{timerRunning ? "Northstar redesign · Interface review" : "Start a timer for your next task"}</span></div></div><strong className="timer-strip__clock">{timerRunning ? "00:18:42" : "00:00:00"}</strong><button className={timerRunning ? "timer-button timer-button--stop" : "timer-button"} type="button" onClick={() => setTimerRunning((value) => !value)}><Icon name={timerRunning ? "pause" : "play"} size={14} />{timerRunning ? "Stop timer" : "Start timer"}</button></section>
    </>
  );
}

type TimesheetRow = { id: string; project: string; task: string; color: "blue" | "green" | "purple" | "orange" | "gray"; values: string[] };

const initialTimesheetRows: TimesheetRow[] = [
  { id: "northstar-design", project: "Northstar redesign", task: "Interface review", color: "blue", values: ["2:20", "1:45", "3:10", "2:05", "1:30", "", ""] },
  { id: "northstar-system", project: "Northstar redesign", task: "Design system", color: "blue", values: ["", "2:10", "", "1:40", "", "", ""] },
  { id: "cedar-content", project: "Cedar & Co. website", task: "Content system", color: "green", values: ["1:15", "", "1:45", "", "2:00", "", ""] },
  { id: "atlas-research", project: "Atlas product audit", task: "Research synthesis", color: "purple", values: ["", "2:30", "1:40", "", "", "", ""] },
];

const timesheetDays = ["Mon 10", "Tue 11", "Wed 12", "Thu 13", "Fri 14", "Sat 15", "Sun 16"];
const durationMinutes = (value: string) => {
  const [hours = "0", minutes = "0"] = value.split(":");
  const parsedHours = Number(hours);
  const parsedMinutes = Number(minutes);
  return Number.isFinite(parsedHours) && Number.isFinite(parsedMinutes) ? (parsedHours * 60) + parsedMinutes : 0;
};
const formatDuration = (minutes: number) => `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`;

function TimesheetPage() {
  const [rows, setRows] = useState<TimesheetRow[]>(initialTimesheetRows);
  const [activeTimerRow, setActiveTimerRow] = useState<string | null>(null);
  const projectNames = projects.slice(0, 4).map((project) => project.name);
  const updateCell = (rowId: string, dayIndex: number, value: string) => setRows((current) => current.map((row) => row.id === rowId ? { ...row, values: row.values.map((cell, index) => index === dayIndex ? value : cell) } : row));
  const updateRow = (rowId: string, field: "project" | "task", value: string) => setRows((current) => current.map((row) => row.id === rowId ? { ...row, [field]: value } : row));
  const addRow = () => setRows((current) => [...current, { id: `entry-${Date.now()}`, project: "", task: "", color: "gray", values: Array(7).fill("") }]);
  const dailyTotals = timesheetDays.map((_, index) => rows.reduce((total, row) => total + durationMinutes(row.values[index]), 0));
  const weeklyTotal = dailyTotals.reduce((total, minutes) => total + minutes, 0);

  return <>
    <header className="content-header timesheet-header"><div><p className="breadcrumb">Workspace <Icon name="chevron" size={13} /> Track</p><h1>Time entries</h1><p className="page-subtitle">Fill out your week in one place, then review and submit it when it is ready.</p></div><button className="bare-button" type="button" aria-label="More time-entry options"><Icon name="more" size={21} /></button></header>
    <div className="timesheet-toolbar"><div className="timesheet-period"><button className="icon-button timesheet-period__arrow" type="button" aria-label="Previous week">‹</button><button className="subtle-button" type="button"><Icon name="calendar" size={14} /> Mar 10 – 16, 2025 <Icon name="chevron" size={13} /></button><button className="icon-button timesheet-period__arrow" type="button" aria-label="Next week">›</button></div><div className="timesheet-toolbar__actions"><button className="subtle-button" type="button">Copy last week</button><button className="primary-button" type="button" onClick={addRow}><Icon name="plus" size={16} /> Log time</button></div></div>
    <section className="timesheet-summary"><div><span>This week</span><strong>{formatDuration(weeklyTotal)}</strong><small>of 40h target</small></div><div className="timesheet-summary__progress"><i style={{ width: `${Math.min((weeklyTotal / (40 * 60)) * 100, 100)}%` }} /></div><div className="timesheet-summary__meta"><span>Billable <b>{formatDuration(Math.round(weeklyTotal * 0.74))}</b></span><span>Draft</span></div><button className="subtle-button" type="button">Submit timesheet <Icon name="arrow" size={13} /></button></section>
    <section className="panel timesheet-grid-card" aria-label="Weekly timesheet"><div className="timesheet-grid-card__heading"><div><p className="section-kicker">WEEKLY TIMESHEET</p><h2>Log your hours</h2></div><p>Enter a duration in <b>h:mm</b>, or use the row timer.</p></div><div className="timesheet-scroll"><table className="timesheet-table"><thead><tr><th className="timesheet-table__work">Project &amp; task</th>{timesheetDays.map((day) => <th key={day}>{day}</th>)}<th>Total</th><th aria-label="Timer" /></tr></thead><tbody>{rows.map((row) => { const rowTotal = row.values.reduce((total, value) => total + durationMinutes(value), 0); const timerActive = activeTimerRow === row.id; return <tr key={row.id}><td className="timesheet-table__work"><span className={`timesheet-project-mark timesheet-project-mark--${row.color}`}>{row.project ? row.project.charAt(0) : "+"}</span><div><select value={row.project} onChange={(event) => updateRow(row.id, "project", event.target.value)} aria-label="Project"><option value="">Select project</option>{projectNames.map((name) => <option value={name} key={name}>{name}</option>)}</select><input value={row.task} onChange={(event) => updateRow(row.id, "task", event.target.value)} placeholder="Add task or description" aria-label="Task or description" /></div></td>{row.values.map((value, index) => <td key={`${row.id}-${timesheetDays[index]}`}><input className="timesheet-duration-input" value={value} onChange={(event) => updateCell(row.id, index, event.target.value)} placeholder="0:00" inputMode="numeric" aria-label={`${row.project || "New entry"} on ${timesheetDays[index]}`} /></td>)}<td className="timesheet-row-total">{formatDuration(rowTotal)}</td><td><button className={timerActive ? "timesheet-timer timesheet-timer--active" : "timesheet-timer"} type="button" onClick={() => setActiveTimerRow((current) => current === row.id ? null : row.id)} aria-label={timerActive ? "Stop timer" : "Start timer"}><Icon name={timerActive ? "pause" : "play"} size={12} /></button></td></tr>; })}</tbody><tfoot><tr><td>Total</td>{dailyTotals.map((total, index) => <td key={timesheetDays[index]}>{formatDuration(total)}</td>)}<td>{formatDuration(weeklyTotal)}</td><td /></tr></tfoot></table></div><button className="timesheet-add-row" type="button" onClick={addRow}><Icon name="plus" size={15} /> Add row</button></section>
    <section className="timesheet-footnote"><span className="attention-icon attention-icon--success"><Icon name="check" size={13} /></span><div><strong>Your week is ready to review</strong><span>You can still adjust entries until you submit your timesheet for review.</span></div></section>
  </>;
}

function PlaceholderPage({ page }: { page: Exclude<PageKey, "Overview"> }) {
  if (page === "Time entries") return <TimesheetPage />;
  const copy = pageCopy[page];
  return <><header className="content-header"><div><p className="breadcrumb">Workspace <Icon name="chevron" size={13} /></p><h1>{copy.title}</h1><p className="page-subtitle">{copy.detail}</p></div><button className="bare-button" type="button"><Icon name="more" size={21} /></button></header><div className="panel placeholder-card"><div className="placeholder-icon"><Icon name={page === "Projects" ? "folder" : page === "Reports" ? "chart" : page === "Settings" ? "settings" : "grid"} size={22} /></div><h2>{copy.title} is ready for your next pass</h2><p>This workspace keeps the same focused, low-noise foundation across every view.</p></div></>;
}

function Dashboard() {
  const [activePage, setActivePage] = useState<PageKey>("Overview");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [logOpen, setLogOpen] = useState(false);
  const selectPage = (page: PageKey) => { setActivePage(page); setSidebarOpen(false); };
  const renderItems = (items: Array<{ label: PageKey; icon: IconName; badge?: string }>) => items.map((item) => <button key={item.label} className={`nav-item ${activePage === item.label ? "nav-item--active" : ""}`} type="button" onClick={() => selectPage(item.label)}><Icon name={item.icon} /><span>{item.label}</span>{item.badge && <b>{item.badge}</b>}</button>);

  return <div className="app-shell"><aside className={`sidebar ${sidebarOpen ? "sidebar--open" : ""}`}><div className="brand"><span className="brand-mark">T</span><strong>tempo<span>ledger</span></strong></div><button className="workspace-switcher" type="button"><span>TS</span><div><strong>Tempo Studio</strong><small>Personal workspace</small></div><Icon name="chevron" size={15} /></button><label className="sidebar-search"><Icon name="search" size={18} /><input placeholder="Search..." /></label><nav aria-label="Main navigation"><p className="nav-label">WORKSPACE</p>{renderItems(workspaceItems)}<div className="nav-divider" /><p className="nav-label">MANAGE</p>{renderItems(manageItems)}</nav><div className="sidebar-footer"><button type="button"><span className="help-icon">?</span> Help center</button><small>TempoLedger v1.0</small></div></aside>{sidebarOpen && <button className="sidebar-scrim" type="button" aria-label="Close navigation" onClick={() => setSidebarOpen(false)} />}<main className="main-content"><header className="topbar"><button className="mobile-menu" type="button" aria-label="Open navigation" onClick={() => setSidebarOpen(true)}><Icon name="list" size={21} /></button><div className="topbar-actions"><button type="button" aria-label="Search"><Icon name="search" /></button><button type="button" aria-label="Notifications"><span className="notification-dot" /></button><button className="user-menu" type="button"><span>MC</span><strong>Maia Chen</strong><Icon name="chevron" size={13} /></button></div></header><div className="page-content">{activePage === "Overview" ? <OverviewPage onLogTime={() => setLogOpen(true)} /> : <PlaceholderPage page={activePage} />}</div></main>{logOpen && <div className="modal-backdrop" role="presentation" onClick={() => setLogOpen(false)}><section className="log-modal" role="dialog" aria-modal="true" aria-labelledby="log-title" onClick={(event) => event.stopPropagation()}><div className="modal-heading"><div><p className="section-kicker">NEW ENTRY</p><h2 id="log-title">Log time</h2></div><button className="bare-button" type="button" onClick={() => setLogOpen(false)} aria-label="Close dialog">×</button></div><label>Project<select defaultValue="Northstar redesign"><option>Northstar redesign</option><option>Cedar &amp; Co. website</option><option>Atlas product audit</option></select></label><label>Description<input defaultValue="Interface review" /></label><div className="modal-fields"><label>Date<input type="date" defaultValue="2025-03-12" /></label><label>Duration<input defaultValue="02:20" /></label></div><div className="modal-actions"><button className="subtle-button" type="button" onClick={() => setLogOpen(false)}>Cancel</button><button className="primary-button" type="button" onClick={() => setLogOpen(false)}>Save entry</button></div></section></div>}</div>;
}

export default function App() {
  const [path, setPath] = useState(window.location.pathname);

  useEffect(() => {
    const handlePopState = () => setPath(window.location.pathname);
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  if (path === "/signup" || path === "/login") {
    return (
      <AuthExperience
        mode={path === "/signup" ? "signup" : "login"}
        onAuthenticated={() => {
          window.history.pushState({}, "", "/");
          setPath("/");
        }}
      />
    );
  }

  return <Dashboard />;
}
