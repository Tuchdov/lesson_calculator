# Plan: Turso payment ledger and later Grow/Make integration

Status: initial application implementation and local tests complete; remote provisioning and Grow/Make setup remain pending.
Prepared: 2026-10-27.
Revision: incorporates adversarial review and the Grow App for Make guide.


Implementation notes: migrations, environment binding/recovery configuration,
owner-scoped invoices, active-request guards, callback/payload/jobs, manual
confirmation, signed reversals, historical-link import and calculator controls now
exist. `students` contains the revision/hold fields proposed as a separate
`student_billing_state` table. Calculation drafts remain in the browser; saved
invoices are issued records, with changes recorded as adjustments. The worker
implements approval and visible manual verification; automatic transaction lookup
and request-ID recovery are not implemented capabilities. The actual Make handoff
contracts and operator commands are in [Billing setup](../billing-setup.md).

## Intended result and implementation order

Use Turso as the source of truth for invoices, payment-link attempts, and payments.
The teacher can see what is owed, what has been paid, and which earlier invoices
remain outstanding. Make remains the adapter to Grow. Database credentials stay
in Vercel; Make calls authenticated application endpoints instead of accessing
Turso directly.

Build and test the database and application work first, using a fake payment
provider. Complete the external setup checklist in this document later, then
enable the live workflow after a sandbox transaction passes end to end.

The initial release supports ILS, single-payment links, partial manual payments,
and explicit teacher confirmation of reported Grow payments. Automatic confirmation
is enabled only after its verification mechanism is established. Excess payments
remain visible, unapplied credit pending review; automatic credit reuse, provider
refund initiation, and installment/recurring-payment flows are deferred. Reviewed
refunds and manual-payment reversals must still be recordable without rewriting
history, and unresolved money movements block new collection for that student.

1. Database, migrations, stable identifiers, and authenticated repository.
2. Persisted invoices, balances, and payment-link request state.
3. Callback intake, verified payment recording, and reconciliation endpoints.
4. Calculator UI and safe migration from local storage.
5. Later: provision Turso, configure Make/Grow, verify contracts in the sandbox,
   and enable production integration.

This extends the original SPA-only constraint in `DESIGN.md` through the existing
Vercel API functions. Update that design and the README when implementation lands.

## Baseline before implementation

- `src/api/paymentLinkService.js` verifies Google identity and calls Make. The
  current workspace batches up to 40 items with six concurrent Make calls.
- Make currently accepts `{customer_name, amount, phone, description}` and returns
  Grow's `{status, err, data: {paymentLinkProcessId, paymentLinkProcessToken, url}}`.
  The service discards everything except `url`.
- `api/grow-notify.js` acknowledges every request without reading or saving it.
- `src/lib/payments.js` stores links and month-specific amount overrides locally.
  It cannot receive a callback or coordinate two browsers/server invocations.
- The browser identifies students by calendar names. Billing needs stable IDs so
  renaming a student does not detach their outstanding invoices.
- Batch results currently arrive only when the entire request finishes. Saving
  each successful result on the server will let a reload recover completed work
  after the batch response is lost.

## Confirmed Grow/Make workflow and remaining checks

Use the existing Grow connection in Make. The guide documents connection through
business identification, linked phone and OTP, with separate Grow/Grow Sandbox
connection types; direct-API `userId`/`pageCode` provisioning is not required for
this route. Creation supports custom identifiers and delivery mode `none`. Payment
updates arrive through Notify URL, followed by the Approve Transaction action;
HTTP 200 from our current stub does not execute that action. The guide also lists
Get Payment Link Info and says existing links must be edited in Grow's interface,
not through Make. [Grow App for Make][grow-make]

Do not treat the whole integration as unspecified. Two capabilities remain open:

1. Does the Grow webhook module validate callback authenticity, or is there a
   supported signature/authenticated transaction lookup? Until confirmed, use
   reported status plus an explicit teacher verification action.
2. Can creation be deduplicated or recovered when its response is lost? The
   documented Get Payment Link Info endpoint takes the process ID and token;
   it does not establish lookup by our custom request ID when both are missing.
   [Get Payment Link Info][grow-link-info]

Build explicit provider capabilities (`canVerifyPayment`, `canRecoverByRequestId`,
`canDeactivateLink`) defaulting to false. Populate them only from tested contracts;
the fake provider must exercise the false-capability paths too. Configuration and
sandbox work remain a later step, rather than assumptions hidden in the adapter.

## Database choice and access

Use a Turso **libSQL database** with `@libsql/client`, parameterized SQL, and small
numbered migrations. This explicit choice allows the same repository to run
against a temporary local database in tests. No ORM is needed for this scope.
Turso also has a newer engine with a different recommended remote SDK; verify
the provisioned engine before installing the client. If provisioning selects the
new engine, switch the adapter and contract tests together rather than assuming
the clients are interchangeable. See the [official SDK reference][turso-sdk].

- Add `src/api/db.js`: lazy server-side client, injected client for tests.
- Add `src/api/billingRepository.js`: all SQL and short transactions.
- Add `db/migrations/001_payment_ledger.sql` and a migration runner that records
  applied versions and refuses unknown/newer schema versions.
- Add `npm run db:migrate` and database integration tests against an isolated file.
- Use short write transactions for claims and posting payments. Do not hold a
  transaction while calling Google, Make, or Grow. libSQL supports atomic batches
  and explicit transactions; concurrent writes must be coordinated through the
  database rather than an in-memory JavaScript lock. [Transaction reference][libsql-client]
- Use a remote database in Vercel. Local files and embedded replicas are unnecessary
  for this app's production workflow.
- Return a clear unavailable error if database configuration is missing or the
  database cannot be reached; never fall back to untracked live link creation.

## Proposed schema

All money is an integer number of agorot; currency is explicitly `ILS`. Convert
to shekels only at the Grow boundary and for display. Use generated opaque IDs,
UTC timestamps, foreign keys, and indexes on owner/student/month lookups.

| Table | Important fields and constraints |
|---|---|
| `students` | `id`, `owner_id`, `display_name`, timestamps; unique `(owner_id, id)` |
| `student_aliases` | `owner_id`, normalized calendar name, `student_id`; unique owner/name mapping; explicit reassignment for rename corrections |
| `invoices` | `id`, `owner_id`, `student_id`, `month`, `charge_agorot`, `currency`, `state` (`draft`, `issued`, `void`), `version`, source/calculation snapshot; unique owner/student/month |
| `invoice_adjustments` | invoice ID, signed agorot adjustment, reason, actor, timestamp, prior/new version; immutable audit trail for corrections and opening balances |
| `student_billing_state` | owner/student key, ledger revision, active request ID, review hold; serialization point shared by invoice changes, payment posting and request claims |
| `payment_requests` | `id`, `owner_id`, `student_id`, client `request_id`, canonical payload hash, version/snapshot hash, amount, state, `holds_slot`, URL, provider process ID/token, dispatch and completion timestamps; unique owner/request ID and provider/environment/merchant/process ID; partial unique index on owner/student where `holds_slot = 1` |
| `request_items` | `payment_request_id`, `invoice_id`, requested amount and invoice version; frozen breakdown of the invoices covered by this link |
| `payment_events` | internal receipt ID, provider/environment/merchant identity, external event ID if available, receipt fingerprint, claimed transaction/process reference, parsed status, receipt time, redacted metadata, nullable posted payment reference; transport deduplication only, never the financial uniqueness constraint |
| `payments` | confirmed principal payments only: `id`, `owner_id`, `student_id`, provider/environment/merchant/transaction identity for Grow, amount/currency, confirmation evidence, received time, source; unique provider/environment/merchant/transaction for the supported single-payment flow; separate unique owner/manual-action ID for cash/bank entries |
| `payment_reversals` | original payment ID, positive amount, unique provider refund ID or manual action ID, reason, verification evidence, actor and time; immutable, capped at the original payment's unreversed amount |
| `payment_allocations` | immutable signed movements with payment ID, invoice ID, agorot, operation ID, optional `reverses_allocation_id`; unique operation ID; negative movements must reference/cap a prior positive allocation |
| `integration_payloads` | receipt/job reference, encrypted replay payload, key version, retention deadline, purge time; restricted server access, never returned by browser APIs |
| `integration_jobs` | deduplication key, operation (`verify`, `approve`, `reconcile`), payload reference, state, attempts, next-attempt time, lease owner/expiry and fencing generation, last redacted error; unique operation/deduplication key |
| `billing_control` | environment, operational mode (`normal`, `recovery`), recovery checkpoint and signed-off time; restores start in recovery mode through deployment configuration |
| `schema_migrations` | version and applied time |

Add constraints so allocations cannot cross owners or students. Check payment
totals and available invoice balances inside the posting transaction. Net payment
is original posted payment minus posted reversals; net allocation is the sum of
signed allocation movements. Their difference is unapplied credit. Enforce
`0 <= net allocation <= net payment` and nonnegative invoice outstanding. Preserve
excess as a review item; the initial release cannot spend it on another invoice.
For a reviewed refund, append the payment reversal and the required allocation
reversals in one transaction. Reverse unapplied funds first, then allocations
newest first, reopening original invoices without changing their charges. A
manual-payment correction uses this same mechanism. A status change or duplicate
receipt cannot create another principal payment. Pending/unverified refund reports
hold collection until reviewed; do not silently assume they have no balance effect.

For the single-user app, derive `owner_id` from verified Google identity on the
server and retain `ALLOWED_EMAIL`. Do not accept an owner from the browser. Extract
the existing verifier into `src/api/verifyCaller.js` and reuse it once per batch.
Every read and write must enforce ownership, including lookups by opaque ID.

## Invoice and balance rules

- Calculate previews the selected month's charges. An explicit **Save month**
  action issues/upserts the month's invoice snapshot; preparing a single link
  issues the selected invoice as part of that action. Show whether a month is
  fully saved so the teacher can see incomplete billing history.
- Before issue, price and amount edits update the draft. After issue, adjustments
  are explicit, versioned changes; preserve the prior snapshot. Do not rewrite
  issued history merely because prices or calendar events changed later.
  Reducing an already-paid charge must transactionally reverse any excess
  allocation into unapplied credit and set a review hold; it cannot make the
  invoice balance negative or pretend a refund happened.
- Start the ledger at an explicit month. Earlier history is not automatically
  considered unpaid. Allow reviewed opening balances and manual cash/bank
  payments with an audit reference, so non-Grow payments can settle invoices.
- Define invoice outstanding as issued charges plus adjustments minus net payment
  allocations. A calculation preview or a local link is not a payment record.
- Define prior balance for month M as outstanding on issued invoices before M.
  Current-month remaining plus prior outstanding is the amount available to pay;
  exclude future-month invoices. For this release, any unapplied credit requires
  review and blocks new collection; credit reuse needs a separate allocation
  design and is not offered automatically or through an untracked manual offset.
- **Never copy a prior balance into the next invoice's charge.** That would count
  the same debt twice. A new payment request instead references multiple original
  invoices through `request_items`.
- Allocate verified payments to the referenced invoices, oldest first, capped at
  each invoice's current outstanding amount. Keep any excess as credit/review.
- Students with prior debt and no lessons in the selected month still appear in
  the table. Changing the month must not create invoices for absent lessons.
- A stale link may still be paid. Match its frozen request, post the money once,
  allocate only the still-outstanding amounts, and flag excess/review as needed.
  Mark requests stale after any balance change, but retain their active slot until
  provider closure is confirmed. Local staleness is not provider deactivation.
- Manual confirmation of a reported Grow payment operates on its existing
  provider transaction identity, with evidence and actor. It is not a cash/bank
  entry. Automatic verification racing with that action must post the same payment
  at most once. Cash/bank recording asks for a unique action ID and records its
  distinct source so it is not confused with a pending Grow payment.

Example: August charge ₪300, paid ₪100; September charge ₪400. September shows
₪200 prior balance plus ₪400 current charge. A ₪600 payment allocates ₪200 to
August and ₪400 to September. Recalculating September still shows zero remaining.

## API and application changes

Proposed endpoints (keep adapters thin and business logic injectable):

| Endpoint | Behavior |
|---|---|
| `GET /api/billing?month=YYYY-MM` | Authenticated invoices, current/prior balances, statuses, reusable links and unresolved requests; `Cache-Control: no-store` |
| `POST /api/billing` | Authenticated actions to save a month, adjust an invoice, review opening balances, or record/reverse a manual payment; validate action-specific inputs and versions |
| `POST /api/create-payment-link` | Extend existing single/batch route with request IDs, student IDs and invoice versions; server derives invoice totals and saves each result before responding |
| `GET /api/payment-requests?id=...` | Authenticated recovery/status query after a timeout or reload; owner-scoped lookup |
| `POST /api/payment-link-result` | Authenticated Make-to-app completion callback that saves process IDs and URL independently of the original HTTP response |
| `POST /api/grow-notify` | Atomically save receipt, replay payload and processing job before acknowledgement; authenticated Make forwarding can associate reports with requests; anonymous direct delivery stays quarantined |
| `POST /api/payment-jobs` | Secret-authenticated job/reconciliation runner, callable by a scheduled Make scenario; bounded batches and atomic job claims |

Extend each Make request with a request correlation ID and opaque billing reference;
preserve existing fields for mapping compatibility. Authenticate Make completion
calls with a server-only shared secret distinct from browser Google authentication.
Completion callbacks must match the stored payload and be idempotent; conflicting
URLs/process IDs for one request go to review rather than overwriting history.

Use a separate proposed Make operations webhook, `MAKE_OPERATIONS_WEBHOOK_URL`,
for `{action: "verify" | "approve" | "reconcile", jobId, ...}`. It authenticates
with `MAKE_API_KEY` and returns a versioned JSON outcome. The existing
`MAKE_WEBHOOK_URL` remains the creation trigger. Define fixture-backed schemas for
both before implementing their adapters. Use distinct `MAKE_RESULT_SECRET` and
`PAYMENT_JOBS_SECRET` for Make-to-app result delivery and scheduled job execution.
All URLs and secrets are server environment variables.

Use Grow's existing Make actions for approval and known-link lookup. Do not
implement the proposed `verify`/request-ID `reconcile` operations as invented Grow
API calls; expose unsupported capability outcomes until actual module outputs or
documented endpoints establish them. Automatic verification is optional at launch.
If Notify URL uses Make's Grow webhook trigger, add a distinct
`MAKE_NOTIFY_SECRET` to its app forwarding call. This authenticates the forwarding
hop, not necessarily the original notification. Make must durably deliver the
receipt to the app before approval; a failed delivery must retry forwarding,
not recreate a link. When the secret is configured, every delivery must supply
it. With no secret configured, direct-to-app intake stores anonymous receipts in
separate quarantine; authenticated redelivery is required before associating them
with requests or placing student holds.

Add `useBilling` and a browser billing client. Load after auth/month selection and
refresh after preparation, on window focus, and through an explicit Refresh action.
Cancel/ignore stale responses on user/month changes. A load error must show unknown
status and disable balance-dependent payment requests rather than imply unpaid.

In `CalculatorPage.jsx` and `EditableTable.jsx`, use one shared balance calculation
for the displayed amount, WhatsApp message, single-link action, batch action, and
CSV export. Show current charge, prior balance, remaining total, and status:
unpaid, partially paid, paid, payment awaiting verification, or needs review.
Keep link preparation status separate from payment status. Update summary totals
and expanded-row column spans consistently. Prevent preparing a paid/zero-balance
row; show a review action for unresolved attempts instead of a generic retry.

## Idempotency and timeout recovery

1. Browser persists a request ID **before** dispatch, scoped to the immutable
   billing snapshot. Refreshes and retries reuse it. A deliberate replacement
   gets a new ID only after the earlier request is resolved and any old live
   link is handled. Changing an amount is not an implicit retry.
2. Server verifies ownership and invoice versions, recomputes the total, and
   atomically creates/claims the request. Same ID + changed payload is `409`.
   Re-read/update the student billing row in a write transaction and enforce one active collection request
   per owner/student, irrespective of month, amount or snapshot. This deliberately
   serializes collection for a student; different students can prepare in parallel.
   Reuse an identical ready request only if still current and no review hold exists.
   A conflicting active request returns `409` with a resolve-existing-request action.
3. A ready request returns the saved URL. An in-progress request returns its
   state without another Grow call. Only the claim winner dispatches to Make.
4. Save `dispatching` before network I/O. On a timeout, malformed response, lost
   connection, or ambiguous Make error, retain `unknown`/`dispatching` and
   reconcile. A stale lock/lease alone does not authorize another creation.
5. Make sends a completion callback before returning its normal webhook response.
   If Vercel's original request dies, this callback can still recover the URL.
6. There remains a failure window if Grow succeeds but Make never records or
   delivers the result. Close it only with confirmed provider idempotency or a
   supported lookup/reconciliation mechanism. If neither exists, leave the
   request unresolved and require Grow-dashboard review; never blind retry.

Database deduplication prevents concurrent dispatch and reuses known results;
it cannot promise exactly-once creation across an external network call by itself.
Do not label this TODO complete until the unresolved-result behavior is tested.

### Active requests, replacement and collection holds

An active slot is acquired with the request/items in one transaction. `claimed`,
`dispatching`, `ready`, `unknown`, `replacement_pending`, and `needs_review` all
retain it. A crash, expired lease, amount edit, different month, or reported
payment cannot release it. Receipt of a plausible pending payment or reversal
also sets a student review hold; a network retry is not a resolution action.

Release the slot only after (a) definitive failure before provider creation,
(b) confirmed provider cancellation/closure, or (c) verified consumption of the
configured single-payment link. Persist evidence and the ledger revision in the
release transaction. Payment posting, invoice adjustment and replacement claims
must serialize against the same student billing row. Do not use process-local locks.

With the documented Make integration, replacement is initially a manual Grow
interface operation: keep the slot, have the teacher close the old link and
check its final transaction state, then record evidence before allowing another
request. If closure or an in-flight payment cannot be established, remain in
review. Never present local invalidation as cancellation. This rule applies to
cross-month overlapping debts as well as an explicit Regenerate button.

Known historical/untracked links require the same closure/reconciliation review
before issuing another request for their student. Browser storage being cleared
does not establish that old links are gone. Late external payments are still
recorded against their actual transaction; excess becomes a review item.

## Callback processing and authenticity

Grow documents `notifyUrl`, a callback example whose nested `data.statusCode` is
`"2"` and `data.status` is `"שולם"`, and a required `ApproveTransaction` follow-up.
These update the older TODO's assumptions, but the example is not a complete
status-code specification. [Callback documentation][grow-callback]

- Read the nested envelope (`status` at the top is not the payment status).
  Confirm content type, field types, payment methods, and event identity using
  sandbox fixtures; do not invent the shape of `customFields`.
- Restrict methods and payload size; validate amounts/currency and correlate the
  process or opaque reference to a saved request. Atomically insert the receipt,
  encrypted replay payload, processing job and applicable student hold **before**
  acknowledging. Failure rolls all four back and returns non-success. A duplicate
  receipt must find its existing job or repair it transactionally, not just return
  early. Anonymous receipts use a separate fixed intake cap and cannot consume
  authenticated request or orphan capacity. Authenticated unknown processes use
  fixed intake caps, never name/phone matching; support replay when a known result
  later arrives. Time-window rate limiting
  and quarantine expiry remain unimplemented; saturated intake requires manual
  reconciliation rather than being treated as an automatically expiring queue.
- A known process ID or a custom field is correlation, not proof of authenticity.
  Obtain Grow's supported verification method (signature or authenticated
  transaction retrieval). A secret Make-to-app header authenticates that hop
  only; forwarding an unauthenticated Grow callback does not make it verified.
- Until verification is confirmed, show **payment reported / awaiting verification**;
  do not reduce payable balances automatically. An explicit teacher reconciliation
  action can confirm a payment after checking Grow's dashboard, with an audit trail.
- Treat receipt identity separately from financial identity. Multiple callbacks
  can describe one transaction; a prior unverified/failed receipt must not suppress
  a later verified paid update. Confirm financial identity with Grow and reject
  conflicting amounts/currencies/processes into review. Unverified input cannot
  reserve the canonical transaction identity in a way that blocks authentic data.
  Post the payment, allocation movements, ledger revision, request transition and
  approval job in one transaction. The provider transaction uniqueness constraint
  prevents both event races and manual-confirmation races from posting twice.
  Installment/recurring events remain unsupported review cases in this release.
- Enqueue ApproveTransaction separately from posting payment. Approval is Grow's
  acknowledgement step, not assumed authentication; retry failures without
  duplicating payment. Make should map Grow's required fields from the callback
  and its secured business configuration. [Approval reference][grow-approve]
- Persist a link result, request transition and quarantine-replay jobs atomically,
  so a crash after result receipt cannot strand an earlier payment notification.
- Claim jobs with expiring leases and fencing generations; accept a worker's
  completion only for its current generation. Financial posting is idempotent
  regardless of lease expiry. Confirm approval replay behavior in sandbox; an
  ambiguous external response is not proof of completion. Retry delivery of the
  same operation, never rerun link creation. Use bounded retries/backoff, visible
  review status, and a runner time budget shorter than its Vercel limit.
- Store the minimum fields needed to replay verification/approval in encrypted
  `integration_payloads`, with `PAYMENT_PAYLOAD_KEY` held outside the database and
  available to the server/restore operator. Define the field allowlist from actual
  Make module inputs. Set a seven-day initial retention deadline; stop automated
  retries before expiry and require review/export or explicit audited extension
  for unresolved jobs. A successful job purges its payload after 24 hours. Purge
  jobs must never delete an unresolved job's payload silently; missing/expired
  payload enters `needs_review`. Test restart/replay and key availability on restore.
  Retain minimal redacted ledger evidence after purge. Never return payloads or
  log provider tokens, card details, callbacks, Google tokens or credentials.
- No unawaited post-response work; the durable scheduled runner processes jobs.
  Local-link pruning never deletes ledger, active-request or pending-job records.

## Local-storage migration and rollout

1. Introduce `BILLING_MODE=shadow|live|recovery` (server-side) and an authenticated capability
   response. Shadow mode uses fixtures/reviewed data and must not dispatch real
   Grow requests. Enable live mode only after the external checklist passes.
2. Preserve existing local settings and pricing. Persist issued invoice amounts
   in Turso; local overrides continue to preview changes until explicitly saved.
3. Offer a reviewed import of legacy links and opening balances. Legacy records
   have only URL/amount/name/month, so import them as unverified history. They do
   not establish a debt, paid status, or provider identity. Never import them as
   an idempotency guarantee or automatically recreate them.
4. Commit imports atomically, mark completion only after success, and keep local
   originals until confirmation. Report ambiguous student aliases for review.
5. Start callback intake on a stable deployment before enabling callback-dependent
   links. Existing Grow links may have an old/fixed notify URL; confirm whether
   Grow can update them and document which historical payments require review.
6. If live billing is disabled after rollout, stop new tracked link creation and
   keep callback intake and job processing available. Rolling back the UI must
   not discard incoming payments or resume the old untracked creation path.

## Restore and recovery procedure

A backup rollback also rolls back request/payment deduplication keys. Existing
Grow links, payments and callbacks do not roll back with it. A restored database
must therefore never resume live collection immediately.

1. Disable collection in the existing database using `npm run db:configure`
   without `--enable-collection`, then deploy server `BILLING_MODE=recovery`
   **before** restoring or switching the database.
   Creation requires live mode and a database control row signed off as normal;
   either recovery gate blocks dispatch. Never restore over a database accepting
   callback/result writes: restore into a new database and keep the old database
   as the durable intake during reconciliation. If the old database is unavailable,
   provision an isolated recovery intake database or return non-success; never
   acknowledge arrivals that have nowhere durable to go.
2. Record the backup checkpoint and the interval of potentially missing activity.
   Recover from the current database/export where possible before replacing it.
   Import preserved arrivals into the restored database using the normal duplicate
   checks, not raw table overwrite. Review provider/environment identity and keys.
   At cutover, drain in-flight intake writes and replay through a recorded receipt
   watermark; retain the intake database and re-scan for late writes before retiring
   it. The restore drill must prove that every acknowledged arrival survives cutover.
3. Reconcile that interval using Make execution results, Grow dashboard activity
   and any supported authenticated lookup. Recover created links and payments,
   including those never acknowledged by the app. A restored absence of a request
   ID is not permission to dispatch it again. Browser-local IDs are supplemental
   evidence, not a complete external activity log.
4. Replay receipts and jobs, verify transaction uniqueness, allocations and active
   request slots, and account for missing/expired payloads explicitly. If automated
   listing is unavailable, complete a documented dashboard review; unresolved
   students remain held even when others are released.
5. The teacher signs off the reconciled checkpoint. Only then set the database
   control row to normal and re-enable live mode. Never rely on a control flag
   inside the backup alone: it may contain an old normal/live value.

Acceptance drill: back up, create a link and post a payment after the checkpoint,
restore, then retry both original operations. Creation must be blocked until the
external activity is recovered; the payment posts once and no replacement link
is dispatched. Repeat with a callback arriving during recovery.

## Later step: external setup and integration checklist

### Turso and Vercel

- [ ] Provision separate production and preview **libSQL** databases; confirm the
  SDK/engine choice and current free-tier limits in the account.
- [ ] Put `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` in the corresponding Vercel
  server environments. Never prefix either secret with `VITE_`.
- [ ] Apply versioned migrations to preview, test, then production. Set up an
  export/backup and test the recovery drill above, including reconciliation of
  post-backup provider activity; confirm the account's recovery limits.
- [ ] Configure `BILLING_MODE`, shared secrets for Make result callbacks/job runs,
  existing `MAKE_WEBHOOK_URL`, new `MAKE_OPERATIONS_WEBHOOK_URL`, `MAKE_API_KEY`,
  `ALLOWED_EMAIL`, OAuth client ID, `PAYMENT_PAYLOAD_KEY`, and, if forwarding is
  used, `MAKE_NOTIFY_SECRET`. Keep payload encryption keys outside database backups
  and test their separate recovery. Use the exact secret names defined above.
- [ ] Use a stable preview origin and register it with Google OAuth. Preview
  databases, Make scenarios and Grow sandbox credentials must remain separate
  from production. Keep production callbacks on a stable production URL.

### Grow: confirm the existing Make connection and remaining capabilities

- [ ] Reuse the existing Make connection; create a separate sandbox connection
  using the guide. Only request separate API access if a required capability
  actually needs a direct API endpoint.
- [ ] Inspect the webhook trigger's authenticity handling and known-link lookup
  output. Confirm whether either can verify transaction identity/status/amount.
  If unavailable, launch with reported status and audited teacher confirmation.
- [ ] Confirm full status codes, currency, amount decimals, transaction identity,
  callback retries/acknowledgement requirements, and refund/reversal behavior.
- [ ] Confirm whether creation supports an idempotency key, and whether a link can
  be found by our external request ID after an ambiguous timeout. Known-process
  lookup is not recovery by request ID; keep unresolved creation held if neither
  capability exists.
- [ ] Confirm how to deactivate/replace an old payment link and whether there is
  a race with a payment already in progress. Start with the documented Grow
  interface workflow and require closure/final-payment evidence before release.
- [ ] Confirm custom-field length/character restrictions and callback visibility
  or editability. Use an opaque alphanumeric reference, not names or a colon-based
  invoice key. Grow exposes `cField1`/`cField2`; confirm the actual Make mapping.
  [CreatePaymentLink reference][grow-create]
- [ ] Configure one-time/single-payment links and disable unintended provider SMS
  or email if WhatsApp remains the delivery channel; use Sending Mode `none`.
- [ ] Capture redacted sandbox create, callback, verification and approval fixtures
  using a sandbox test-card payment, not only the callback simulator. Use Grow's
  documented test cards: external wallets can charge real money even in sandbox.
  Test actual merchant VAT configuration separately; the sandbox does not establish
  VAT-exempt production behavior. [Testing guidance][grow-make]

### Make: extend creation and add callback/reconciliation workflows

- [ ] Export the current scenario blueprint before editing; build a sandbox copy.
- [ ] Extend webhook inputs with request ID/reference and map the reference into
  Grow custom fields. Set the stable application's notify URL.
- [ ] Preserve URL, process ID and process token from the Grow result; send them
  to `/api/payment-link-result` with the shared secret before the usual response.
  Retain the existing JSON response envelope for compatibility.
- [ ] Configure retry/error handlers so a completion-callback failure retries
  delivery of the **existing result**, never reruns CreatePaymentLink. Ambiguous
  creation failures must enter reconciliation, not a generic automatic replay.
- [ ] Add authenticated verification and ApproveTransaction actions callable by
  the app's job processor, using existing Grow modules; return structured outcomes
  and explicit unsupported capabilities. Compare direct Notify URL intake with
  Grow's Make webhook trigger. Choose one route, prove durable forwarding and
  check authenticity handling before enabling it. Define the approval payload
  allowlist, test approval replay, and check payload-retention deadlines.
- [ ] Add a scheduled job to call the app's bounded `/api/payment-jobs` runner and
  monitor unresolved requests/approval errors. Check actual Make credit consumption
  and scheduling limits for the chosen plan.
- [ ] Turn scenarios on and test invalid secrets, service failures, duplicate
  deliveries and lost original HTTP responses.

## Implementation tasks and acceptance tests

| Task | Files/components | Done when |
|---|---|---|
| T1: storage foundation | migrations, db adapter, repository, scripts | clean migration/re-run and rollback-on-failure tests pass locally; no secrets in browser bundle |
| T2: identity and ledger | shared verifier, billing service/API, balance helpers | owner isolation, stable aliases, invoice versions, signed allocation reversal and unapplied-credit hold tests pass; manual/automatic confirmation of the same Grow transaction posts once |
| T3: durable link requests | service/client and existing single/batch endpoint | same-ID replay, conflicting payload, cross-month overlap, two-tab race, pending-payment hold, unknown timeout and result recovery tests pass; completed batch items survive a lost response |
| T4: callback and jobs | notify/result/job adapters, event service | atomic receipt/payload/job and result/replay commits survive injected crashes; multiple event IDs for one transaction post once; stale workers, expired payloads, approval retry and missing verification capability route correctly |
| T5: UI and migration | useBilling, App, CalculatorPage, EditableTable, CSV/message helpers | prior-only students appear; totals match in UI/CSV/WhatsApp; pending/unknown states cannot cause blind retry; reviewed import is repeatable |
| T6: later external setup | checklist above, redacted fixtures and operating notes | sandbox creation → completion recovery → automatic or audited manual confirmation → allocation → approval works after browser closure and deploy restart; backup rollback cannot recreate post-checkpoint links |

Specific balance regressions: partial payment across two months; late payment on an
old link; both old and new links paid; amount changed after issue; cash payment;
student rename; no current-month lessons; refund after full payment; duplicate
event; installment event routed to review; reselect/recalculate a month without
double carry-forward; unknown history never inferred to be unpaid.

Review regressions: overlapping August/September links are refused; payment
reported while preparing a replacement keeps the hold; cash payment does not
silently deactivate an already-delivered Grow link; two distinct events for one
transaction and teacher confirmation racing verification post one principal;
crashes between receipt/job writes roll back both; replay payload loss stops jobs
visibly; partial refund reverses only the needed allocation movements; an old
backup cannot release a new provider link; missing provider capabilities exercise
the explicit manual paths without silently declaring verification complete.

Use Deno for pure service tests and isolated repository integration tests if the
selected client works in that runner; otherwise add a narrow Node test command
for the database adapter. Keep React hook/component tests in the existing Vitest
suite. Final checks: `npm test`, `npm run lint`, `npm run build`, then a preview
smoke test with sandbox credentials and an independent production restore check.

Production completion requires resolving the callback-verification and ambiguous
creation paths, or explicitly retaining their visible manual-review behavior.
Delete the payment-status, carry-forward, and idempotency TODOs only after their
acceptance criteria pass; a stored request ID alone is insufficient.

[turso-sdk]: https://docs.turso.tech/sdk/ts/reference
[libsql-client]: https://tursodatabase.github.io/libsql-client-ts/interfaces/Client.html
[grow-create]: https://developers.grow.business/reference/create-payment-link
[grow-callback]: https://developers.grow.business/reference/payment-request-callback
[grow-approve]: https://developers.grow.business/reference/approve-transaction-1
[grow-make]: https://developers.grow.business/docs/grow-app-for-make
[grow-link-info]: https://developers.grow.business/reference/get-payment-link-info
