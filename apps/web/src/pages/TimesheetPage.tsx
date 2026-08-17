import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  createTimeEntry, deleteTimeEntry, loadProjects, loadTimeEntries, loadWeekStatus,
  submitTimesheet, updateTimeEntry, type Project, type TimeEntry, type TimeEntryWeek, type WeekStatus,
} from "../api/client";
import { Icon } from "../components/Icon";
import type { WorkspaceSummary } from "../types/workspace";

const formatMinutes = (value: number) => `${Math.floor(value / 60)}h ${String(value % 60).padStart(2, "0")}m`;
const toInputDuration = (value: number) => `${Math.floor(value / 60)}:${String(value % 60).padStart(2, "0")}`;

type ParsedDuration = { minutes: number; normalized: string } | { error: string };

const parseInputDuration = (input: string): ParsedDuration => {
  const value = input.trim();
  if (!value) return { minutes: 0, normalized: "" };
  const match = /^(\d{1,2}):([0-5]\d)$/.exec(value);
  if (!match) return { error: "Enter time as h:mm, for example 7:30." };
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const total = hours * 60 + minutes;
  if (total === 0) return { error: "Enter a duration above 0:00, or clear the cell." };
  if (total > 24 * 60) return { error: "A single entry cannot be longer than 24:00." };
  return { minutes: total, normalized: `${hours}:${String(minutes).padStart(2, "0")}` };
};

const statusLabel = (value: string) => value.replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase());
const weekDays = (weekStart: string) => Array.from({ length: 7 }, (_, index) => {
  const date = new Date(`${weekStart}T00:00:00`);
  date.setDate(date.getDate() + index);
  return { date: date.toISOString().slice(0, 10), label: date.toLocaleDateString(undefined, { weekday: "short", day: "numeric" }) };
});

type InlineRow = {
  key: string;
  projectId: string;
  description: string;
  entries: Record<string, TimeEntry>;
  draft?: boolean;
  local?: boolean;
};

type CellEdit = {
  value: string;
  status: "idle" | "saving" | "error";
  error?: string;
  retryable?: boolean;
};

export function TimesheetPage({ workspace, accessToken }: { workspace: WorkspaceSummary; accessToken: string }) {
  const selectedWeek = new URLSearchParams(window.location.search).get("week");
  const monday = new Date();
  monday.setHours(12, 0, 0, 0);
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  const weekStart = selectedWeek ?? monday.toISOString().slice(0, 10);
  const days = useMemo(() => weekDays(weekStart), [weekStart]);

  const [week, setWeek] = useState<TimeEntryWeek | null>(null);
  const [review, setReview] = useState<WeekStatus | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [localRows, setLocalRows] = useState<InlineRow[]>([]);
  const [cellEdits, setCellEdits] = useState<Record<string, CellEdit>>({});
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const cancelledBlurCells = useRef(new Set<string>());
  const savingCells = useRef(new Set<string>());

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [entries, status, projectRows] = await Promise.all([
        loadTimeEntries(workspace.id, weekStart, accessToken),
        loadWeekStatus(workspace.id, weekStart, accessToken),
        loadProjects(workspace.id, accessToken),
      ]);
      setWeek(entries);
      setReview(status);
      setProjects(projectRows);
      setMessage("");
    } catch {
      setMessage("This week could not be loaded. Try again.");
    } finally {
      setLoading(false);
    }
  }, [accessToken, weekStart, workspace.id]);

  useEffect(() => { void load(); }, [load]);

  const projectById = useMemo(() => new Map(projects.map((project) => [project.id, project])), [projects]);
  const editableProjectIds = new Set(review?.portions.filter((portion) => portion.editable).map((portion) => portion.project.id) ?? []);
  const draftWeek = (review?.status ?? week?.status ?? "draft") === "draft";
  const canEditProject = (projectId: string) => draftWeek || editableProjectIds.has(projectId);
  const availableProjects = projects.filter((project) => canEditProject(project.id));

  const rows = useMemo(() => {
    const grouped = new Map<string, InlineRow>();
    for (const entry of week?.entries ?? []) {
      const key = `${entry.projectId}:${entry.description ?? ""}`;
      const row = grouped.get(key) ?? { key, projectId: entry.projectId, description: entry.description ?? "", entries: {} };
      row.entries[entry.workDate] = entry;
      grouped.set(key, row);
    }
    return [...grouped.values(), ...localRows];
  }, [localRows, week?.entries]);

  const updateLocalRow = (key: string, update: (row: InlineRow) => InlineRow) => {
    setLocalRows((current) => current.map((row) => row.key === key ? update(row) : row));
  };

  const addRow = () => setLocalRows((current) => [...current, {
    key: `draft-${Date.now()}`,
    projectId: availableProjects[0]?.id ?? "",
    description: "",
    entries: {},
    draft: true,
    local: true,
  }]);

  const updateServerEntry = (entry: TimeEntry) => {
    setWeek((current) => current ? { ...current, entries: current.entries.map((item) => item.id === entry.id ? entry : item) } : current);
  };

  const removeServerEntry = (entryId: string) => {
    setWeek((current) => current ? { ...current, entries: current.entries.filter((entry) => entry.id !== entryId) } : current);
  };

  const setCellEdit = (cellKey: string, edit: CellEdit | null) => {
    setCellEdits((current) => {
      if (edit) return { ...current, [cellKey]: edit };
      const next = { ...current };
      delete next[cellKey];
      return next;
    });
  };

  const saveCell = async (row: InlineRow, date: string, rawValue: string) => {
    const cellKey = `${row.key}:${date}`;
    if (cancelledBlurCells.current.delete(cellKey)) return;
    if (!row.projectId || !canEditProject(row.projectId) || savingCells.current.has(cellKey)) return;

    const existing = row.entries[date];
    const confirmedValue = existing ? toInputDuration(existing.durationMinutes) : "";
    const parsed = parseInputDuration(rawValue);
    if ("error" in parsed) {
      setCellEdit(cellKey, { value: rawValue, status: "error", error: parsed.error });
      return;
    }
    if (parsed.normalized === confirmedValue || (!existing && parsed.minutes === 0)) {
      setCellEdit(cellKey, null);
      return;
    }

    savingCells.current.add(cellKey);
    setCellEdit(cellKey, { value: parsed.normalized, status: "saving" });
    try {
      if (existing && parsed.minutes === 0) {
        await deleteTimeEntry(workspace.id, existing.id, accessToken);
        if (row.local) {
          setLocalRows((current) => current.flatMap((item) => {
            if (item.key !== row.key) return [item];
            const entries = { ...item.entries };
            delete entries[date];
            return Object.keys(entries).length ? [{ ...item, entries }] : [];
          }));
        } else {
          removeServerEntry(existing.id);
        }
        setCellEdit(cellKey, null);
        return;
      }

      if (existing) {
        const response = await updateTimeEntry(workspace.id, existing.id, { durationMinutes: parsed.minutes }, accessToken);
        if (row.local) updateLocalRow(row.key, (item) => ({ ...item, entries: { ...item.entries, [date]: response.entry } }));
        else updateServerEntry(response.entry);
      } else {
        const response = await createTimeEntry(workspace.id, {
          projectId: row.projectId,
          taskId: null,
          workDate: date,
          durationMinutes: parsed.minutes,
          description: row.description || null,
          isBillable: true,
        }, accessToken);
        updateLocalRow(row.key, (item) => ({ ...item, draft: false, entries: { ...item.entries, [date]: response.entry } }));
      }
      setCellEdit(cellKey, null);
    } catch (error) {
      setCellEdit(cellKey, {
        value: parsed.normalized,
        status: "error",
        error: error instanceof Error ? error.message : "The entry could not be saved. Try again.",
        retryable: true,
      });
    } finally {
      savingCells.current.delete(cellKey);
    }
  };

  const removeRow = async (row: InlineRow) => {
    setSaving(true);
    try {
      for (const entry of Object.values(row.entries)) await deleteTimeEntry(workspace.id, entry.id, accessToken);
      if (row.local) {
        setLocalRows((current) => current.filter((item) => item.key !== row.key));
      } else {
        const entryIds = new Set(Object.values(row.entries).map((entry) => entry.id));
        setWeek((current) => current ? { ...current, entries: current.entries.filter((entry) => !entryIds.has(entry.id)) } : current);
      }
      setMessage("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The row could not be deleted.");
    } finally {
      setSaving(false);
    }
  };

  const totals = days.map((day) => rows.reduce((total, row) => total + (row.entries[day.date]?.durationMinutes ?? 0), 0));
  const weeklyTotal = totals.reduce((total, value) => total + value, 0);
  const billableTotal = rows.reduce((total, row) => total + Object.values(row.entries).filter((entry) => entry.isBillable).reduce((sum, entry) => sum + entry.durationMinutes, 0), 0);
  const hasCellSaving = Object.values(cellEdits).some((edit) => edit.status === "saving");

  const submit = async () => {
    setSaving(true);
    try {
      await submitTimesheet(workspace.id, weekStart, accessToken);
      setLocalRows([]);
      setCellEdits({});
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The timesheet could not be submitted.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <><header className="content-header"><div><h1>Time entries</h1></div></header><div className="panel inline-state"><strong>Loading your week</strong></div></>;

  return <>
    <header className="content-header">
      <div><p className="breadcrumb">Workspace <Icon name="chevron" size={13} /> Track</p><h1>Time entries</h1><p className="page-subtitle">Fill out your week directly in the table, then review and submit it.</p></div>
      {availableProjects.length > 0 && <button className="primary-button" onClick={addRow}><Icon name="plus" size={15} /> Add row</button>}
    </header>
    {message && <div className="inline-alert">{message}</div>}

    <section className="timesheet-summary">
      <div><span>This week</span><strong>{formatMinutes(weeklyTotal)}</strong><small>{formatMinutes(billableTotal)} billable</small></div>
      <div className="timesheet-summary__progress"><i style={{ width: `${Math.min(weeklyTotal / 2400 * 100, 100)}%` }} /></div>
      <div className="timesheet-summary__meta"><span>Review state</span><b>{statusLabel(review?.status ?? "draft")}</b></div>
      {(draftWeek || editableProjectIds.size > 0) && <button className="subtle-button" disabled={saving || hasCellSaving || weeklyTotal === 0} onClick={() => void submit()}>{editableProjectIds.size > 0 ? "Resubmit returned work" : "Submit timesheet"} <Icon name="arrow" size={13} /></button>}
    </section>

    {review && review.portions.length > 0 && <section className="portion-status-grid">{review.portions.map((portion) => <article className="panel portion-status-card" key={portion.approvalItemId}>
      <div><strong>{portion.project.name}</strong><span>Revision {portion.revisionNumber} · {formatMinutes(portion.submittedMinutes)}</span></div>
      <span className={`status-pill status-pill--${portion.status.replaceAll("_", "-")}`}>{statusLabel(portion.status)}</span>
      <small>Approver: {portion.assignedApprover?.email ?? "Unassigned"}</small>{portion.returnComment && <p>{portion.returnComment}</p>}
    </article>)}</section>}

    <section className="panel timesheet-grid-card" aria-label="Weekly timesheet">
      <div className="timesheet-grid-card__heading"><div><p className="section-kicker">WEEKLY TIMESHEET</p><h2>Log your hours</h2></div><p>Enter a duration in <b>h:mm</b>, then press Enter or leave the cell to save. Locked project portions are read-only.</p></div>
      <div className="timesheet-scroll"><table className="timesheet-table">
        <thead><tr><th className="timesheet-table__work">Project &amp; task</th>{days.map((day) => <th key={day.date}>{day.label}</th>)}<th>Total</th><th /></tr></thead>
        <tbody>{rows.map((row) => {
          const editable = canEditProject(row.projectId);
          const rowTotal = days.reduce((total, day) => total + (row.entries[day.date]?.durationMinutes ?? 0), 0);
          return <tr key={row.key} className={editable ? undefined : "timesheet-row--locked"}>
            <td className="timesheet-table__work"><span className="timesheet-project-mark timesheet-project-mark--blue">{projectById.get(row.projectId)?.name?.charAt(0) ?? "+"}</span><div>{row.draft ? <>
              <select value={row.projectId} onChange={(event) => updateLocalRow(row.key, (item) => ({ ...item, projectId: event.target.value }))} aria-label="Project">{availableProjects.map((project) => <option value={project.id} key={project.id}>{project.name}</option>)}</select>
              <input value={row.description} onChange={(event) => updateLocalRow(row.key, (item) => ({ ...item, description: event.target.value }))} placeholder="Add task or description" aria-label="Task or description" />
            </> : <><strong className="timesheet-project-name">{projectById.get(row.projectId)?.name ?? "Unavailable project"}</strong><span className="timesheet-description-readonly">{row.description || "No description"}</span></>}</div></td>
            {days.map((day) => {
              const cellKey = `${row.key}:${day.date}`;
              const existing = row.entries[day.date];
              const edit = cellEdits[cellKey];
              const displayedValue = edit?.value ?? (existing ? toInputDuration(existing.durationMinutes) : "");
              const errorId = `${cellKey.replace(/[^a-zA-Z0-9_-]/g, "-")}-error`;
              return <td key={cellKey} className={`timesheet-duration-cell${edit?.status === "error" ? " timesheet-duration-cell--error" : ""}`}>
                <input className="timesheet-duration-input" value={displayedValue} disabled={!editable || edit?.status === "saving"} placeholder="0:00" inputMode="numeric" aria-label={`${projectById.get(row.projectId)?.name ?? "New entry"} on ${day.label}`} aria-invalid={edit?.status === "error" || undefined} aria-describedby={edit?.error ? errorId : undefined}
                  onChange={(event) => setCellEdit(cellKey, { value: event.target.value, status: "idle" })}
                  onBlur={(event) => void saveCell(row, day.date, event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") { event.preventDefault(); event.currentTarget.blur(); }
                    if (event.key === "Escape") { event.preventDefault(); cancelledBlurCells.current.add(cellKey); setCellEdit(cellKey, null); event.currentTarget.blur(); }
                  }} />
                {edit?.status === "saving" && <span className="timesheet-cell-status" aria-live="polite">Saving…</span>}
                {edit?.error && <span className="timesheet-cell-error" id={errorId} role="alert">{edit.error}</span>}
                {edit?.retryable && <button className="timesheet-cell-retry" type="button" onClick={() => void saveCell(row, day.date, displayedValue)}>Retry</button>}
              </td>;
            })}
            <td className="timesheet-row-total">{formatMinutes(rowTotal)}</td>
            <td>{editable && <button className="bare-button danger-text" type="button" aria-label="Delete row" disabled={saving || hasCellSaving} onClick={() => void removeRow(row)}><Icon name="close" size={14} /></button>}</td>
          </tr>;
        })}</tbody>
        <tfoot><tr><td>Total</td>{totals.map((total, index) => <td key={days[index].date}>{formatMinutes(total)}</td>)}<td>{formatMinutes(weeklyTotal)}</td><td /></tr></tfoot>
      </table></div>
      <button className="timesheet-add-row" type="button" onClick={addRow} disabled={availableProjects.length === 0}><Icon name="plus" size={15} /> Add row</button>
    </section>
  </>;
}
