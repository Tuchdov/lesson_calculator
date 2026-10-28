# Changelog

## [Unreleased]

### Added
- Save invoices and review paid, unpaid, and carried balances in a durable billing ledger.
- Record cash or bank payments, checked Grow reports, charge adjustments, and verified refunds.
- Review historical links and recover payment requests after interrupted creation.

### Changed
- Prepare payment links in batches with one Google identity check and prevent overlapping active requests for a student.
- Export saved balances and payment status, or download a lesson-only estimate when billing is unavailable or unsaved.
- Keep live collection disabled until the billing database and payment integration are configured and reviewed.

## [0.1.0] — 2026-07-01

### Added
- **WhatsApp payment-request integration** — send payment summaries to students directly from the calculator table
  - Green "📱 שלח" chip in dedicated WhatsApp column when a phone is saved; sends pre-filled Hebrew message via wa.me
  - Amber "📱 הוסף טלפון" chip when phone is missing; expands inline row for phone entry without leaving the page
  - Israeli phone format validation (05X-XXXXXXX) at input time
  - Pre-filled message includes student name, Hebrew month name, amount, and `[קישור לתשלום]` placeholder
  - Phone numbers stored per-student under `customer_details` in user settings (localStorage, keyed by email hash)
  - Phone field on Custom Prices page for bulk phone entry and editing
  - Full backward compatibility: existing settings without `customer_details` are back-filled on load
- **New utility library** `src/lib/whatsapp.js` — `validateIsraeliPhone`, `formatPhoneForWhatsApp`, `buildPaymentMessage`, `buildWhatsAppUrl`

### Changed
- Default settings now include `customer_details: {}` alongside `custom_prices: {}`
- Calculator table is now 7 columns (added WhatsApp column)

### Tests
- 19 unit tests for WhatsApp utilities (phone validation, URL format, Hebrew month map, edge cases)
- 5 unit tests for settings persistence (defaults, round-trip, backward compat, corrupt JSON)
