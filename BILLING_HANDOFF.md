# Billing handoff

## Included

Admins can manage dated project rates, review approved unbilled time, finalise a billing batch, download its saved CSV, and record the external invoice reference. Members and Managers cannot access billing or rate history endpoints.

The Billing page groups approved billable revision snapshots by client and currency. Pending, returned, withdrawn, non-billable and already batched entries are excluded. Archived projects and clients remain available for finishing billing.

## Rate and amount rules

- A time entry uses the latest rate whose effective date is on or before its work date. The date is inclusive.
- Initial project rates require an effective date. Additional rates must have later effective dates; existing rate records cannot be edited or deleted through the app.
- An Admin can backdate a new rate for unbilled work, after the latest rate date. A date overlapping this project's already batched work is rejected.
- The migration imports existing project rates as **unconfirmed legacy estimates**. These do not establish historical contractual rates. Add a confirmed dated rate covering the work before billing it.
- Missing rates and unconfirmed legacy rates block finalisation. A confirmed zero rate is valid.
- Amounts use integer minutes and integer cents, rounded once per entry to the nearest cent. Batch totals sum those rounded amounts. Currency totals are never converted or combined.
- The existing commercial model uses two decimal places for rates and amounts. Taxes, discounts and currencies requiring other precision are outside this release.
- Project value estimates now use dated rates rather than applying today's rate to all previous work. Missing or legacy rates are labelled; monetary budget percentages are withheld for incomplete pricing or mixed currencies.

## Batch rules

- Select up to 100 entries for a single client and currency. The unbilled list supports up to 5,000 matching entries and a 367-day range; narrow filters for larger datasets.
- Finalisation checks that the server's current selection matches the displayed pricing and client. A stale selection receives a conflict requiring a refresh.
- Finalisation atomically stores the source entry, approved revision, descriptions, names, rate and amount. Workspace locking and a database uniqueness constraint prevent double billing, including concurrent requests.
- Retrying a finalisation request with the same key and payload returns the same batch. The saved request key does not expire.
- Finalised entries leave the unbilled list immediately. A batch initially awaits handoff. Recording an external invoice reference marks its handoff; it does not send anything to an accounting service.
- Invoice references can be corrected, with an audit event. Changing a reference does not change financial snapshots or the CSV.
- CSV downloads read only saved batch data, retain stable ordering, include source entry/revision identifiers, and escape spreadsheet formulas in text fields.
- Batch cancellation, voiding, reopening approved work, credit notes, invoice generation and accounting integrations are not included. The finalisation UI explicitly explains that batches cannot be cancelled in this release.

## Migration and acceptance

`apps/api/drizzle/0014_billing_handoff.sql` adds the rate and batch tables, seeds labelled legacy rates, configures the existing API database role, and restricts updates on financial snapshots. It is registered in the migration journal. It has not been applied as part of this implementation. Normal local startup applies pending migrations using the existing workflow.

Automated tests, typechecks, builds and browser checks were intentionally not run under the repository's manual-validation preference. Regression cases were added to the existing API and web test suites for later execution.

Owner acceptance:

1. Create a client and two projects. Set a project rate effective before the test week's first work date; add a second rate halfway through the week.
2. Record billable and non-billable work as a Member. Submit, request changes as the Manager, correct the work, resubmit and approve. Billing must use the approved revision and exclude non-billable work.
3. Open Billing as Admin. Check each date uses the correct rate. Work with no client, no applicable rate or only an imported legacy rate must show why it cannot be selected.
4. Use two currencies and confirm they remain separate. Select one client/currency, review the total, and finalise. Repeat-click/retry must not create another batch.
5. Download the CSV, then rename the client/project and add a later rate. Download the saved batch again: its contents and totals must remain unchanged.
6. Record an invoice reference, refresh the page, and verify it persists. Correct it and check the audit event. The CSV must remain unchanged.
7. Verify batched entries no longer appear as unbilled; narrower dates/client/project filters should still work. An archived project with approved outstanding time should remain billable.
8. Attempt direct Billing/rate-history access as Member and Manager, and request a different workspace's batch. Access must be denied without leaking commercial data.
