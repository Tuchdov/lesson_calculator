// Shared price-table shape, reused by CustomPricesPage (hand entry) and
// importPlanner (bulk import) so the two paths can never drift apart.
export const DURATIONS = ['60', '45', '30']
export const TYPES = ['regular', 'non_regular']
export const DURATION_LABELS = { '60': '60 min', '45': '45 min', '30': '30 min' }
export const TYPE_LABEL = { regular: 'Regular', non_regular: 'Non-regular' }

// Names that would silently rewire an object's prototype if used as a
// custom_prices key (e.g. `{ __proto__: {...} }`). Rows with these names are
// skipped during import rather than merged.
export const RESERVED_NAMES = new Set(['__proto__', 'constructor', 'prototype'])

// Column-header auto-suggest, matched as a case-insensitive substring.
// Order matters: non-regular is matched before regular, since headers like
// "non_regular_60" or "לא רגיל" also contain the regular substring.
export const NAME_SYNONYMS = ['name', 'student', 'שם', 'תלמיד']
export const MINUTES_SYNONYMS = ['minutes', 'min', 'duration', 'length', 'דקות', 'דקה', 'זמן', 'משך']
export const NON_REGULAR_SYNONYMS = ['non-regular', 'non_regular', 'חד פעמי', 'חד"פ', 'לא רגיל']
export const REGULAR_SYNONYMS = ['regular', 'price', 'מחיר', 'רגיל']
export const PHONE_SYNONYMS = ['phone', 'tel', 'mobile', 'טלפון', 'נייד', 'פלאפון']
