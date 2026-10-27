# TODOs

Payment persistence, balances, and retries are planned in
[Turso payment ledger](docs/designs/turso-payment-ledger.md). That plan includes
the application tasks and a separate Grow/Make provisioning and sandbox checklist
for a later step. The application implementation and local tests now exist;
these items remain open for remote provisioning and live integration verification.
See [Billing setup and Grow/Make handoff](docs/billing-setup.md) for exact contracts.
The plan now includes Grow's documented Make actions and the adversarial-review
requirements for overlapping links, transaction deduplication, atomic processing,
reversals, replay payloads, and recovery after restoring a backup.

## Preserve calculation state across a forced re-authentication

**What:** When a background silent token refresh fails and the app falls
back to `AuthScreen`, the user currently loses whatever calculation was on
screen (`rows`/`summary` in `useCalendarData`, owned inside `CalculatorPage`,
which unmounts when `App.jsx`'s `!accessToken` gate flips). Lift that state
above the auth gate (e.g. into `App.jsx` or a context), or replace the full
unmount with a lighter "session expired, click to continue" overlay that
doesn't destroy the underlying page.

**Why:** A user reviewing a completed calculation who then clicks Calculate
again (e.g. to switch months) and hits an unlucky re-auth loses the table
they were looking at and has to redo it — not data loss (custom price edits
persist immediately elsewhere), but a real, avoidable UX rough edge.

**Pros:** Removes the only user-visible rough edge left after the
token-refresh fix (`plan-eng-review`, 2026-08-11, Outside Voice Issue 11).

**Cons:** Touches state ownership/component architecture beyond the
auth-refresh fix itself — real scope, not a one-line change.

**Context:** Surfaced during the outside-voice pass of the token-refresh
plan review. Deliberately deferred out of that PR to keep it scoped to the
auth bug fix.

**Depends on / blocked by:** Independent follow-up; the token-refresh fix is already on main.

## Track payment status from Grow's server-to-server callback

**What:** Show a paid/unpaid indicator per student in the calculator table, fed
by Grow's notify webhook. Grow's `Create Payment Link` accepts `Custom Field 1`
/ `Custom Field 2` for an internal identifier (the student key), and the
[server-to-server callback](https://developers.grow.business/reference/payment-request-callback)
returns `status` (`"שולם"` when paid), `statusCode`, `sum`, `fullName`,
`payerPhone`, `transactionId`, `asmachta`, `paymentDate`, and `customFields`.

**Why:** The payment link makes paying easier for the student but leaves the
teacher reconciling by hand every month, which is the part that actually costs
time. This closes that loop.

**Pros:** Turns the app from a calculator into the whole month-end workflow.
Uses Grow's documented callback rather than polling.

**Cons:** Needs persistent state outside the browser. Grow calls the notify URL
server-to-server, possibly days later, when no browser is open, so localStorage
cannot receive it. The proposed store is Turso, accessed through the Vercel API;
Make remains the adapter for Grow. See the linked implementation plan.

**Open questions:** The current callback documentation shows a paid example with
`data.statusCode: "2"` and requires `ApproveTransaction` acknowledgement. Confirm
the complete status mapping and callback authenticity in a real sandbox flow.
Until authenticity is established, callbacks must remain reported/pending and
must not automatically reduce balances. This now affects collected amounts,
so a callback cannot be treated as just an informational checkmark.

**Context:** Scoped out during `/office-hours` on 2026-08-24 (branch
`grow-payment-link-integration`) to keep that branch focused on minting the link
and splicing it into the WhatsApp message. Note this is a second, larger break
from `DESIGN.md`'s "no Node.js backend server" constraint than the proxy
function itself.

**Depends on / blocked by:** Turso provisioning and the Grow/Make callback/approval setup.
The current implementation saves reports and supports audited manual confirmation;
automatic verification is not enabled.

## Carry unpaid balances forward

**What:** Show prior outstanding invoices alongside the selected month's charge
and include them in payment requests without copying the debt into a second
invoice. Allocate verified payments to their original invoices, oldest first.

**Depends on / blocked by:** Durable invoices and verified/manual payment tracking.
The [Turso plan](docs/designs/turso-payment-ledger.md) specifies opening balances,
partial payments, late payments on older links, credits, and students with debt
but no current-month lessons. Historical local links are not proof of unpaid debt.

## Make payment-link creation idempotent

**What:** Send a client-generated request id with each payment-link request and have the
service deduplicate on it, so a retry after a timeout returns the existing link instead
of minting a second one.

**Why:** If Grow creates a link but Make, Vercel, or the browser times out before the URL
comes back, the row is marked failed and a retry mints a second live link for the same
student and amount. Caching the result does not help, because nothing was ever cached.

**Pros:** Stops the Grow dashboard filling with orphaned links. Makes retry safe by
construction rather than by luck.

**Cons:** Deduplication needs state the request itself does not carry, which is the same
persistence problem paid-status tracking has. Database state alone cannot recover
a lost provider result; Get Payment Link Info requires process identifiers that
may have been lost with that response. Unresolved requests must stay held, and
only one active collection request per student is allowed across billing months.

**Context:** Raised by the Codex outside voice during `/plan-eng-review` on 2026-08-24.
Harm is low for this app: only one link is ever delivered to a student, so a duplicate is
clutter rather than a double charge. Deferred on that basis, not because it is wrong.

**Depends on / blocked by:** Shares its storage question with the paid-status TODO. Worth
doing in the same pass as that one.

## Register Vercel preview origins with Google OAuth

**What:** Add Vercel preview deployment origins to the authorized JavaScript origins for
the Google OAuth client, or accept that sign-in only works on the production domain.

**Why:** Preview deployments get their own origins. Google Identity Services rejects
sign-in from an origin that is not registered, so a preview build of any branch fails at
`AuthScreen` with no obvious cause, which makes previews useless for testing anything
past the login screen.

**Pros:** Makes branch previews actually testable, which matters more now that `/api/*`
routes exist and can only be exercised on a deployment or under `vercel dev`.

**Cons:** Vercel generates a new origin per deployment unless a stable preview alias is
configured, so this needs the alias set up first rather than adding origins one by one.

**Context:** Raised by the Codex outside voice during `/plan-eng-review` on 2026-08-24.

**Depends on / blocked by:** Nothing.
