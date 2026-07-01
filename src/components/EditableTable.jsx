import { useState, useEffect } from 'react'
import { validateIsraeliPhone, buildPaymentMessage, buildWhatsAppUrl } from '../lib/whatsapp.js'
import styles from './EditableTable.module.css'

const DURATION_COLS = ['60', '45', '30']
const TYPE_LABEL = { regular: 'Regular', non_regular: 'Non-regular' }
const TYPE_CHIP = { regular: styles.chipGreen, non_regular: styles.chipAmber }

export function EditableTable({ rows, config, customPrices, onCustomPriceChange, customerDetails, onCustomerDetailChange, month }) {
  const grouped = groupByType(rows)
  const [expandedRow, setExpandedRow] = useState(null)

  return (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>Student</th>
            <th>Type</th>
            <th className={styles.center}>60 min</th>
            <th className={styles.center}>45 min</th>
            <th className={styles.center}>30 min</th>
            <th className={styles.center}>Amount Due (₪)</th>
            <th className={styles.center}>WhatsApp</th>
          </tr>
        </thead>
        <tbody>
          {['regular', 'non_regular'].map(type => {
            const typeRows = grouped[type]
            if (!typeRows?.length) return null
            return [
              <GroupHeader key={`h-${type}`} type={type} />,
              ...typeRows.map(row => (
                <StudentRow
                  key={row.student}
                  row={row}
                  config={config}
                  customPrices={customPrices}
                  onCustomPriceChange={onCustomPriceChange}
                  phone={customerDetails?.[row.student]?.phone}
                  onCustomerDetailChange={onCustomerDetailChange}
                  month={month}
                  expandedRow={expandedRow}
                  setExpandedRow={setExpandedRow}
                />
              )),
            ]
          })}
        </tbody>
      </table>
    </div>
  )
}

function GroupHeader({ type }) {
  return (
    <tr className={`${styles.groupRow} ${type === 'regular' ? styles.groupRegular : styles.groupNonRegular}`}>
      <td colSpan={7}>
        <span className={`${styles.chip} ${TYPE_CHIP[type]}`}>{TYPE_LABEL[type]}</span>
      </td>
    </tr>
  )
}

function StudentRow({ row, config, customPrices, onCustomPriceChange, phone, onCustomerDetailChange, month, expandedRow, setExpandedRow }) {
  const custom = customPrices?.[row.student]
  const prices = resolveRowPrices(row.student, row.student_type === 'regular', config, custom)

  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(custom ? { ...custom } : null)
  const [phoneInput, setPhoneInput] = useState('')
  const [phoneError, setPhoneError] = useState(false)

  useEffect(() => {
    setDraft(custom ? { ...custom } : null)
    setEditing(false)
  }, [custom])

  const amount = row.lessons_60 * Number(prices['60'])
    + row.lessons_45 * Number(prices['45'])
    + row.lessons_30 * Number(prices['30'])
  const roundedAmount = Math.round(amount * 100) / 100

  const handleSave = () => {
    const parsed = {}
    for (const d of DURATION_COLS) {
      const v = parseFloat(draft?.[d])
      parsed[d] = isNaN(v) ? prices[d] : v
    }
    let update
    if (custom && ('regular' in custom || 'non_regular' in custom)) {
      update = { ...custom, [row.student_type]: parsed }
    } else {
      update = { regular: parsed, non_regular: parsed }
    }
    onCustomPriceChange?.(row.student, update)
    setEditing(false)
  }

  const isExpanded = expandedRow === row.student

  const handleToggleExpand = () => {
    if (isExpanded) {
      setExpandedRow(null)
      setPhoneInput('')
      setPhoneError(false)
    } else {
      setExpandedRow(row.student)
      setPhoneInput('')
      setPhoneError(false)
    }
  }

  const handleSaveAndSend = () => {
    if (!validateIsraeliPhone(phoneInput)) {
      setPhoneError(true)
      return
    }
    onCustomerDetailChange?.(row.student, { phone: phoneInput })
    setExpandedRow(null)
    const msg = buildPaymentMessage(row.student, roundedAmount, month)
    window.open(buildWhatsAppUrl(phoneInput, msg), '_blank', 'noopener')
  }

  const handleSendDirect = () => {
    const msg = buildPaymentMessage(row.student, roundedAmount, month)
    window.open(buildWhatsAppUrl(phone, msg), '_blank', 'noopener')
  }

  return (
    <>
      <tr className={styles.row}>
        <td className={styles.studentCell}>
          {row.student}
          {custom && <span className={styles.customBadge}>custom</span>}
        </td>
        <td>
          <span className={`${styles.chip} ${TYPE_CHIP[row.student_type]}`}>
            {TYPE_LABEL[row.student_type]}
          </span>
        </td>
        {DURATION_COLS.map(d => (
          <td key={d} className={styles.center}>
            {row[`lessons_${d}`] > 0 && (
              <span>
                {row[`lessons_${d}`]} × {editing
                  ? <input
                      className={styles.priceInput}
                      value={draft?.[d] ?? prices[d]}
                      onChange={e => setDraft(prev => ({ ...prev, [d]: e.target.value }))}
                    />
                  : <span className={styles.price}>₪{prices[d]}</span>
                }
              </span>
            )}
          </td>
        ))}
        <td className={`${styles.center} ${styles.amount}`}>
          ₪{roundedAmount}
          {!editing
            ? <button className={styles.editBtn} onClick={() => {
                setDraft({ '60': prices['60'], '45': prices['45'], '30': prices['30'] })
                setEditing(true)
              }}>edit</button>
            : <>
                <button className={styles.saveBtn} onClick={handleSave}>save</button>
                <button className={styles.cancelBtn} onClick={() => setEditing(false)}>✕</button>
              </>
          }
        </td>
        <td className={styles.waCell}>
          {phone
            ? <button className={styles.waChipReady} onClick={handleSendDirect}>📱 שלח</button>
            : <button className={`${styles.waChipMissing} ${isExpanded ? styles.waChipActive : ''}`} onClick={handleToggleExpand}>📱 הוסף טלפון</button>
          }
        </td>
      </tr>
      {isExpanded && (
        <tr className={styles.expandRow}>
          <td colSpan={7} className={styles.expandCell}>
            <div className={styles.expandInner}>
              <span className={styles.expandLabel}>📱 {row.student}:</span>
              <div className={styles.expandInputWrap}>
                <input
                  type="tel"
                  className={`${styles.phoneInput} ${phoneError ? styles.phoneInputError : ''}`}
                  placeholder="050-1234567"
                  value={phoneInput}
                  onChange={e => { setPhoneInput(e.target.value); setPhoneError(false) }}
                  onKeyDown={e => e.key === 'Enter' && handleSaveAndSend()}
                  autoFocus
                  dir="ltr"
                />
                {phoneError && <div className={styles.phoneErrorMsg}>פורמט שגוי — דוגמה: 050-1234567</div>}
              </div>
              <button className={styles.btnSavePhone} onClick={handleSaveAndSend}>שמור ושלח</button>
              <button className={styles.btnCancelPhone} onClick={handleToggleExpand}>ביטול</button>
            </div>
          </td>
        </tr>
      )}
    </>
  )
}

function groupByType(rows = []) {
  const g = { regular: [], non_regular: [] }
  for (const r of rows) g[r.student_type]?.push(r)
  return g
}

function resolveRowPrices(student, regular, config, custom) {
  const defaults = regular ? config?.prices?.regular : config?.prices?.non_regular
  if (custom) {
    if ('regular' in custom || 'non_regular' in custom) {
      const key = regular ? 'regular' : 'non_regular'
      const tier = custom[key] ?? custom[regular ? 'non_regular' : 'regular']
      if (tier && typeof tier === 'object') return fillMissing(tier, defaults)
    }
    if ('60' in custom) return custom
  }
  return defaults
}

function fillMissing(prices, defaults = {}) {
  return {
    '60': prices['60'] ?? defaults['60'],
    '45': prices['45'] ?? defaults['45'],
    '30': prices['30'] ?? defaults['30'],
  }
}
