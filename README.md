# Lesson Calculator

A client-side React app for calculating monthly lesson payments from Google Calendar events.

Signs in with Google, reads your calendar, groups events by student, applies pricing rules, and exports a CSV invoice.

## How it works

1. Sign in with your Google account — the app requests read-only access to your calendar.
2. Select a month and click **Calculate**.
3. The app fetches your calendar events, filters for lessons (events containing "פיתוח קול"), and calculates what each student owes based on lesson duration and regularity.
4. Download the results as a CSV file.

Student pricing is determined automatically:
- **Regular** — attended at least once per week in the billing month (or 4+ lessons total).
- **Non-regular** — all other students.
- **Custom prices** — per-student overrides saved in the Custom Prices page, stored locally in your browser.

## Getting started

### Prerequisites

- [Node.js](https://nodejs.org) 18+ (or [Deno](https://deno.land) 2+)
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

### Build for production

```bash
npm run build
```

The output is in `dist/` — deploy it to any static host (Vercel, Netlify, GitHub Pages, etc.). Remember to add your production domain to the Authorized JavaScript origins in Google Cloud Console.

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

Tests use Deno:

```bash
deno test
```

## Security

- The app never sends your calendar data to any server — all processing happens in your browser.
- Your Google OAuth access token is stored in `sessionStorage` (cleared when you close the tab).
- Custom pricing settings are stored in `localStorage` keyed by `SHA-256(email)`.
- A Content Security Policy restricts script execution to this app and `accounts.google.com`.
