import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { projectRates, timeEntries } from "../db/schema.js";

export type Rate = typeof projectRates.$inferSelect;
export const rateOnDate = (rates: Rate[], workDate: string) => {
  let applicable: Rate | undefined;
  for (const rate of rates) if (rate.effectiveFrom <= workDate && (!applicable || rate.effectiveFrom > applicable.effectiveFrom)) applicable = rate;
  return applicable;
};

// Round each entry once to cents; the billing export uses the same rule.
export const entryAmount = (minutes: number, rateCents: number) => Math.round(minutes * rateCents / 60);

export async function historicalProjectUsage(workspaceId: number, projectIds: number[]) {
  type Usage = { usedMinutes: number; billableMinutes: number; valuesByCurrency: Record<string, number>; unpricedMinutes: number; legacyMinutes: number; rates: Rate[] };
  const result = new Map<number, Usage>();
  if (!projectIds.length) return result;
  const rates = await db.select().from(projectRates).where(inArray(projectRates.projectId, projectIds)).orderBy(asc(projectRates.effectiveFrom));
  for (const projectId of projectIds) result.set(projectId, { usedMinutes: 0, billableMinutes: 0, valuesByCurrency: {}, unpricedMinutes: 0, legacyMinutes: 0, rates: [] });
  for (const rate of rates) result.get(rate.projectId)!.rates.push(rate);
  // Aggregate by date, duration and billable flag, preserving per-entry rounding without loading descriptions.
  const entries = await db.select({ projectId: timeEntries.projectId, workDate: timeEntries.workDate, minutes: timeEntries.durationMinutes, billable: timeEntries.isBillable, count: sql<number>`count(*)::int` }).from(timeEntries)
    .where(and(eq(timeEntries.workspaceId, workspaceId), inArray(timeEntries.projectId, projectIds)))
    .groupBy(timeEntries.projectId, timeEntries.workDate, timeEntries.durationMinutes, timeEntries.isBillable);
  for (const entry of entries) {
    const usage = result.get(entry.projectId)!;
    const minutes = entry.minutes * entry.count;
    usage.usedMinutes += minutes;
    if (!entry.billable) continue;
    usage.billableMinutes += minutes;
    const rate = rateOnDate(usage.rates, entry.workDate);
    if (!rate) { usage.unpricedMinutes += minutes; continue; }
    if (rate.isLegacy) usage.legacyMinutes += minutes;
    usage.valuesByCurrency[rate.currency] = (usage.valuesByCurrency[rate.currency] ?? 0) + entryAmount(entry.minutes, rate.hourlyRateCents) * entry.count;
  }
  return result;
}
