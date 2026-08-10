import { ArrowUpRight, Bell, CalendarDays, ChartNoAxesCombined, Check, ChevronDown, ChevronLeft, ChevronRight, CircleHelp, Clock3, Ellipsis, FolderKanban, LayoutDashboard, List, Pause, Play, Plus, Search, Settings, SlidersHorizontal, TriangleAlert, UsersRound, X, type LucideIcon } from "lucide-react";
import type { IconName } from "../types/navigation";

const icons: Record<IconName, LucideIcon> = {
  grid: LayoutDashboard,
  clock: Clock3,
  folder: FolderKanban,
  chart: ChartNoAxesCombined,
  users: UsersRound,
  settings: Settings,
  search: Search,
  filter: SlidersHorizontal,
  list: List,
  more: Ellipsis,
  chevron: ChevronDown,
  "chevron-left": ChevronLeft,
  "chevron-right": ChevronRight,
  calendar: CalendarDays,
  play: Play,
  pause: Pause,
  arrow: ArrowUpRight,
  check: Check,
  warning: TriangleAlert,
  plus: Plus,
  help: CircleHelp,
  close: X,
  bell: Bell,
};

export function Icon({ name, size = 17 }: { name: IconName; size?: number }) {
  const Glyph = icons[name];
  return <Glyph className="icon" size={size} strokeWidth={1.8} aria-hidden="true" focusable="false" />;
}
