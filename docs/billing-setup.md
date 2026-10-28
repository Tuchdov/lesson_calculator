# Billing setup and Grow/Make handoff

The repository implements the local ledger, payment-request guard, callback inbox,
manual payment confirmation, and approval worker. Provisioning Turso and changing
Make/Grow are still deployment tasks. Automatic callback verification and recovery
of a link without its process identifiers remain unsupported capabilities.

## Local database

1. Copy `.env.example` to `.env.local`. Keep your existing Google client ID and
   allowed email. Choose `GROW_ENVIRONMENT=sandbox` and a stable
   `GROW_MERCHANT_ID` identifying the business behind your Make connection.
2. Create the local directory and apply migrations:

   ```sh
   mkdir -p .billing-data
   npm run db:migrate
   npm run db:configure
   ```

   The default URL is a local SQLite/libSQL file. Configuration binds it to the
   merchant and environment and leaves collection disabled. For Turso, use the
   remote **libSQL** database URL/token instead and run the same commands. Use a
   separate database for preview and production. Scripts read `.env.local`.
3. Generate `PAYMENT_PAYLOAD_KEY` using `openssl rand -base64 32`. It must decode
   to 32 bytes and remain available independently of database backups. Set the
   integration secrets below to distinct values of at least 32 characters (for
   example, generate each with `openssl rand -hex 32`).
4. Run the app and API together with `npx vercel dev`; register the exact localhost
   origin/port with Google OAuth. `npm run dev` runs the Vite UI alone and does not
   serve `/api/*`. Use `BILLING_MODE=shadow` while reviewing local records.

`npm test` runs unit, local database/API, and React tests without credentials or
live payment calls. `npm run test:db` exercises the ledger against temporary files.
It includes failure injection, callback-before-result, duplicate transactions,
late completion, held credit, refunds, and a real snapshot-restore test.

## Environment variables

| Name | Purpose |
|---|---|
| `VITE_GOOGLE_CLIENT_ID` | Existing browser OAuth client ID |
| `ALLOWED_EMAIL` | Server-verified teacher account |
| `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN` | Server database connection; token not needed for a local file |
| `GROW_ENVIRONMENT` | `sandbox` or `production`, bound to the database |
| `GROW_MERCHANT_ID` | Stable business identifier bound to the database; never supplied by a callback |
| `BILLING_MODE` | `shadow` (default), `live`, or `recovery`; only live can dispatch links |
| `PAYMENT_PAYLOAD_KEY` | Base64 AES-256 key for stored callback replay fields |
| `MAKE_WEBHOOK_URL`, `MAKE_API_KEY` | Creation webhook and its `x-make-apikey` credential |
| `MAKE_RESULT_SECRET` | Authenticates result delivery to the app |
| `MAKE_NOTIFY_SECRET` | Authenticates forwarding from Make; when set, every notification must supply it. Required to associate new reports with billing requests; it does not establish Grow authenticity |
| `MAKE_OPERATIONS_WEBHOOK_URL` | Approval workflow described below |
| `PAYMENT_JOBS_SECRET` | Authenticates scheduled worker calls |
| `GROW_APPROVAL_REPLAY_SAFE` | Defaults false; only set true after testing repeated approval behavior |

Do not prefix server secrets with `VITE_`. Browser billing requests use authenticated
same-origin endpoints. Database version and merchant/environment mismatches stop
API operations. New databases also have a recovery gate in `billing_control`.

## Creation scenario: extend the existing flow

Reuse Grow's existing Make connection. The official guide uses business ID,
phone and OTP, not direct-API `userId`/`pageCode` credentials. Use a separate Grow
Sandbox connection for testing. [Grow Make guide](https://developers.grow.business/docs/grow-app-for-make)

The app sends the existing fields plus correlation metadata:

```json
{
  "version": 1,
  "request_id": "opaque-server-request-id",
  "billing_reference": "opaque-server-request-id",
  "amount_agorot": 48750,
  "customer_name": "Customer Name",
  "amount": 487.5,
  "phone": "0501234567",
  "description": "Payment description"
}
```

Map `billing_reference` into Grow Custom Field 1. Select delivery mode `none`,
regular charge, and a single payment. Set Notify URL to the stable deployed
`https://<app>/api/grow-notify`. Export the old scenario before editing it.

After Grow creates the link, add an HTTP POST to
`https://<app>/api/payment-link-result` with header
`x-make-result-secret: <MAKE_RESULT_SECRET>` and this JSON mapping:

```json
{
  "requestId": "<trigger.request_id>",
  "amountAgorot": 48750,
  "link": "<Grow data.url>",
  "processId": "<Grow data.paymentLinkProcessId as string>",
  "processToken": "<Grow data.paymentLinkProcessToken>"
}
```

Map `amountAgorot` from the original trigger's `amount_agorot`. Preserve the
existing final webhook response `{status:1,data:{url,paymentLinkProcessId,
paymentLinkProcessToken}}`. Result delivery comes before this response so the
app can recover even if the original browser request times out. Test the case
where the callback arrives first or is delivered twice.

If result delivery fails, retry only that HTTP delivery using the saved Grow
result. **Never rerun Create Payment Link automatically.** A timeout or malformed
response leaves the app request held. If the result is available in Make execution
history, replay the authenticated result callback; otherwise review the link in
Grow. Known-link lookup requires its process ID/token and does not establish
recovery by our request ID. No replacement is allowed until the Make execution has finished with no more
creation retries and the previous link's closure/final payment state is checked
and recorded. An unexpected late result on a closed request holds collection
again and appears as a separate review item.

## Payment notifications and confirmation

The notification endpoint accepts JSON with Grow's nested envelope:

```json
{
  "status": "1",
  "data": {
    "paymentLinkProcessId": "12345",
    "transactionId": "67890",
    "transactionToken": "<provider token>",
    "statusCode": "2",
    "paymentType": "2",
    "allPaymentsNum": "1",
    "sum": "487.50"
  }
}
```

Forward all documented fields required by Grow's approval module, not just this
short example. The server retains an encrypted allowlist of those fields. It
commits the receipt, payload and job before returning 200. That HTTP response
acknowledges storage; Grow's Approve Transaction action is a separate step.

Use Grow's Notify URL Webhook trigger in Make and forward the original envelope
with `x-make-notify-secret`, matching `MAKE_NOTIFY_SECRET` on the server. Once
configured, missing or incorrect credentials are rejected before storage.
Establish durable forwarding and inspect what authenticity checks the trigger
actually provides before switching Notify URL. A shared forwarding secret alone
is not proof that Grow originated an event. [Callback reference](https://developers.grow.business/reference/payment-request-callback)

If `MAKE_NOTIFY_SECRET` is unset, direct delivery is stored only in anonymous
quarantine, even for a known process ID. It cannot attach to a billing request or
place a student on hold. Anonymous quarantine has a separate 250-event limit;
authenticated unmatched receipts have their own 250-event limit, and authenticated
reports for each request have a 100-event limit. To make a quarantined receipt
available for confirmation, forward it again through the authenticated adapter.
That redelivery replaces the anonymous replay payload without duplicating the
receipt. Each forwarding credential authenticates only that hop; confirmation
still requires checking Grow.

Existing deployments must run `npm run db:migrate` for migration 002 before
deploying this version. Older receipts have no recorded forwarding authentication;
their existing links and owner decisions are preserved. Unmatched older receipts
require authenticated redelivery before they can be associated with a request.

Until a supported verification mechanism is established, reports appear as
pending. The teacher checks the transaction ID, paid amount and final status in
Grow, then uses **Manage payments → Confirm after checking Grow** and records
evidence. Confirmation posts the transaction once, allocates against the original
invoices, and queues approval. Unsupported currencies/installments/statuses stay
in review. An authenticated report arriving before the creation result is
quarantined until the process ID can be matched; it never creates debt or posts
payment automatically.

Historical browser links are copied to review records before old local copies
are pruned. They do not establish debt or payment. Inspect their status in Grow,
resolve them in Manage payments, and record only reviewed opening balances.
Cash/bank entries, charge adjustments and verified refund/correction records have
separate actions. A refund record does not initiate a provider refund. Unapplied
credit blocks new collection until resolved, and an active stale link must be
closed in Grow before its collection slot can be released.

## Approval scenario and scheduled worker

Create an operations webhook protected by `x-make-apikey`. The app sends:

```json
{
  "version": 1,
  "action": "approve",
  "jobId": "opaque-job-id",
  "data": { "transactionId": "67890", "transactionToken": "<provider token>" }
}
```

Map the full `data` payload into Grow's Approve Transaction module. After the
module confirms success, use a final webhook response:

```json
{ "version": 1, "action": "approve", "jobId": "<trigger.jobId>", "approved": true }
```

Do not hardcode `approved:true` on an error route. The app interprets an unexpected
response as uncertain, not successful. Test a real sandbox callback's required
fields and repeated acknowledgement before enabling replay. [Approval reference](https://developers.grow.business/reference/approve-transaction-1)

Schedule a Make HTTP POST to `https://<app>/api/payment-jobs` with header
`x-payment-jobs-secret: <PAYMENT_JOBS_SECRET>`. Each invocation processes at most
four jobs within a bounded time budget. Match the schedule to payment volume and
Make's plan limits. The UI shows review notices for failed approvals; after a
successful acknowledgement is checked in Make, record the evidence in the notice
form. Successful jobs allow replay payload purging after 24 hours; unresolved
payloads stop retrying at seven days and remain visible for explicit review.
Keep the database and payload key available to the recovery operator.

## Enable collection and recover safely

Only after preview tests and the external checklist in the design plan pass:

1. Review historical Grow links and starting balances, configure the result and
   approval scenarios, test callback intake, and record a reconciliation note.
2. Set `BILLING_RECONCILIATION_NOTE` in the shell/environment and run:

   ```sh
   npm run db:configure -- --enable-collection
   ```

3. Set server `BILLING_MODE=live` for the correct environment and deploy.

This deliberately requires both a database sign-off and server live mode.
Production and preview must use different databases, connections and secrets.
Use documented sandbox test cards; Grow warns that external wallets can still
produce real charges in sandbox. Test actual VAT configuration separately.

For recovery, first disable dispatch in the **existing** database with
`npm run db:configure` (without `--enable-collection`) and deploy
`BILLING_MODE=recovery`. Restore into a separate database while retaining durable
callback/result intake. Recover all post-backup Grow/Make activity, replay receipts,
and reconcile active slots before signing off and resuming live collection.
A restored absence of a request ID never authorizes another provider call. See
[the recovery procedure and acceptance drill](designs/turso-payment-ledger.md#restore-and-recovery-procedure).

Keep migrations immutable once used outside disposable test databases; future
schema changes require a new numbered migration. Never edit an applied migration
to force a production upgrade through its checksum check.
