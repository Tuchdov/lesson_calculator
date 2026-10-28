# Lesson Calculator

A React app for calculating monthly lesson payments from Google Calendar, with a Turso-backed billing ledger served by Vercel API functions.

Signs in with Google, reads your calendar, groups events by student, applies pricing rules, and exports a CSV invoice.

## How it works

1. Sign in with your Google account — the app requests read-only access to your calendar.
2. Select a month and click **Calculate**.
3. The app fetches your calendar events, filters for lessons (events containing "פיתוח קול"), and calculates what each student owes based on lesson duration and regularity.
4. Click **Save month** to record invoices, then review prior balances and payment status.
5. Prepare payment links and send them through WhatsApp, or export the saved balances as CSV.
6. Check Grow payment reports and confirm them under **Manage payments**. Cash/bank payments and reviewed refunds have separate actions.

Billing setup is documented in [Billing setup and Grow/Make handoff](docs/billing-setup.md).
The database starts with collection disabled. Automatic payment verification and
recovery of an unknown creation result remain later integration work; the app uses
explicit review rather than automatically retrying a potentially created link.

Student pricing is determined automatically:
- **Regular** — attended at least once per week in the billing month (or 4+ lessons total).
- **Non-regular** — all other students.
- **Custom prices** — per-student overrides saved in the Custom Prices page, stored locally in your browser.

## Getting started

### Prerequisites

- [Node.js](https://nodejs.org) 22 (22.22.2+) or 24 (24.15+) for the app and React hook tests
- [Deno](https://deno.land) 2+ (for the unit tests)
- A Google Cloud project with the **Google Calendar API** and **Google Identity Services** enabled
- An OAuth 2.0 Client ID (Web application type) from Google Cloud Console

### Setup

1. Clone the repo and install dependencies:
   ```bash
   npm install
   ```

2. Create a `.env.local` file with your Google OAuth client ID:
   ```
   VITE_GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
   ```

3. In Google Cloud Console, add `http://localhost:5173` to the **Authorized JavaScript origins** for your OAuth client.

4. Start the dev server:
   ```bash
   npm run dev
   ```

   This runs the calendar and calculator UI only. CSV lesson estimates remain
   available; saving billing records and preparing links require the API and
   database setup in the [billing guide](docs/billing-setup.md).

### Build for production

```bash
npm run build
```

Deploy the Vite output in `dist/` together with `api/` to Vercel. Add your production domain to the Authorized JavaScript origins in Google Cloud Console and configure the server environment using the billing setup guide. `npm run dev` serves the UI; use `npx vercel dev` to exercise the API routes locally.

## Configuration

Pricing and calendar settings live in [`public/pricing_config.json`](public/pricing_config.json):

| Field | Description |
|---|---|
| `calendar_id` | Which calendar to read (`"primary"` for the default) |
| `cancelled_keywords` | Event title keywords that mark a lesson as cancelled |
| `student_name_regex` | Regex to extract student name from event title |
| `prices.regular` | Per-duration prices (60/45/30 min) for regular students |
| `prices.non_regular` | Per-duration prices for non-regular students |

Per-student price overrides are managed through the **Custom Prices** page in the app and stored in browser `localStorage`.

## Running tests

Run the Deno unit tests, Node database/API tests, and React hook/component tests:

```bash
npm test
```

Run the suites independently:

```bash
npm run test:unit        # Deno tests for the API and calculation/storage helpers
npm run test:db          # Real local libSQL transactions and API adapters
npm run test:hooks       # React hook/component tests, once
npm run test:hooks:watch # React hook tests, watch mode
```

The hook suite lives in `tests/hooks/` and uses Vitest, React Testing Library's
`renderHook`, and jsdom. It covers authentication/session refresh, calendar
loading and payment results, and settings loading/persistence. Google Identity
Services, network requests, and persistence helpers are mocked; no credentials
or live services are needed. Deferred promises and fake timers exercise pending
states, failures, retries, and authentication timeouts without real delays.

`deno test` still runs the original suite directly. Each runner excludes the
other suite. Add hook tests as `tests/hooks/*.test.js`; shared cleanup unmounts
hooks and resets timers, mocks, globals, and browser storage after every test.

## Security

- Raw calendar events are processed in the browser. Saving a month sends invoice amounts, lesson counts and price snapshots to the authenticated billing API. Student billing and payment records are stored in Turso.
- Your Google OAuth access token is stored in `sessionStorage` (cleared when you close the tab).
- Custom pricing settings are stored in `localStorage` keyed by `SHA-256(email)`.
- A Content Security Policy restricts script execution to this app and `accounts.google.com`.

### Vercel preview sign-in

Google OAuth requires an exact authorized JavaScript origin; per-deployment
Vercel preview URLs cannot be registered automatically by this app. Assign a
stable preview domain to the project in Vercel, add its `https://` origin to
Authorized JavaScript origins on the Google Cloud OAuth client, and configure
`VITE_GOOGLE_CLIENT_ID` for the Preview environment. Open previews through
that domain. The Google account must also be an OAuth test user if the consent
screen is in testing mode. Configure separate preview billing credentials and Grow Sandbox/Make connections using [the setup guide](docs/billing-setup.md).
