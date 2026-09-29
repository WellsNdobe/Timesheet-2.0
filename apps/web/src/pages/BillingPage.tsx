import { useCallback, useEffect, useRef, useState } from "react";
import { ApiClientError, loadClients, loadProjects, type Client, type Project } from "../api/client";
import { billingMoney, downloadBatch, finaliseBatch, loadBatches, loadUnbilled, recordHandoff, workspaceDate, type BillingBatch, type BillingFilters, type UnbilledEntry } from "../api/billing";
import type { WorkspaceSummary } from "../types/workspace";

const hours = (minutes: number) => `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`;
const groupKey = (entry: UnbilledEntry) => `${entry.clientId ?? "none"}:${entry.currency ?? "none"}`;

function BatchRow({ batch, workspaceId, token, onUpdated }: { batch: BillingBatch; workspaceId: string; token: string; onUpdated: (batch: BillingBatch) => void }) {
  const [reference, setReference] = useState(batch.invoiceReference ?? "");
  useEffect(() => { setReference(batch.invoiceReference ?? ""); }, [batch.invoiceReference]);
  const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const inFlight = useRef(false);
  const act = async (download: boolean) => {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError("");
    try {
      if (download) await downloadBatch(workspaceId, batch.id, token);
      else onUpdated((await recordHandoff(workspaceId, batch.id, reference, token)).batch);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "This action could not be completed."); }
    finally { inFlight.current = false; setBusy(false); }
  };
  return <article className="panel billing-batch">
    <div><h3>Batch #{batch.id} · {batch.clientName}</h3><p>{batch.dateFrom} – {batch.dateTo} · {batch.entryCount} entries · {hours(batch.totalMinutes)}</p><strong>{billingMoney(batch.totalCents, batch.currency)}</strong><p>Finalised {new Date(batch.createdAt).toLocaleString()} · {batch.handedOffAt ? `Handed off ${new Date(batch.handedOffAt).toLocaleDateString()}` : "Awaiting handoff"}</p></div>
    <div className="billing-handoff"><button type="button" className="subtle-button" disabled={busy} onClick={() => void act(true)}>Download saved CSV</button><label>External invoice reference<input value={reference} maxLength={160} disabled={busy} onChange={(event) => setReference(event.target.value)} placeholder="e.g. INV-2026-104" /></label><button type="button" className="primary-button" disabled={busy || !reference.trim() || reference.trim() === batch.invoiceReference} onClick={() => void act(false)}>{batch.handedOffAt ? "Update reference" : "Record handoff"}</button></div>
    {error && <p className="inline-alert" role="alert">{error}</p>}
  </article>;
}

export function BillingPage({ workspace, accessToken }: { workspace: WorkspaceSummary; accessToken: string }) {
  const [filters, setFilters] = useState<BillingFilters>(() => { const today = workspaceDate(workspace.timezone); return { dateFrom: `${today.slice(0, 7)}-01`, dateTo: today }; });
  const [entries, setEntries] = useState<UnbilledEntry[]>([]);
  const [clients, setClients] = useState<Client[]>([]); const [projects, setProjects] = useState<Project[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading"); const [loadError, setLoadError] = useState("");
  const [selected, setSelected] = useState<Set<number>>(new Set()); const [confirm, setConfirm] = useState(false);
  const [message, setMessage] = useState(""); const [saving, setSaving] = useState(false);
  const [reload, setReload] = useState(0); const inFlight = useRef(false);
  const attempt = useRef<{ payload: string; key: string } | null>(null);
  const [batches, setBatches] = useState<BillingBatch[]>([]); const [cursor, setCursor] = useState<string | null>(null);
  const [historyError, setHistoryError] = useState(""); const [historyBusy, setHistoryBusy] = useState(false);
  const historyInFlight = useRef(false);

  useEffect(() => {
    let active = true;
    setStatus("loading"); setSelected(new Set()); setConfirm(false); setLoadError("");
    void Promise.all([loadUnbilled(workspace.id, filters, accessToken), loadClients(workspace.id, accessToken, true), loadProjects(workspace.id, accessToken, true)])
      .then(([result, customers, projectRows]) => { if (active) { setEntries(result.entries); setClients(customers); setProjects(projectRows); setStatus("ready"); } })
      .catch((cause: unknown) => { if (active) { setStatus("error"); setLoadError(cause instanceof Error ? cause.message : "Billing data is unavailable."); } });
    return () => { active = false; };
  }, [workspace.id, accessToken, filters, reload]);

  const refreshHistory = useCallback(async (before?: string) => {
    if (historyInFlight.current) return;
    historyInFlight.current = true; setHistoryBusy(true); setHistoryError("");
    try {
      const result = await loadBatches(workspace.id, accessToken, before);
      // Keep a just-created batch if this request began before its transaction completed.
      setBatches((current) => before
        ? [...current, ...result.batches.filter((batch) => !current.some((existing) => existing.id === batch.id))]
        : [...current.filter((batch) => Number(batch.id) > Number(result.batches[0]?.id ?? 0)), ...result.batches]);
      setCursor(result.nextCursor);
    }
    catch (cause) { setHistoryError(cause instanceof Error ? cause.message : "Billing history is unavailable."); }
    finally { historyInFlight.current = false; setHistoryBusy(false); }
  }, [workspace.id, accessToken]);
  useEffect(() => { void refreshHistory(); }, [refreshHistory]);

  const groups = new Map<string, UnbilledEntry[]>();
  for (const entry of entries) { const key = groupKey(entry); const group = groups.get(key) ?? []; group.push(entry); groups.set(key, group); }
  const chosen = entries.filter((entry) => selected.has(entry.snapshotId));
  const chosenKey = chosen.length ? groupKey(chosen[0]) : null;
  const totalCents = chosen.reduce((sum, entry) => sum + (entry.amountCents ?? 0), 0);
  const totalMinutes = chosen.reduce((sum, entry) => sum + entry.durationMinutes, 0);
  const toggle = (entry: UnbilledEntry) => {
    setConfirm(false); setSelected((current) => { const next = new Set(current); if (next.has(entry.snapshotId)) next.delete(entry.snapshotId); else next.add(entry.snapshotId); return next; });
  };
  const save = async () => {
    if (inFlight.current || !chosen.length) return;
    inFlight.current = true; setSaving(true); setMessage("");
    const selection = chosen.map(({ snapshotId, fingerprint }) => ({ snapshotId, fingerprint }));
    const payload = JSON.stringify(selection);
    if (attempt.current?.payload !== payload) attempt.current = { payload, key: crypto.randomUUID() };
    try {
      const { batch } = await finaliseBatch(workspace.id, selection, attempt.current.key, accessToken);
      attempt.current = null; setConfirm(false); setSelected(new Set()); setReload((value) => value + 1);
      setBatches((current) => [batch, ...current.filter((existing) => existing.id !== batch.id)]);
      setMessage(`Batch #${batch.id} is finalised. Download its saved CSV below, then record the external invoice reference after handoff.`);
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "The batch could not be finalised. Retry to recover the same batch.");
      if (cause instanceof ApiClientError && cause.status === 409) { setConfirm(false); setReload((value) => value + 1); }
    } finally { inFlight.current = false; setSaving(false); }
  };

  return <>
    <header className="content-header"><div><p className="section-kicker">CLIENT BILLING</p><h1>Billing</h1><p className="page-subtitle">Turn approved billable time into a saved handoff for your invoicing process.</p></div></header>
    {message && <div className="inline-alert" role="status">{message}</div>}
    <fieldset className="workflow-toolbar billing-filters" disabled={saving} aria-label="Unbilled work filters">
      <label>From<input type="date" min="1900-01-01" value={filters.dateFrom} onChange={(event) => setFilters({ ...filters, dateFrom: event.target.value })} /></label>
      <label>To<input type="date" min="1900-01-01" value={filters.dateTo} onChange={(event) => setFilters({ ...filters, dateTo: event.target.value })} /></label>
      <label>Client<select value={filters.clientId ?? ""} onChange={(event) => setFilters({ ...filters, clientId: event.target.value || undefined, projectId: undefined })}><option value="">All clients, including unassigned</option>{clients.map((client) => <option key={client.id} value={client.id}>{client.name}{client.isArchived ? " (archived)" : ""}</option>)}</select></label>
      <label>Project<select value={filters.projectId ?? ""} onChange={(event) => setFilters({ ...filters, projectId: event.target.value || undefined })}><option value="">All projects</option>{projects.filter((project) => !filters.clientId || project.clientId === filters.clientId).map((project) => <option key={project.id} value={project.id}>{project.name}{project.isArchived ? " (archived)" : ""}</option>)}</select></label>
      <button type="button" className="subtle-button" onClick={() => setReload((value) => value + 1)}>Refresh</button>
    </fieldset>
    <p className="report-caption">Approved billable entries only. Select up to 100 entries for one client and currency. Amounts are rounded per entry to two decimal places; taxes are handled in your invoicing system.</p>
    {status === "loading" ? <div className="panel inline-state" role="status">Loading approved, unbilled work…</div> : status === "error" ? <div className="panel inline-state" role="alert"><p>{loadError}</p><button className="subtle-button" onClick={() => setReload((value) => value + 1)}>Retry</button></div> : <>
      {!entries.length && <div className="panel inline-state">No approved, unbilled time matches these filters. Pending, returned and non-billable work is excluded.</div>}
      {[...groups].map(([key, group]) => {
        const ready = group.filter((entry) => !entry.issue);
        const pricedTotal = ready.reduce((sum, entry) => sum + entry.amountCents!, 0);
        const blocked = group.length - ready.length;
        return <section className="panel data-panel billing-group" key={key}>
          <div className="panel-heading"><div><h2>{group[0].clientName ?? "Client not assigned"}</h2><p>{group[0].currency ?? "Rate missing"} · {hours(group.reduce((sum, entry) => sum + entry.durationMinutes, 0))}{group[0].currency && ` · Ready value: ${billingMoney(pricedTotal, group[0].currency)}`}{blocked > 0 && ` · ${blocked} need attention`}</p></div><button className="subtle-button" type="button" disabled={saving || !ready.length} onClick={() => { setConfirm(false); setSelected(new Set(ready.slice(0, 100).map((entry) => entry.snapshotId))); }}>{ready.length > 100 ? "Select first 100 ready entries" : "Select ready entries"}</button></div>
          <div className="data-scroll"><table className="data-table"><thead><tr><th>Select</th><th>Date</th><th>Project / work</th><th>Member</th><th>Time</th><th>Rate / hour</th><th>Amount</th><th>Readiness</th></tr></thead><tbody>{group.map((entry) => <tr key={entry.snapshotId}>
            <td><input type="checkbox" aria-label={`Select ${entry.projectName}, ${entry.memberEmail}, ${entry.workDate}, entry ${entry.sourceEntryId}`} checked={selected.has(entry.snapshotId)} disabled={saving || Boolean(entry.issue) || (!selected.has(entry.snapshotId) && (selected.size >= 100 || (chosenKey !== null && chosenKey !== key)))} onChange={() => toggle(entry)} /></td>
            <td>{entry.workDate}</td><td>{entry.projectName}<small className="billing-entry-description">{entry.taskName}{entry.taskName && entry.description ? " · " : ""}{entry.description}</small></td><td>{entry.memberEmail}</td><td>{hours(entry.durationMinutes)}</td>
            <td>{entry.hourlyRateCents == null || !entry.currency ? "Missing" : billingMoney(entry.hourlyRateCents, entry.currency)}</td><td>{entry.issue || entry.amountCents == null || !entry.currency ? "—" : billingMoney(entry.amountCents, entry.currency)}</td><td className={entry.issue ? "warning-text" : "ready-text"}>{entry.issue ?? "Ready"}</td>
          </tr>)}</tbody></table></div>
        </section>;
      })}
      {chosen.length > 0 && <section className="panel billing-selection" aria-label="Selected billing work"><h2>{chosen[0].clientName} · {billingMoney(totalCents, chosen[0].currency!)}</h2><p>{chosen.length} entries · {hours(totalMinutes)}</p>{confirm ? <><p>Finalising saves these entries, rates and amounts permanently and removes them from unbilled work. This release does not support cancelling batches. Confirm after reviewing the selected rows.</p><div className="row-actions"><button className="subtle-button" disabled={saving} onClick={() => setConfirm(false)}>Back to selection</button><button className="primary-button" disabled={saving} onClick={() => void save()}>{saving ? "Finalising…" : "Confirm and finalise batch"}</button></div></> : <div className="row-actions"><button className="subtle-button" onClick={() => setSelected(new Set())}>Clear selection</button><button className="primary-button" onClick={() => setConfirm(true)}>Review billing batch</button></div>}</section>}
    </>}
    <section className="billing-history" aria-label="Billing batch history"><div className="panel-heading"><div><p className="section-kicker">SAVED HANDOFFS</p><h2>Billing history</h2><p>Downloads retain the original amounts even after project details change.</p></div><button className="subtle-button" disabled={historyBusy || saving} onClick={() => void refreshHistory()}>Refresh history</button></div>
      {historyError && <p className="inline-alert" role="alert">{historyError}</p>}
      {batches.map((batch) => <BatchRow key={batch.id} batch={batch} workspaceId={workspace.id} token={accessToken} onUpdated={(updated) => setBatches((current) => current.map((item) => item.id === updated.id ? updated : item))} />)}
      {historyBusy && <p role="status">Loading billing history…</p>}{!historyBusy && !historyError && !batches.length && <p>No billing batches yet.</p>}
      {cursor && <button className="subtle-button" disabled={historyBusy} onClick={() => void refreshHistory(cursor)}>Load older batches</button>}
    </section>
  </>;
}
