import { useState, type ReactNode } from "react";
import { Icon } from "./Icon";
import type { IconName, PageKey } from "../types/navigation";

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

function Sidebar({ activePage, onSelect, open, onClose }: { activePage: PageKey; onSelect: (page: PageKey) => void; open: boolean; onClose: () => void }) {
  const renderItems = (items: Array<{ label: PageKey; icon: IconName; badge?: string }>) => items.map((item) => (
    <button key={item.label} className={`nav-item ${activePage === item.label ? "nav-item--active" : ""}`} type="button" onClick={() => { onSelect(item.label); onClose(); }}>
      <Icon name={item.icon} /><span>{item.label}</span>{item.badge && <b>{item.badge}</b>}
    </button>
  ));

  return <aside className={`sidebar ${open ? "sidebar--open" : ""}`}><div className="brand"><span className="brand-mark">T</span><strong>tempo<span>ledger</span></strong></div><button className="workspace-switcher" type="button"><span>TS</span><div><strong>Tempo Studio</strong><small>Personal workspace</small></div><Icon name="chevron" size={15} /></button><label className="sidebar-search"><Icon name="search" size={18} /><input placeholder="Search..." /></label><nav aria-label="Main navigation"><p className="nav-label">WORKSPACE</p>{renderItems(workspaceItems)}<div className="nav-divider" /><p className="nav-label">MANAGE</p>{renderItems(manageItems)}</nav><div className="sidebar-footer"><button type="button"><Icon name="help" size={17} /> Help center</button><small>TempoLedger v1.0</small></div></aside>;
}

function Topbar({ onOpenSidebar }: { onOpenSidebar: () => void }) {
  return <header className="topbar"><button className="mobile-menu" type="button" aria-label="Open navigation" onClick={onOpenSidebar}><Icon name="list" size={21} /></button><div className="topbar-actions"><button type="button" aria-label="Search"><Icon name="search" /></button><button type="button" aria-label="Notifications"><Icon name="bell" /><span className="notification-dot" /></button><button className="user-menu" type="button"><span>MC</span><strong>Maia Chen</strong><Icon name="chevron" size={13} /></button></div></header>;
}

function LogTimeModal({ onClose }: { onClose: () => void }) {
  return <div className="modal-backdrop" role="presentation" onClick={onClose}><section className="log-modal" role="dialog" aria-modal="true" aria-labelledby="log-title" onClick={(event) => event.stopPropagation()}><div className="modal-heading"><div><p className="section-kicker">NEW ENTRY</p><h2 id="log-title">Log time</h2></div><button className="bare-button" type="button" onClick={onClose} aria-label="Close dialog"><Icon name="close" size={18} /></button></div><label>Project<select defaultValue="Northstar redesign"><option>Northstar redesign</option><option>Cedar &amp; Co. website</option><option>Atlas product audit</option></select></label><label>Description<input defaultValue="Interface review" /></label><div className="modal-fields"><label>Date<input type="date" defaultValue="2025-03-12" /></label><label>Duration<input defaultValue="02:20" /></label></div><div className="modal-actions"><button className="subtle-button" type="button" onClick={onClose}>Cancel</button><button className="primary-button" type="button" onClick={onClose}>Save entry</button></div></section></div>;
}

export function DashboardLayout({ activePage, onSelectPage, children }: { activePage: PageKey; onSelectPage: (page: PageKey) => void; children: (onLogTime: () => void) => ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [logOpen, setLogOpen] = useState(false);

  return <div className="app-shell"><Sidebar activePage={activePage} onSelect={onSelectPage} open={sidebarOpen} onClose={() => setSidebarOpen(false)} />{sidebarOpen && <button className="sidebar-scrim" type="button" aria-label="Close navigation" onClick={() => setSidebarOpen(false)} />}<main className="main-content"><Topbar onOpenSidebar={() => setSidebarOpen(true)} /><div className="page-content">{children(() => setLogOpen(true))}</div></main>{logOpen && <LogTimeModal onClose={() => setLogOpen(false)} />}</div>;
}
