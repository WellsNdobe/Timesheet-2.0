import { useEffect, useRef, useState } from "react";
import { addProjectRate, billingMoney, loadProjectRates, workspaceDate, type ProjectRate } from "../api/billing";

export function ProjectRateEditor({ workspaceId, projectId, timezone, accessToken, onSaved }: { workspaceId: string; projectId: string; timezone: string; accessToken: string; onSaved: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [rates, setRates] = useState<ProjectRate[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [date, setDate] = useState(() => workspaceDate(timezone));
  const [amount, setAmount] = useState(""); const [currency, setCurrency] = useState("ZAR"); const [reason, setReason] = useState("");
  const [message, setMessage] = useState(""); const [saving, setSaving] = useState(false); const inFlight = useRef(false);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    if (!open) return;
    let active = true; setStatus("loading");
    void loadProjectRates(workspaceId, projectId, accessToken).then(({ rates: rows }) => { if (active) { setRates(rows); setStatus("ready"); } }).catch(() => { if (active) setStatus("error"); });
    return () => { active = false; };
  }, [open, workspaceId, projectId, accessToken, reload]);
  const save = async () => {
    if (inFlight.current) return;
    if (!/^\d+(\.\d{1,2})?$/.test(amount.trim()) || !date || !/^[A-Z]{3}$/.test(currency) || !reason.trim()) { setMessage("Enter a date, a non-negative rate with up to two decimals, a currency code and a reason."); return; }
    inFlight.current = true; setSaving(true); setMessage("");
    try {
      await addProjectRate(workspaceId, projectId, { effectiveFrom: date, hourlyRateCents: Math.round(Number(amount) * 100), currency, reason }, accessToken);
      setMessage("Rate saved."); setAmount(""); setReason(""); setReload((value) => value + 1); await onSaved();
    } catch (error) { setMessage(error instanceof Error ? error.message : "The rate could not be saved."); }
    finally { inFlight.current = false; setSaving(false); }
  };
  return <div className="project-rate-editor"><button type="button" className="subtle-button" aria-expanded={open} onClick={() => setOpen(!open)}>Rate history &amp; changes</button>{open && <div className="rate-history">
    <p>Rates apply by work date. Add dates in order; saved rates cannot be edited. Finalised billing amounts stay fixed.</p>
    {message && <p role="status" className="inline-alert">{message}</p>}
    {status === "loading" ? <p>Loading rates…</p> : status === "error" ? <p role="alert">Rates unavailable. <button type="button" className="link-button" onClick={() => setReload((value) => value + 1)}>Retry</button></p> : <>
      {rates.length ? <ul>{rates.map((rate) => <li key={rate.id}><strong>{billingMoney(rate.hourlyRateCents, rate.currency)} / hour</strong> · {rate.isLegacy ? "Imported rate — unconfirmed" : `from ${rate.effectiveFrom}`}<small>{rate.reason}</small></li>)}</ul> : <p>No rate has been set.</p>}
      {rates.some((rate) => rate.isLegacy) && <p className="warning-text">For older work, add a confirmed rate from the date it actually applied. Imported rates alone cannot be used for billing.</p>}
      <label>Effective from<input type="date" min="1900-01-01" value={date} disabled={saving} onChange={(event) => setDate(event.target.value)} /></label>
      <label>Hourly rate<input inputMode="decimal" value={amount} disabled={saving} onChange={(event) => setAmount(event.target.value)} placeholder="1250.00" /></label>
      <label>Currency<input maxLength={3} value={currency} disabled={saving} onChange={(event) => setCurrency(event.target.value.toUpperCase())} /></label>
      <label>Reason<input maxLength={500} value={reason} disabled={saving} onChange={(event) => setReason(event.target.value)} placeholder="Annual rate change or confirmation of existing agreement" /></label>
      <p>Work on or after this date uses this rate. Review the date and amount before saving.</p>
      <button type="button" className="primary-button" disabled={saving} onClick={() => void save()}>{saving ? "Saving…" : "Save dated rate"}</button>
    </>}
  </div>}</div>;
}
