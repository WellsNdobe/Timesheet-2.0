import { Icon } from "../components/Icon";
import type { IconName, PageKey } from "../types/navigation";

const pageCopy: Record<Exclude<PageKey, "Overview" | "Time entries" | "Settings">, { eyebrow: string; title: string; detail: string; icon: IconName }> = {
  Projects: { eyebrow: "WORKSPACE", title: "Projects", detail: "Keep budgets, clients, and project progress in one place.", icon: "folder" },
  Reports: { eyebrow: "INSIGHTS", title: "Reports", detail: "A clear view of time, capacity, and value will appear here.", icon: "chart" },
  Clients: { eyebrow: "MANAGE", title: "Clients", detail: "Client relationships and project activity will appear here.", icon: "users" },
};

export function PlaceholderPage({ page }: { page: Exclude<PageKey, "Overview" | "Time entries" | "Settings"> }) {
  const copy = pageCopy[page];
  return <><header className="content-header"><div><p className="breadcrumb">Workspace <Icon name="chevron" size={13} /></p><h1>{copy.title}</h1><p className="page-subtitle">{copy.detail}</p></div><button className="bare-button" type="button" aria-label={`More ${copy.title.toLowerCase()} options`}><Icon name="more" size={21} /></button></header><div className="panel placeholder-card"><div className="placeholder-icon"><Icon name={copy.icon} size={22} /></div><h2>{copy.title} is ready for your next pass</h2><p>This workspace keeps the same focused, low-noise foundation across every view.</p></div></>;
}
