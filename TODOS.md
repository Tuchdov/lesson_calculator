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

**Depends on / blocked by:** The token-refresh fix (branch `Add-csv`)
landing first.

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


# Add an option to select whc make automation to do
there are certian individuals that owant to pay in methods that other people are not allowed to on only for them the paymnet options are open for the others they are close.

# add an option in Make.com to send a cetain invoice with specific details i.e adivisory etc..


## Searching for a student in Custom Prices doesn't take you to them

**What:** On the Custom Prices (overrides) page, typing a student's name to find them does
not filter the list or scroll to their card, so you still have to hunt through every
student by hand.

**Why it happens:** The only text box on the page is the "Student name" *add* input in
`src/components/CustomPricesPage.jsx`. Its datalist suggestions deliberately exclude
students who already have an override (`.filter(s => !customPrices[s])`), and nothing
filters, scrolls to, or highlights the existing cards below.

**Possible directions:** Filter the student cards as you type, or scroll to and
highlight the matching card, or add a separate search box apart from "Add student".

**Context:** Reported by the user on 2026-10-10. Logged only, not fixed yet.

**Depends on / blocked by:** Nothing.

## Carry unpaid months into the next payment request

**What:** If a student did not pay last month, the new payment request should cover the
whole outstanding amount (last month's unpaid balance plus the current month), instead of
only the current month's lessons.

**Why:** Today each month is calculated and messaged on its own, so an unpaid month is
easy to lose track of and the teacher has to chase and add it up by hand.

**Open questions:** The app has no record of who paid. This needs paid-status tracking
first (see "Track payment status from Grow's server-to-server callback"). Also decide
whether the message should show the months as separate line items or one combined total,
and how far back to carry.

**Context:** Future feature requested by the user on 2026-10-10. Logged only.

**Depends on / blocked by:** Paid-status tracking.

## Sort students alphabetically within the regular / non-regular groups

**What:** In the calculator table, sort the students alphabetically inside each group
(Regular, Non-regular).

**Where to look:** Rows are split into the two groups in `src/components/EditableTable.jsx`
(the grouping near the bottom of the file, `g[r.student_type]?.push(r)`). Sorting each
group there, with a Hebrew-aware comparison such as `localeCompare(b, 'he')`, would do it.

**Context:** Requested by the user on 2026-10-10. Logged only, not implemented.

**Depends on / blocked by:** Nothing.

## Let the user add more lesson keywords (e.g. כתיבה והלחנה)

**What:** Let the user configure which calendar event titles count as lessons. Today only
events containing `פיתוח קול` are counted. The user wants to add others, such as
`כתיבה והלחנה`, and similar lesson types.

**Where to look:** The phrase is a hard-coded constant, `REQUIRED_LESSON_PHRASE`, in
`src/lib/calendarPayments.js`. It is used in three places: `isTargetLesson` (decides
whether an event counts), and `nameAroundLessonPhrase` (finds the student's name before or
after the phrase). The Settings page already has editable lists for cancelled keywords and
paid-cancellation phrases (`src/components/SettingsPage.jsx`, `src/lib/userSettings.js`),
so a new `lesson_keywords` list could follow the same pattern, with `פיתוח קול` as the
default.

**Things to decide:** `nameAroundLessonPhrase` needs to find whichever keyword matched, so
the name is still cut out correctly. Also decide whether all lesson types share the same
price tables or can have their own.

**Context:** Requested by the user on 2026-10-10. Logged only, not implemented.

**Depends on / blocked by:** Nothing.

## Flag lessons with non-standard durations or add-ons for review

**What:** Events that don't fit the 60/45/30-minute tiers, such as
`יובל חייט פיתוח קול - תוספת 15 דק השלמה` (15 extra minutes added to a 60-minute lesson),
should be surfaced for the teacher to resolve instead of being dropped.

**Why:** In `calculatePayments` (`src/lib/calendarPayments.js`) an event with no
recognised duration is skipped without any message, so the total is silently too low and
looks correct. Silent drops are the worst failure mode here.

**Proposed UX:** Don't block calculation with a modal, and don't guess silently.
1. Show the table and totals right away, with a "needs review" marker on the student's
   row, e.g. "1 lesson not counted: תוספת 15 דק השלמה".
2. Resolve inline with one click: charge pro-rata (15/60 of the lesson price), charge a
   fixed amount the teacher types, or don't charge.
3. Pre-select a default from the wording. "השלמה" usually means a make-up, so default to
   "don't charge".
4. Remember the answer: offer "always treat 'השלמה' as free" or "treat +15 min as
   pro-rata" as a rule in Settings, like the paid-cancellation phrases, so the same event
   type never asks again.
5. Block "Prepare links" and WhatsApp sending while review items are unresolved, because
   those messages carry money.

**Open question:** Is `תוספת 15 דק` a separate 15-minute calendar event, or text on the
60-minute event itself? The two need different handling (a standalone short event vs. an
adjustment attached to a normal lesson).

**Context:** Raised by the user on 2026-10-10 and discussed as a UX question. Logged only,
not implemented. Related to "Let the user add more lesson keywords", since both rely on
configurable title rules.

**Depends on / blocked by:** Nothing.

## Custom price not applied: student shown as "ענבר אמא" at 200 instead of 230

**What:** The customer saved as `ענבר 11.5 (אמא עינת)` has a custom price of 230, but the
calculator lists her as `ענבר אמא` and prices her at the default 200.

**Likely cause (not yet confirmed):** Custom prices are looked up by the exact student
name (`resolvePriceTable` in `src/lib/calendarPayments.js`, `student in customPrices`).
The name the calendar parser produces (`ענבר אמא`) differs from the saved key
(`ענבר 11.5 (אמא עינת)`), so the lookup misses and the default price is used. The
parser keeps only two words and handles parentheses word by word
(`normalizeStudentName`), so names containing a number or a multi-word parenthetical come
out mangled. This is probably the same root problem as the אלה עוז entry (one student
appearing under different names), so fix them together.

**To do first:** Get the real calendar event title for her, and reproduce the output in a
`tests/*.test.js` case before changing anything.

**Possible directions:** Strip whole `(...)` groups when building the name, and/or let
Settings map several calendar spellings to one saved student. Matching custom prices
loosely would be risky, since it could apply one student's price to another.

**Context:** Reported by the user on 2026-10-10. Logged only, not investigated or fixed.

**Depends on / blocked by:** Nothing.

## Send number_of_lessons to the Make webhook

**What:** Include a `number_of_lessons` field in the payload sent to the Make webhook, next
to the existing `customer_name`, `amount`, `phone` and `description`.

**Where to look:** The field has to be passed along the whole chain:
1. The two call sites of `requestPaymentLink`, in `src/components/CalculatorPage.jsx` ("Prepare all links") and `src/components/EditableTable.jsx` (single row), add the row's lesson count.
2. `src/lib/paymentLinkClient.js` adds it to the request body.
3. `api/create-payment-link.js` reads it and `src/api/paymentLinkService.js` validates it and adds it to the Make payload (`customer_name`, `amount`, ... around line 119).

**Things to decide:** The row only stores per-duration counts (`count_60`, `count_45`,
`count_30`), so `number_of_lessons` would be their sum. Check how a doubled lesson
(`doubleDuration`) is counted, since it adds 2 to a count. Also decide whether the Make
scenario and the Grow description should use the field, which is a change on the Make side.

**Context:** Requested by the user on 2026-10-10. Logged only, not implemented.

**Depends on / blocked by:** Nothing in the app. The Make scenario must accept the new field.

## Same student split into two names by calendar title parsing

**What:** The student אלה עוז shows up under two different names when lessons are read from
the calendar: `אלה עוז (אמה נועה)` and `אלה עוז (9.5)`. They should be counted, priced,
and messaged as one student. The calendar import has the same problem. One event title
reads `אלה עוז (9.5) - פיתוח קול ✨ אמא נועה`.

**Why:** Her lessons get split across two rows. That means two lesson counts, possibly
the wrong tier (each half may not count as "regular"), two WhatsApp messages and two
payment links, and a custom price that matches only one of the keys.

**Where to look:** Names come from `inferStudentName` → `nameAroundLessonPhrase` →
`normalizeStudentName` in `src/lib/calendarPayments.js`. On paper that keeps the first
two non-`(` words, so both spellings *should* collapse to `אלה עוז`. The split is
therefore probably coming from somewhere else, e.g. the regex path (`student_name_regex`),
the separator split on ` - `, the ✨ or the trailing parent note (`אמא נועה`), or from
saved keys (custom prices / CSV import) that store the full parenthetical name. Collect
her real event titles and saved custom-price keys first, then reproduce in a
`tests/*.test.js` case before fixing.

**Possible directions:** Strip whole parenthetical groups `(...)` from the name, or
support a per-student alias map in Settings (e.g. several calendar spellings → one
canonical student), or both. Related to the "Custom price not applied: student shown as
'ענבר אמא'" entry, which is probably the same root problem, so fix them together.

**Context:** Reported by the user on 2026-10-10. Logged only, not investigated or fixed
yet.

**Depends on / blocked by:** Nothing.

## Remember the calculation when navigating to Settings / Custom Prices and back

**What:** After calculating a month, going to Settings or Custom Prices and then back to the
calculator should show the same calculation (rows, summary, selected month) instead of an
empty page that needs recalculating.

**Why it happens:** `App.jsx` renders only the active page (`page === 'calculator' && ...`),
so `CalculatorPage` unmounts on navigation and its `rows`/`summary` state in
`useCalendarData` is lost.

**Possible directions:** Lift the calculation state into `App.jsx` (or a context), or keep
`CalculatorPage` mounted and just hide it when another page is active. Whichever is chosen,
the returned page should reflect any price or phone changes made on the other pages,
so the cached rows may need re-pricing rather than being shown as they were.

**Context:** Requested by the user on 2026-10-10. Logged only, not implemented. Closely
related to "Preserve calculation state across a forced re-authentication", which needs the
same state lifted above the auth gate, so do them together.

**Depends on / blocked by:** Nothing.

## Custom WhatsApp message per student in the Custom Prices table

**What:** Let each student in the Custom Prices page have their own WhatsApp message
template, used instead of the default message when set.

**Where to look:** The default message is `default_message` in the user settings
(`src/lib/userSettings.js`), and the message is built in `src/lib/whatsapp.js`. Per-student
phone numbers already live in `customer_details`, so a per-student message could be stored
there too (e.g. `customer_details[student].message`), with an empty value meaning "use the
default". The input would go on each student's card in `src/components/CustomPricesPage.jsx`.

**Things to decide:** Which placeholders the custom message supports (name, amount,
payment link, month, number of lessons), and whether to show a preview. Fall back to the
default message when the field is blank, so existing students are unaffected.

**Context:** Requested by the user on 2026-10-10. Logged only, not implemented. Related to
the Make "special payment options per student" note at the top of the free-form items.

**Depends on / blocked by:** Nothing.
