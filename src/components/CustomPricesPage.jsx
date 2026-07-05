import { useState, useEffect, useRef } from 'react'
import { validateIsraeliPhone } from '../lib/whatsapp.js'
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

export function CustomPricesPage({ settings, onSave, availableStudents = [], onDirtyChange = () => {} }) {
  const [customPrices, setCustomPrices] = useState(
    () => deepClone(settings?.custom_prices ?? {})
  )
  const [phones, setPhones] = useState(() => initialPhones(settings))
  const [phoneErrors, setPhoneErrors] = useState({})
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
  })

  useEffect(() => {
    const dirty = JSON.stringify(customPrices) !== JSON.stringify(lastSavedRef.current.customPrices)
      || JSON.stringify(phones) !== JSON.stringify(lastSavedRef.current.phones)
    onDirtyChange(dirty)
  }, [customPrices, phones, onDirtyChange])

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
    if (Object.keys(errors).length > 0) {
      setPhoneErrors(errors)
      return
    }

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
    }

    try {
      await onSave({ ...settings, custom_prices: cleaned, customer_details: updatedCustomerDetails })
      lastSavedRef.current = { customPrices: deepClone(customPrices), phones: deepClone(phones) }
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

      {students.length === 0 && (
        <div className={styles.empty}>No custom prices set. Add a student above.</div>
      )}

      {students.map(student => {
        const entry = customPrices[student]
        const isTiered = 'regular' in entry || 'non_regular' in entry
        const phoneVal = phones[student] ?? ''
        const phoneErr = phoneErrors[student]
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
