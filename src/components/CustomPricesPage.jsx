import { useState, useEffect, useRef } from 'react'
import { validateIsraeliPhone } from '../lib/whatsapp.js'
import { DEFAULT_PAYMENT_PROFILE, isValidPaymentProfile } from '../lib/payments.js'
import { DURATION_LABELS, TYPES, TYPE_LABEL } from '../lib/priceConstants.js'
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
// default", so students without them behave exactly as before.
const EXTRA_FIELDS = ['payment_profile', 'invoice_description', 'message']

function initialExtras(settings) {
  const e = {}
  for (const [student, det] of Object.entries(settings?.customer_details ?? {})) {
    const fields = {}
    for (const f of EXTRA_FIELDS) if (det?.[f]) fields[f] = det[f]
    if (Object.keys(fields).length) e[student] = fields
  }
  return e
}

function matchesQuery(student, details, query) {
  const q = query.trim().toLowerCase()
  if (!q) return true
  return [student, details?.full_name].some(v => (v ?? '').toLowerCase().includes(q))
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
  const [newStudent, setNewStudent] = useState('')
  const [saved, setSaved] = useState(false)
  const [saveError, setSaveError] = useState(null)
  const [importOpen, setImportOpen] = useState(false)

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
    if (!name || customPrices[name]) return
    setCustomPrices(prev => ({
      ...prev,
      [name]: {
        regular: { '60': '', '45': '', '30': '' },
        non_regular: { '60': '', '45': '', '30': '' },
      },
    }))
    setPhones(prev => ({ ...prev, [name]: prev[name] ?? '' }))
    setNewStudent('')
    setSaved(false)
    setSaveError(null)
  }

  const handleRemove = (student) => {
    setCustomPrices(prev => {
      const next = { ...prev }
      delete next[student]
      return next
    })
    setPhones(prev => {
      const next = { ...prev }
      delete next[student]
      return next
    })
    setPhoneErrors(prev => {
      const next = { ...prev }
      delete next[student]
      return next
    })
    setExtras(prev => {
      const next = { ...prev }
      delete next[student]
      return next
    })
    setSaved(false)
    setSaveError(null)
  }

  const handlePrice = (student, type, duration, value) => {
    setCustomPrices(prev => ({
      ...prev,
      [student]: {
        ...prev[student],
        [type]: { ...prev[student]?.[type], [duration]: value },
      },
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
    if (Object.keys(errors).length > 0 || Object.keys(badProfiles).length > 0) {
      setPhoneErrors(errors)
      setProfileErrors(badProfiles)
      return
    }
    setProfileErrors({})

    const cleaned = {}
    for (const [student, entry] of Object.entries(customPrices)) {
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
    for (const student of students) {
      const ph = (phones[student] ?? '').trim()
      if (ph) {
        updatedCustomerDetails[student] = {
          ...(updatedCustomerDetails[student] ?? {}),
          phone: ph,
        }
      }
      const current = { ...(updatedCustomerDetails[student] ?? {}) }
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

  const students = Object.keys(customPrices)
  const visibleStudents = students
    .filter(s => matchesQuery(s, settings?.customer_details?.[s], query))
  const knownProfiles = [...new Set([DEFAULT_PAYMENT_PROFILE, ...Object.values(extras).map(e => e?.payment_profile?.trim()).filter(Boolean)])]

  return (
    <div className={styles.page}>
      <h2 className={styles.heading}>Custom Prices</h2>
      <p className={styles.hint}>Override per-student prices. Leave blank to use the default.</p>

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
            .filter(s => !customPrices[s])
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

      {students.length === 0 && (
        <div className={styles.empty}>No custom prices set. Add a student above.</div>
      )}
      {students.length > 0 && visibleStudents.length === 0 && (
        <div className={styles.empty}>No students match “{query.trim()}”.</div>
      )}

      {visibleStudents.map(student => {
        const entry = customPrices[student]
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
            <div className={styles.phoneRow}>
              <span className={styles.phoneLabel}>📱 Phone</span>
              <div className={styles.phoneInputWrap}>
                <input
                  type="tel"
                  className={`${styles.input} ${styles.phoneInput} ${phoneErr ? styles.phoneInputError : ''}`}
                  placeholder="050-1234567"
                  value={phoneVal}
                  onChange={e => handlePhone(student, e.target.value)}
                  dir="ltr"
                />
                {phoneErr && <span className={styles.phoneError}>Invalid format — e.g. 050-1234567</span>}
              </div>
            </div>
            <div className={styles.phoneRow}>
              <span className={styles.phoneLabel}>💳 Payment profile</span>
              <div className={styles.phoneInputWrap}>
                <input
                  className={`${styles.input} ${styles.phoneInput} ${profileErrors[student] ? styles.phoneInputError : ''}`}
                  list="payment-profiles"
                  placeholder={DEFAULT_PAYMENT_PROFILE}
                  title="Sent to Make as payment_profile — the scenario's router picks which payment options this student gets"
                  value={extra.payment_profile ?? ''}
                  onChange={e => handleExtra(student, 'payment_profile', e.target.value)}
                  dir="auto"
                />
                {profileErrors[student] && <span className={styles.phoneError}>One word: letters, digits, - or _ (e.g. extended)</span>}
              </div>
            </div>
            <div className={styles.phoneRow}>
              <span className={styles.phoneLabel}>🧾 Invoice text</span>
              <input
                className={`${styles.input} ${styles.wideInput}`}
                placeholder="תשלום עבור שיעורי שירה - {student} - {month}"
                title="Replaces the default payment/invoice description. {student} and {month} are filled in."
                value={extra.invoice_description ?? ''}
                onChange={e => handleExtra(student, 'invoice_description', e.target.value)}
                dir="rtl"
              />
            </div>
            <details className={styles.messageDetails}>
              <summary className={styles.phoneLabel}>💬 WhatsApp message {extra.message ? '(custom)' : '(default)'}</summary>
              <textarea
                className={`${styles.input} ${styles.messageInput}`}
                rows={4}
                dir="rtl"
                placeholder="Empty — uses the default message from Settings. Tokens: {student} {amount} {month} {lessons} {link}"
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
                          onChange={e => handlePrice(student, type, d, e.target.value)}
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
                        onChange={e => handlePrice(student, null, d, e.target.value)}
                      />
                    </label>
                  ))}
                </div>
              )
            }
          </div>
        )
      })}

      {students.length > 0 && (
        <div className={styles.footer}>
          {saveError && <span className={styles.saveErrorMsg} role="alert">{saveError}</span>}
          {saved && !saveError && <span className={styles.savedMsg}>Saved!</span>}
          <button className={styles.btnPrimary} onClick={handleSave}>Save all</button>
        </div>
      )}
    </div>
  )
}

function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj))
}
