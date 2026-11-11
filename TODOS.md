# TODOs

## Batch caller-identity verification across "Prepare all links"

**What:** `POST /api/create-payment-link` re-verifies the caller's Google token against
`tokeninfo` on every single call. "Prepare all links" fires one call per eligible student
(6 at a time), so a ~30-student month does ~30 redundant identity checks for the same
access token instead of one for the whole run.

**Why:** Each check is a real network round-trip to Google (typically 100-300ms), so this
adds real latency to every prepare-all run purely from re-verifying an identity that hasn't
changed between calls.

**Pros:** A batch endpoint (client sends all eligible students in one request, service
verifies once and loops/parallelizes the Make calls server-side) would cut ~30 tokeninfo
calls to 1.

**Cons:** Bigger change than it sounds — a Vercel serverless function has a max execution
duration, so looping ~30 sequential-ish Make calls inside one invocation needs the timeout
budget checked first. Also loses the current per-student independent failure/retry model
unless the batch response is itself per-student.

**Context:** Found during a `/code-review` pass on the Grow payment-link integration
(2026-08-24). At this app's real scale (30-35 students, once a month) the added latency is
annoying, not broken, so it was deferred rather than risking a bigger refactor right before
shipping the feature.

**Depends on / blocked by:** Nothing. Independent of the paid-status TODO below.

## Add React hook-testing infrastructure (RTL + jsdom)

**What:** Introduce `@testing-library/react` + `jsdom` (or equivalent) and write
the first hook tests, starting with `src/hooks/useAuth.js`'s token-refresh
logic: `requestToken`'s per-request GIS callback wiring (including its ~10s
timeout), and `getValidAccessToken`'s expiry-check and
persist-before-state-write ordering.

**Why:** `useAuth.js` holds the most intricate control flow in the app (GIS
callback wiring, silent-refresh retry/timeout, persist-before-state
ordering) with zero automated coverage — only manual testing via `npm run
dev` catches regressions here.

**Pros:** Closes the one remaining coverage gap identified in the
`plan-eng-review` for the token-refresh fix (2026-08-11). Establishes a
reusable pattern for any future hook logic in this repo.

**Cons:** First-of-its-kind infra for this repo — new devDependency, new test
config, non-trivial setup effort. Deserves its own focused PR/review rather
than riding on a bug fix.

**Context:** This repo currently tests only pure functions via
`Deno.test`/`@std/assert` (see `tests/*.test.js`, run via `deno test` per
`deno.json`). No RTL, no jsdom, no component/hook rendering tests exist
anywhere. Whoever picks this up should decide whether Deno's test runner can
host RTL+jsdom, or whether hook tests need a separate Node/Vitest-based test
path.

**Depends on / blocked by:** Nothing — can be done anytime after the
token-refresh fix (branch `Add-csv`) lands.

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
cannot receive it. Recommended landing spot is a Make Data Store (roughly one
operation per payment plus one read per app load, which fits the free tier);
polling `Get Payment Link Info` instead costs one Make operation per student per
page load and the docs never confirm it returns paid status at all.

**Open questions:** Grow's docs do not say which `statusCode` values mean paid,
so one real sandbox transaction has to be observed to learn it. The callback
also has no documented signature or authentication, so anyone who learns the
notify URL could POST a fake "paid" event. Blast radius is a wrong checkmark,
but the indicator should not be treated as proof of payment.

**Context:** Scoped out during `/office-hours` on 2026-08-24 (branch
`grow-payment-link-integration`) to keep that branch focused on minting the link
and splicing it into the WhatsApp message. Note this is a second, larger break
from `DESIGN.md`'s "no Node.js backend server" constraint than the proxy
function itself.

**Depends on / blocked by:** The Grow payment-link integration landing first.

## Carry unpaid months into the next payment request

**What:** If a student did not pay last month, the new payment request should cover the
whole outstanding amount (last month's unpaid balance plus the current month), instead of
only the current month's lessons.

**Why:** Each month is calculated and messaged on its own, so an unpaid month is easy to
lose track of and the teacher has to chase and add it up by hand.

**Open questions:** Whether the message shows the months as separate line items or one
combined total, and how far back to carry.

**Context:** Requested by the user on 2026-10-10. Not started on 2026-10-27 because the
app has no record of who paid.

**Depends on / blocked by:** "Track payment status from Grow's server-to-server callback"
above.

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
persistence problem paid-status tracking has.

**Context:** Raised by the Codex outside voice during `/plan-eng-review` on 2026-08-24.
Harm is low for this app: only one link is ever delivered to a student, so a duplicate is
clutter rather than a double charge. Deferred on that basis, not because it is wrong.

**Depends on / blocked by:** Shares its storage question with the paid-status TODO. Worth
doing in the same pass as that one.

## Prune the payment-link store

**What:** Drop payment-link entries older than a few months from
`vocalCalc:paymentLinks:<hash>`.

**Why:** The store is keyed by `{month}:{student}` and never cleaned, so it grows by
roughly 35 entries a month forever. A student whose calendar name changes also orphans
their old entries permanently.

**Pros:** Keeps localStorage tidy and makes the stored data inspectable by hand.

**Cons:** Pure housekeeping with no user-visible benefit at realistic sizes.

**Context:** ~105 entries a year at a couple of hundred bytes each, against a 5MB
localStorage budget. Years away from mattering. Captured during `/plan-eng-review` on
2026-08-24 so the growth is a known choice rather than an oversight.

**Depends on / blocked by:** The payment-link store existing.

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

## Land the branch backlog onto main

**What:** Get the 20 commits currently on `grow-payment-link-integration` (and `Add-csv`
before it) merged to `main`.

**Why:** `main` has none of the CSV import wizard, the Settings page, the WhatsApp
payment message, or the token-refresh fix. The Grow payment-link work therefore cannot
ship independently: any PR from this branch carries all twenty unrelated commits, which
makes it unreviewable and makes a rollback all-or-nothing.

**Pros:** Restores the ability to ship one feature at a time and to roll one back.
Unblocks the two older TODOs that are explicitly waiting on `Add-csv` landing.

**Cons:** Twenty commits of accumulated work to review in one go, which is exactly the
problem it is trying to prevent, just paid once.

**Context:** Noticed during `/plan-eng-review` on 2026-08-24 via
`git log --oneline main..HEAD`. Independently flagged by the Codex outside voice as
finding 13, which also pointed out that production would receive all twenty on first
deploy.

**Depends on / blocked by:** Nothing technical. This is a sequencing decision.

## Bulk-send the prepared payment messages on WhatsApp

**What:** Once "Prepare all links" has made a link for every student, add a
way to send all the WhatsApp payment messages in one go. Each student gets a
checkbox so the teacher picks who is included (for example, leaving out a student
who already paid or is away this month).

**Why:** Today each message is sent one at a time from its row: click the
student's 📱 chip, WhatsApp opens, press send, return, repeat. With ~30 students a
month, that's the slowest part of collecting payment.

**Pros:** Turns ~30 manual round-trips into choose-and-confirm. The checkboxes also
give a clear "who still needs a message" view.

**Cons:** `wa.me` links (`src/lib/whatsapp.js`) open one chat per click, and browsers
block opening many tabs at once. True one-click bulk sending needs the WhatsApp
Business Cloud API (Meta business verification, approved message templates,
per-message cost). The cheaper middle ground is a guided queue: send the checked
students one after another, opening the next chat as each one is sent.

**Context:** Requested by the user on 2026-10-30, after the payment-profile dropdown
fix (PR #11). Builds on the per-row send in `src/components/EditableTable.jsx` and
prepare-all in `src/components/CalculatorPage.jsx`.

**Depends on / blocked by:** Choosing between the Business API and the guided
queue. Fits well with "Track payment status from Grow's server-to-server callback"
above, which could untick students who already paid.
