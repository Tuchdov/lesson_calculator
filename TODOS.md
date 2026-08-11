# TODOs

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
