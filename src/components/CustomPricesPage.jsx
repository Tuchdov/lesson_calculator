import { useState } from 'react'
import styles from './CustomPricesPage.module.css'

const DURATION_LABELS = { '60': '60 min', '45': '45 min', '30': '30 min' }
const TYPES = ['regular', 'non_regular']
const TYPE_LABEL = { regular: 'Regular', non_regular: 'Non-regular' }

export function CustomPricesPage({ settings, onSave, availableStudents = [] }) {
  const [customPrices, setCustomPrices] = useState(
    () => deepClone(settings?.custom_prices ?? {})
  )
  const [newStudent, setNewStudent] = useState('')
  const [saved, setSaved] = useState(false)

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
    setNewStudent('')
    setSaved(false)
  }

  const handleRemove = (student) => {
    setCustomPrices(prev => {
      const next = { ...prev }
      delete next[student]
      return next
    })
    setSaved(false)
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
  }

  const handleSave = async () => {
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
    await onSave({ ...settings, custom_prices: cleaned })
    setSaved(true)
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
      </div>

      {students.length === 0 && (
        <div className={styles.empty}>No custom prices set. Add a student above.</div>
      )}

      {students.map(student => {
        const entry = customPrices[student]
        const isTiered = 'regular' in entry || 'non_regular' in entry
        return (
          <div key={student} className={styles.card}>
            <div className={styles.cardHeader}>
              <span className={styles.studentName}>{student}</span>
              <button className={styles.removeBtn} onClick={() => handleRemove(student)}>Remove</button>
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
          {saved && <span className={styles.savedMsg}>Saved!</span>}
          <button className={styles.btnPrimary} onClick={handleSave}>Save all</button>
        </div>
      )}
    </div>
  )
}

function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj))
}
