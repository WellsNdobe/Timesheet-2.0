import { useState } from "react";
import { DashboardLayout } from "./DashboardLayout";
import { OverviewPage } from "../pages/OverviewPage";
import { PlaceholderPage } from "../pages/PlaceholderPage";
import { SettingsPage } from "../pages/SettingsPage";
import { TimesheetPage } from "../pages/TimesheetPage";
import type { PageKey } from "../types/navigation";

export function Dashboard() {
  const [activePage, setActivePage] = useState<PageKey>("Overview");
  return <DashboardLayout activePage={activePage} onSelectPage={setActivePage}>{(onLogTime) => {
    if (activePage === "Overview") return <OverviewPage onLogTime={onLogTime} />;
    if (activePage === "Time entries") return <TimesheetPage />;
    if (activePage === "Settings") return <SettingsPage />;
    return <PlaceholderPage page={activePage} />;
  }}</DashboardLayout>;
}
