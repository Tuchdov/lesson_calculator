// Shared price-table shape, reused by CustomPricesPage (hand entry) and
// importPlanner (bulk import) so the two paths can never drift apart.
export const DURATIONS = ['60', '45', '30']
export const TYPES = ['regular', 'non_regular']
export const DURATION_LABELS = { '60': '60 min', '45': '45 min', '30': '30 min' }
// Stored keys stay regular/non_regular so saved prices keep loading; only the
// labels changed: a regular student pays the discounted price.
export const TYPE_LABEL = { regular: 'Discounted price', non_regular: 'Full price' }

// Names that would silently rewire an object's prototype if used as a
// custom_prices key (e.g. `{ __proto__: {...} }`). Rows with these names are
// skipped during import rather than merged.
export const RESERVED_NAMES = new Set(['__proto__', 'constructor', 'prototype'])

// Column-header auto-suggest, matched as a case-insensitive substring.
// Order matters: non-regular is matched before regular, since headers like
// "non_regular_60", "לא רגיל" or "מחיר מלא" also contain a regular substring.
export const NAME_SYNONYMS = ['name', 'student', 'שם', 'תלמיד']
export const MINUTES_SYNONYMS = ['minutes', 'min', 'duration', 'length', 'דקות', 'דקה', 'זמן', 'משך']
export const NON_REGULAR_SYNONYMS = ['non-regular', 'non_regular', 'full price', 'full_price', 'fullprice', 'חד פעמי', 'חד"פ', 'לא רגיל', 'מחיר מלא']
export const REGULAR_SYNONYMS = ['regular', 'discounted price', 'discounted_price', 'price', 'מחיר עם הנחה', 'מחיר', 'רגיל']
// A price column's header never names a percentage; one that names a price
// outright is preferred over one that only names the tier.
export const PERCENT_MARKERS = ['%', 'percent', 'pct', 'אחוז']
export const PRICE_MARKERS = ['price', 'cost', '₪', 'מחיר', 'עלות']
export const PHONE_SYNONYMS = ['phone', 'tel', 'mobile', 'טלפון', 'נייד', 'פלאפון']
