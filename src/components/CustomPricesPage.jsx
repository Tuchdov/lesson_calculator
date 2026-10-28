import { useState, useEffect, useRef } from 'react'
import { validateIsraeliPhone } from '../lib/whatsapp.js'
import { DEFAULT_PAYMENT_PROFILE, isValidPaymentProfile, buildGrowDescription, MAX_INVOICE_DESCRIPTION } from '../lib/payments.js'
import { DURATION_LABELS, TYPES, TYPE_LABEL } from '../lib/priceConstants.js'
import { normalizeStudentName } from '../lib/calendarPayments.js'
import { ImportPricesPanel } from './ImportPricesPanel.jsx'
import styles from './CustomPricesPage.module.css'

function initialPhones(settings) {
  const p = {}
  for (const [student, det] of Object.entries(settings?.customer_details ?? {})) {
    if (det?.phone) p[student] = det.phone
  }
  return p
}

// Per-student overrides of the Make/WhatsApp defaults; blank means "use the
// default", so students without them behave exactly as before. full_name is
// the payer (a child's parent) shown on the payment page and invoice.
const EXTRA_FIELDS = ['full_name', 'payment_profile', 'invoice_description', 'message']
const ALL_MONTHS = Array.from({ length: 12 }, (_, i) => `2026-${String(i + 1).padStart(2, '0')}`)
const EMPTY_TIERS = { regular: { '60': '', '45': '', '30': '' }, non_regular: { '60': '', '45': '', '30': '' } }

function initialExtras(settings) {
  const e = {}
  for (const [student, det] of Object.entries(settings?.customer_details ?? {})) {
    const fields = {}
    for (const f of EXTRA_FIELDS) if (det?.[f]) fields[f] = det[f]
    if (Object.keys(fields).length) e[student] = fields
  }
  return e
}

function matchesQuery(student, payer, query) {
  const q = query.trim().toLowerCase()
  if (!q) return true
  return [student, payer].some(v => (v ?? '').toLowerCase().includes(q))
}

// A price entry only counts as custom when at least one price is filled in
// (inputs hold strings like "230"; saved entries hold numbers).
function hasAnyPricedValue(entry) {
  const filled = v => !isNaN(parseFloat(v))
  return Object.values(entry ?? {}).some(v => (v && typeof v === 'object') ? Object.values(v).some(filled) : filled(v))
}

export function CustomPricesPage({ settings, onSave, availableStudents = [], onDirtyChange = () => {} }) {
  const [customPrices, setCustomPrices] = useState(
    () => deepClone(settings?.custom_prices ?? {})
  )
  const [phones, setPhones] = useState(() => initialPhones(settings))
  const [extras, setExtras] = useState(() => initialExtras(settings))
  const [query, setQuery] = useState('')
  const [phoneErrors, setPhoneErrors] = useState({})
  const [profileErrors, setProfileErrors] = useState({})
  const [invoiceErrors, setInvoiceErrors] = useState({})
  const [newStudent, setNewStudent] = useState('')
  const [saved, setSaved] = useState(false)
  const [saveError, setSaveError] = useState(null)
  const [importOpen, setImportOpen] = useState(false)
  // Students removed this session, with what their card held: everything
  // saved under that spelling (phone included) is deleted on save, so removing
  // the wrong spelling of a student actually clears a name conflict. Until
  // then the card shows as a strip that Undo restores.
  const [removed, setRemoved] = useState({})

  // Snapshot of the raw, on-screen state as of the last successful save (or
  // initial load) — compared against the live state to report "dirty" to the
  // parent. Intentionally NOT the cleaned/parsed save payload: customPrices
  // holds a mix of numbers (from the initial settings clone) and raw input
  // strings (from edits), so comparing against a re-parsed payload would
  // always look dirty. Comparing state-to-itself over time avoids that.
  const lastSavedRef = useRef({
    customPrices: deepClone(settings?.custom_prices ?? {}),
    phones: initialPhones(settings),
    extras: initialExtras(settings),
  })

  useEffect(() => {
    const dirty = JSON.stringify(customPrices) !== JSON.stringify(lastSavedRef.current.customPrices)
      || JSON.stringify(phones) !== JSON.stringify(lastSavedRef.current.phones)
      || JSON.stringify(extras) !== JSON.stringify(lastSavedRef.current.extras)
    onDirtyChange(dirty)
  }, [customPrices, phones, extras, onDirtyChange])

  const handleAdd = () => {
    const name = newStudent.trim()
    if (!name || students.includes(name)) return
    // A card without prices: typing a price makes it a custom price, and the
    // other fields work either way.
    setExtras(prev => ({ ...prev, [name]: prev[name] ?? {} }))
    setRemoved(prev => without(prev, name))
    setPhones(prev => ({ ...prev, [name]: prev[name] ?? '' }))
    setNewStudent('')
    setSaved(false)
    setSaveError(null)
  }

  const handleRemove = (student) => {
    const snapshot = { customPrices: customPrices[student], phones: phones[student], extras: extras[student] }
    setCustomPrices(prev => without(prev, student))
    setPhones(prev => without(prev, student))
    setPhoneErrors(prev => without(prev, student))
    setProfileErrors(prev => without(prev, student))
    setInvoiceErrors(prev => without(prev, student))
    setExtras(prev => without(prev, student))
    setRemoved(prev => ({ ...prev, [student]: snapshot }))
    setSaved(false)
    setSaveError(null)
  }

  const handleUndoRemove = (student) => {
    const snapshot = removed[student]
    if (!snapshot) return
    const restore = (setter, value) => { if (value !== undefined) setter(prev => ({ ...prev, [student]: value })) }
    restore(setCustomPrices, snapshot.customPrices)
    restore(setPhones, snapshot.phones)
    restore(setExtras, snapshot.extras)
    setRemoved(prev => without(prev, student))
    setSaved(false)
    setSaveError(null)
  }

  const handlePrice = (student, type, duration, value) => {
    setCustomPrices(prev => ({
      ...prev,
      [student]: type
        ? { ...(prev[student] ?? EMPTY_TIERS), [type]: { ...(prev[student] ?? EMPTY_TIERS)[type], [duration]: value } }
        : { ...prev[student], [duration]: value },
    }))
    setSaved(false)
    setSaveError(null)
  }

  const handlePhone = (student, value) => {
    setPhones(prev => ({ ...prev, [student]: value }))
    setPhoneErrors(prev => ({ ...prev, [student]: false }))
    setSaved(false)
    setSaveError(null)
  }

  const handleExtra = (student, field, value) => {
    setExtras(prev => ({ ...prev, [student]: { ...prev[student], [field]: value } }))
    if (field === 'payment_profile') setProfileErrors(prev => ({ ...prev, [student]: false }))
    if (field === 'invoice_description') setInvoiceErrors(prev => ({ ...prev, [student]: false }))
    setSaved(false)
    setSaveError(null)
  }

  const handleImportResult = ({ entries, phones: importedPhones }) => {
    setCustomPrices(prev => ({ ...prev, ...entries }))
    if (Object.keys(importedPhones).length > 0) {
      setPhones(prev => ({ ...prev, ...importedPhones }))
    }
    setSaved(false)
    setSaveError(null)
  }

  const handleSave = async () => {
    const errors = {}
    for (const student of students) {
      const ph = (phones[student] ?? '').trim()
      if (ph && !validateIsraeliPhone(ph)) errors[student] = true
    }
    const badProfiles = {}
    for (const student of students) {
      const profile = (extras[student]?.payment_profile ?? '').trim()
      if (profile && !isValidPaymentProfile(profile)) badProfiles[student] = true
    }
    // The server checks the rendered text, so try every month and keep the longest.
    const badInvoices = {}
    for (const student of students) {
      const template = (extras[student]?.invoice_description ?? '').trim()
      // {student} in invoice text is the student's calendar name.
      const longest = template && Math.max(...ALL_MONTHS.map(m => buildGrowDescription(normalizeStudentName(student), m, template).length))
      if (template && longest > MAX_INVOICE_DESCRIPTION) badInvoices[student] = true
    }
    const invalid = [...new Set([...Object.keys(errors), ...Object.keys(badProfiles), ...Object.keys(badInvoices)])]
    if (invalid.length > 0) {
      setPhoneErrors(errors)
      setProfileErrors(badProfiles)
      setInvoiceErrors(badInvoices)
      // A card hidden by the search would otherwise fail without a visible reason.
      setQuery('')
      setSaved(false)
      setSaveError(`Not saved: fix the highlighted fields for ${invalid.join(', ')}.`)
      return
    }
    setProfileErrors({})
    setInvoiceErrors({})

    const cleaned = {}
    for (const [student, entry] of Object.entries(customPrices)) {
      if (!hasAnyPricedValue(entry)) continue
      if (typeof entry === 'object') {
        const hasRegularTiers = 'regular' in entry || 'non_regular' in entry
        if (hasRegularTiers) {
          cleaned[student] = {}
          for (const type of TYPES) {
            if (entry[type]) {
              cleaned[student][type] = {}
              for (const d of ['60', '45', '30']) {
                const v = parseFloat(entry[type][d])
                if (!isNaN(v)) cleaned[student][type][d] = v
              }
            }
          }
        } else {
          cleaned[student] = {}
          for (const d of ['60', '45', '30']) {
            const v = parseFloat(entry[d])
            if (!isNaN(v)) cleaned[student][d] = v
          }
        }
      }
    }

    const updatedCustomerDetails = { ...(settings?.customer_details ?? {}) }
    for (const student of Object.keys(removed)) {
      if (!students.includes(student)) delete updatedCustomerDetails[student]
    }
    for (const student of students) {
      const ph = (phones[student] ?? '').trim()
      if (ph) {
        updatedCustomerDetails[student] = {
          ...(updatedCustomerDetails[student] ?? {}),
          phone: ph,
        }
      }
      const current = { ...(updatedCustomerDetails[student] ?? {}) }
      // A cleared phone field removes the saved phone.
      if (!ph) delete current.phone
      for (const f of EXTRA_FIELDS) {
        const v = f === 'message' ? (extras[student]?.[f] ?? '') : (extras[student]?.[f] ?? '').trim()
        if (v.trim()) current[f] = v
        else delete current[f]
      }
      if (Object.keys(current).length) updatedCustomerDetails[student] = current
      else delete updatedCustomerDetails[student]
    }

    try {
      await onSave({ ...settings, custom_prices: cleaned, customer_details: updatedCustomerDetails })
      lastSavedRef.current = { customPrices: deepClone(customPrices), phones: deepClone(phones), extras: deepClone(extras) }
      setRemoved({})
      onDirtyChange(false)
      setSaved(true)
      setSaveError(null)
    } catch (err) {
      setSaved(false)
      setSaveError(
        err?.name === 'QuotaExceededError'
          ? "Couldn't save — storage is full."
          : "Couldn't save — please try again."
      )
    }
  }

  // Cards: every saved student, i.e. anyone with a custom price, a phone or a
  // per-student field.
  const students = [...new Set([...Object.keys(customPrices), ...Object.keys(phones), ...Object.keys(extras)])]
  const visibleStudents = students
    .filter(s => matchesQuery(s, extras[s]?.full_name, query))
  const removedStrips = Object.keys(removed).filter(s => !students.includes(s) && matchesQuery(s, removed[s].extras?.full_name, query))

  // Spellings the calculation merges into one row (same normalized name, see
  // resolveSavedStudent). A card with no price of its own edits the priced
  // spelling's, so typing a price there never adds a second, conflicting one.
  const pricedTwin = (student) => {
    if (hasAnyPricedValue(customPrices[student])) return null
    const name = normalizeStudentName(student)
    return students
      .filter(s => s !== student && normalizeStudentName(s) === name && hasAnyPricedValue(customPrices[s]))
      .sort((a, b) => (b === name) - (a === name) || a.localeCompare(b, 'he'))[0] ?? null
  }
  const knownProfiles = [...new Set([DEFAULT_PAYMENT_PROFILE, ...Object.values(extras).map(e => e?.payment_profile?.trim()).filter(Boolean)])]

  return (
    <div className={styles.page}>
      <h2 className={styles.heading}>Custom Prices</h2>
      <p className={styles.hint}>Every saved student: prices, phone, payer and payment options. Leave a field blank to use the default; Remove deletes everything saved under that name.</p>

      <div className={styles.addRow}>
        <input
          className={styles.input}
          placeholder="Student name"
          list="student-suggestions"
          value={newStudent}
          onChange={e => setNewStudent(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleAdd()}
        />
        <datalist id="student-suggestions">
          {availableStudents
            .filter(s => !students.includes(s))
            .map(s => <option key={s} value={s} />)}
        </datalist>
        <button className={styles.btnPrimary} onClick={handleAdd}>Add student</button>
        <button className={styles.btnSecondary} onClick={() => setImportOpen(v => !v)}>
          {importOpen ? 'Close import' : 'Import CSV'}
        </button>
      </div>

      {importOpen && (
        <ImportPricesPanel
          existingKeys={students}
          availableStudents={availableStudents}
          onImport={handleImportResult}
          onClose={() => setImportOpen(false)}
        />
      )}

      {students.length > 0 && (
        <input
          type="search"
          className={`${styles.input} ${styles.searchInput}`}
          placeholder="Search students…"
          value={query}
          onChange={e => setQuery(e.target.value)}
          dir="auto"
        />
      )}
      <datalist id="payment-profiles">
        {knownProfiles.map(p => <option key={p} value={p} />)}
      </datalist>

      {students.length === 0 && Object.keys(removed).length === 0 && (
        <div className={styles.empty}>No saved students yet. Add a student above.</div>
      )}
      {students.length > 0 && visibleStudents.length === 0 && removedStrips.length === 0 && (
        <div className={styles.empty}>No students match “{query.trim()}”.</div>
      )}

      {removedStrips.map(student => (
        <div key={student} className={styles.removedStrip} role="status">
          <span><span className={styles.removedName}>{student}</span> will be removed when you press Save all.</span>
          <button className={styles.btnSecondary} onClick={() => handleUndoRemove(student)}>Undo</button>
        </div>
      ))}

      {visibleStudents.map(student => {
        // Stable per name (not per list position) so a filtered list keeps label targets.
        const fieldId = field => `cp-${field}-${encodeURIComponent(student)}`
        const twin = pricedTwin(student)
        const priceOwner = twin ?? student
        // Students without a custom price get empty tiers (defaults apply).
        const entry = customPrices[priceOwner] ?? EMPTY_TIERS
        const isTiered = 'regular' in entry || 'non_regular' in entry
        const phoneVal = phones[student] ?? ''
        const phoneErr = phoneErrors[student]
        const extra = extras[student] ?? {}
        return (
          <div key={student} className={styles.card}>
            <div className={styles.cardHeader}>
              <span className={styles.studentName}>{student}</span>
              <button className={styles.removeBtn} onClick={() => handleRemove(student)}>Remove</button>
            </div>
            {twin && (
              <div className={styles.twinNote}>
                ↪ Same student as “{twin}”: prices typed here are saved there.
              </div>
            )}
            <div className={styles.phoneRow}>
              <label className={styles.phoneLabel} htmlFor={fieldId('phone')}>📱 Phone</label>
              <div className={styles.phoneInputWrap}>
                <input
                  id={fieldId('phone')}
                  aria-invalid={phoneErr ? true : undefined}
                  aria-describedby={phoneErr ? fieldId('phone-error') : undefined}
                  type="tel"
                  className={`${styles.input} ${styles.phoneInput} ${phoneErr ? styles.phoneInputError : ''}`}
                  placeholder="050-1234567"
                  value={phoneVal}
                  onChange={e => handlePhone(student, e.target.value)}
                  dir="ltr"
                />
                {phoneErr && <span id={fieldId('phone-error')} className={styles.phoneError}>Invalid format — e.g. 050-1234567</span>}
              </div>
            </div>
            <div className={styles.phoneRow}>
              <label className={styles.phoneLabel} htmlFor={fieldId('payer')}>👤 Payer name</label>
              <input
                id={fieldId('payer')}
                className={`${styles.input} ${styles.wideInput}`}
                placeholder="Who pays (a parent for young students), first and last name"
                title="Shown on the payment page and invoice, and greeted in WhatsApp. Leave empty when the student pays."
                value={extra.full_name ?? ''}
                onChange={e => handleExtra(student, 'full_name', e.target.value)}
                dir="auto"
              />
            </div>
            <div className={styles.phoneRow}>
              <label className={styles.phoneLabel} htmlFor={fieldId('profile')}>💳 Payment profile</label>
              <div className={styles.phoneInputWrap}>
                <input
                  id={fieldId('profile')}
                  aria-invalid={profileErrors[student] ? true : undefined}
                  aria-describedby={profileErrors[student] ? fieldId('profile-error') : undefined}
                  className={`${styles.input} ${styles.phoneInput} ${profileErrors[student] ? styles.phoneInputError : ''}`}
                  list="payment-profiles"
                  placeholder={DEFAULT_PAYMENT_PROFILE}
                  title="Sent to Make as payment_profile — the scenario's router picks which payment options this student gets"
                  value={extra.payment_profile ?? ''}
                  onChange={e => handleExtra(student, 'payment_profile', e.target.value)}
                  dir="auto"
                />
                {profileErrors[student] && <span id={fieldId('profile-error')} className={styles.phoneError}>One word: letters, digits, - or _ (e.g. extended)</span>}
              </div>
            </div>
            <div className={styles.phoneRow}>
              <label className={styles.phoneLabel} htmlFor={fieldId('invoice')}>🧾 Invoice text</label>
              <div className={`${styles.phoneInputWrap} ${styles.wideInput}`}>
                <input
                  id={fieldId('invoice')}
                  aria-invalid={invoiceErrors[student] ? true : undefined}
                  aria-describedby={invoiceErrors[student] ? fieldId('invoice-error') : undefined}
                  className={`${styles.input} ${invoiceErrors[student] ? styles.phoneInputError : ''}`}
                  placeholder="תשלום עבור שיעורי שירה - {student} - {month}"
                  title="Replaces the default payment/invoice description. {student} (the student) and {month} are filled in."
                  value={extra.invoice_description ?? ''}
                  onChange={e => handleExtra(student, 'invoice_description', e.target.value)}
                  dir="rtl"
                />
                {invoiceErrors[student] && <span id={fieldId('invoice-error')} className={styles.phoneError}>Too long: at most {MAX_INVOICE_DESCRIPTION} characters once the name and month are filled in</span>}
              </div>
            </div>
            <details className={styles.messageDetails}>
              <summary className={styles.phoneLabel}>💬 WhatsApp message {extra.message ? '(custom)' : '(default)'}</summary>
              <textarea
                className={`${styles.input} ${styles.messageInput}`}
                rows={4}
                dir="rtl"
                placeholder="Empty — uses the default message from Settings. Tokens: {payer} {amount} {month} {lessons} {link}"
                value={extra.message ?? ''}
                onChange={e => handleExtra(student, 'message', e.target.value)}
              />
            </details>
            {isTiered
              ? TYPES.map(type => (
                <div key={type} className={styles.tier}>
                  <span className={styles.tierLabel}>{TYPE_LABEL[type]}</span>
                  <div className={styles.priceRow}>
                    {Object.keys(DURATION_LABELS).map(d => (
                      <label key={d} className={styles.priceField}>
                        <span className={styles.durationLabel}>{DURATION_LABELS[d]}</span>
                        <input
                          type="number"
                          className={styles.input}
                          placeholder="—"
                          value={entry[type]?.[d] ?? ''}
                          onChange={e => handlePrice(priceOwner, type, d, e.target.value)}
                        />
                      </label>
                    ))}
                  </div>
                </div>
              ))
              : (
                <div className={styles.priceRow}>
                  {Object.keys(DURATION_LABELS).map(d => (
                    <label key={d} className={styles.priceField}>
                      <span className={styles.durationLabel}>{DURATION_LABELS[d]}</span>
                      <input
                        type="number"
                        className={styles.input}
                        placeholder="—"
                        value={entry[d] ?? ''}
                        onChange={e => handlePrice(priceOwner, null, d, e.target.value)}
                      />
                    </label>
                  ))}
                </div>
              )
            }
          </div>
        )
      })}

      {(students.length > 0 || Object.keys(removed).length > 0) && (
        <div className={styles.footer}>
          {saveError && <span className={styles.saveErrorMsg} role="alert">{saveError}</span>}
          {saved && !saveError && <span className={styles.savedMsg}>Saved!</span>}
          <button className={styles.btnPrimary} onClick={handleSave}>Save all</button>
        </div>
      )}
    </div>
  )
}

function without(obj, key) {
  const next = { ...obj }
  delete next[key]
  return next
}

function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj))
}
