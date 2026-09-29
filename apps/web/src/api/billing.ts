import { apiRequest } from "./client";

export type ProjectRate = { id: number; effectiveFrom: string; hourlyRateCents: number; currency: string; isLegacy: boolean; reason: string; createdAt: string };
export type UnbilledEntry = {
  snapshotId: number; sourceEntryId: number; revisionId: number; projectId: number; projectName: string;
  clientId: number | null; clientName: string | null; memberEmail: string; taskName: string | null;
  description: string | null; workDate: string; durationMinutes: number; rateId: number | null;
  hourlyRateCents: number | null; currency: string | null; legacyRate: boolean | null;
  amountCents: number | null; issue: string | null; fingerprint: string;
};
export type BillingBatch = { id: string; clientName: string; currency: string; totalMinutes: number; totalCents: number; entryCount: number; dateFrom: string; dateTo: string; createdAt: string; invoiceReference: string | null; handedOffAt: string | null };
export type BillingFilters = { dateFrom: string; dateTo: string; clientId?: string; projectId?: string };
export const loadProjectRates = (workspace: string, project: string, token: string) => apiRequest<{ rates: ProjectRate[] }>(`/api/workspaces/${workspace}/projects/${project}/rates`, token);
export const addProjectRate = (workspace: string, project: string, body: { effectiveFrom: string; hourlyRateCents: number; currency: string; reason: string }, token: string) => apiRequest<{ rate: ProjectRate }>(`/api/workspaces/${workspace}/projects/${project}/rates`, token, { method: "POST", body: JSON.stringify(body) });
export const loadUnbilled = (workspace: string, filters: BillingFilters, token: string) => {
  const query = new URLSearchParams(Object.entries(filters).filter(([, value]) => value) as [string, string][]);
  return apiRequest<{ entries: UnbilledEntry[] }>(`/api/workspaces/${workspace}/billing/unbilled?${query}`, token);
};
export const finaliseBatch = (workspace: string, entries: Pick<UnbilledEntry, "snapshotId" | "fingerprint">[], key: string, token: string) => apiRequest<{ batch: BillingBatch }>(`/api/workspaces/${workspace}/billing/batches`, token, { method: "POST", headers: { "Idempotency-Key": key }, body: JSON.stringify({ entries }) });
export const loadBatches = (workspace: string, token: string, before?: string) => apiRequest<{ batches: BillingBatch[]; nextCursor: string | null }>(`/api/workspaces/${workspace}/billing/batches${before ? `?before=${before}` : ""}`, token);
export const recordHandoff = (workspace: string, batch: string, invoiceReference: string, token: string) => apiRequest<{ batch: BillingBatch }>(`/api/workspaces/${workspace}/billing/batches/${batch}/handoff`, token, { method: "PATCH", body: JSON.stringify({ invoiceReference }) });
export async function downloadBatch(workspace: string, batch: string, token: string) {
  const response = await fetch(`/api/workspaces/${workspace}/billing/batches/${batch}/export.csv`, { credentials: "include", headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) throw new Error("The billing export could not be downloaded. Please try again.");
  const url = URL.createObjectURL(await response.blob());
  const anchor = document.createElement("a"); anchor.href = url; anchor.download = `billing-batch-${batch}.csv`;
  document.body.append(anchor); anchor.click(); anchor.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const billingMoney = (cents: number, currency: string) => `${currency} ${(cents / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const workspaceDate = (timezone: string) => {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  return ["year", "month", "day"].map((type) => parts.find((part) => part.type === type)!.value).join("-");
};
