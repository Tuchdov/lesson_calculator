import { useState, useEffect } from 'react'
import { validateIsraeliPhone, buildPaymentMessage, buildWhatsAppUrl } from '../lib/whatsapp.js'
import { invoiceKey, hasFullName, getStoredLink, amountChanged, isValidAmount } from '../lib/payments.js'
import { requestPaymentLink } from '../lib/paymentLinkClient.js'
import { resolveRowPrices, computeLessonAmount } from '../lib/rowPricing.js'
import styles from './EditableTable.module.css'

const DURATION_COLS = ['60', '45', '30']
const TYPE_LABEL = { regular: 'Regular', non_regular: 'Non-regular' }
const TYPE_CHIP = { regular: styles.chipGreen, non_regular: styles.chipAmber }

export function EditableTable({ rows, config, customPrices, onCustomPriceChange, customerDetails, onCustomerDetailChange, month, defaultMessage, amountOverrides, onAmountOverrideChange, paymentLinks, onPaymentLinkChange, getAccessToken, prepareStatus }) {
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
                  fullName={customerDetails?.[row.student]?.full_name}
                  onCustomerDetailChange={onCustomerDetailChange}
                  month={month}
                  defaultMessage={defaultMessage}
                  expandedRow={expandedRow}
                  setExpandedRow={setExpandedRow}
                  amountOverride={amountOverrides?.[invoiceKey(month, row.student)] ?? null}
                  onAmountOverrideChange={onAmountOverrideChange}
                  linkEntry={getStoredLink(paymentLinks, month, row.student)}
                  onPaymentLinkChange={onPaymentLinkChange}
                  getAccessToken={getAccessToken}
                  batchState={prepareStatus?.[row.student]}
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

function StudentRow({ row, config, customPrices, onCustomPriceChange, phone, fullName, onCustomerDetailChange, month, defaultMessage, expandedRow, setExpandedRow, amountOverride, onAmountOverrideChange, linkEntry, onPaymentLinkChange, getAccessToken, batchState }) {
  const custom = customPrices?.[row.student]
  const prices = resolveRowPrices(row.student, row.student_type === 'regular', config, custom)

  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(custom ? { ...custom } : null)
  const [phoneInput, setPhoneInput] = useState('')
  const [phoneError, setPhoneError] = useState(false)
  const [nameInput, setNameInput] = useState('')
  const [nameError, setNameError] = useState(false)
  const [editingAmount, setEditingAmount] = useState(false)
  const [amountDraft, setAmountDraft] = useState('')
  const [amountSaveError, setAmountSaveError] = useState(null)
  const [localBusy, setLocalBusy] = useState(false)
  const [localError, setLocalError] = useState(null)

  useEffect(() => {
    setDraft(custom ? { ...custom } : null)
    setEditing(false)
  }, [custom])

  const computedAmount = computeLessonAmount(row, prices)
  const roundedAmount = amountOverride ?? computedAmount
  const totalLessons = row.lessons_60 + row.lessons_45 + row.lessons_30

  const effectiveName = fullName || row.student
  const nameOk = hasFullName(effectiveName)
  const needsDetails = !phone || !nameOk
  const linkUsable = !!linkEntry && !amountChanged(linkEntry.amount, roundedAmount)
  const busy = localBusy || batchState === 'loading'
  const errorMessage = localError || (batchState === 'error' ? 'Failed to create the link. Try again.' : null)

  const handleStartAmountEdit = () => {
    setAmountDraft(String(roundedAmount))
    setEditingAmount(true)
  }

  const handleSaveAmount = async () => {
    const v = parseFloat(amountDraft)
    if (isNaN(v)) {
      setEditingAmount(false)
      return
    }
    try {
      await onAmountOverrideChange?.(month, row.student, Math.round(v * 100) / 100)
      setEditingAmount(false)
      setAmountSaveError(null)
    } catch (err) {
      // Keep the edit row open so the value isn't lost and the teacher can retry.
      setAmountSaveError(err.message ?? 'Failed to save. Try again.')
    }
  }

  const handleResetAmount = async () => {
    try {
      await onAmountOverrideChange?.(month, row.student, null)
      setEditingAmount(false)
      setAmountSaveError(null)
    } catch (err) {
      setAmountSaveError(err.message ?? 'Failed to save. Try again.')
    }
  }

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
      setNameInput('')
      setNameError(false)
    } else {
      setExpandedRow(row.student)
      setPhoneInput('')
      setPhoneError(false)
      setNameInput(fullName || (hasFullName(row.student) ? '' : row.student))
      setNameError(false)
    }
  }

  const handleSaveDetails = async () => {
    if (!phone) {
      if (!validateIsraeliPhone(phoneInput)) {
        setPhoneError(true)
        return
      }
    }
    let nextFullName
    if (!nameOk) {
      const trimmed = nameInput.trim()
      if (!hasFullName(trimmed)) {
        setNameError(true)
        return
      }
      nextFullName = trimmed
    }
    const updates = {}
    if (!phone) updates.phone = phoneInput
    if (nextFullName) updates.full_name = nextFullName
    await onCustomerDetailChange?.(row.student, updates)
    setExpandedRow(null)
  }

  const mintLink = async () => {
    if (!isValidAmount(roundedAmount)) {
      setLocalError('Invalid amount.')
      return
    }
    setLocalBusy(true)
    setLocalError(null)
    try {
      const link = await requestPaymentLink(getAccessToken, {
        studentName: effectiveName,
        phone,
        amount: roundedAmount,
        month,
      })
      await onPaymentLinkChange?.(month, row.student, link, roundedAmount)
    } catch (err) {
      setLocalError(err.message ?? 'Failed to create the link. Try again.')
    } finally {
      setLocalBusy(false)
    }
  }

  const handleSendClick = async () => {
    if (busy) return
    if (linkUsable) {
      const msg = buildPaymentMessage(effectiveName, roundedAmount, month, defaultMessage || undefined, totalLessons, linkEntry.link)
      window.open(buildWhatsAppUrl(phone, msg), '_blank', 'noopener')
      return
    }
    await mintLink()
  }

  const handleRegenerate = async (e) => {
    e.stopPropagation()
    if (busy) return
    await mintLink()
  }

  return (
    <>
      <tr className={styles.row}>
        <td>
          <span className={styles.studentCell}>
            {row.student}
            {custom && <span className={styles.customBadge}>custom</span>}
          </span>
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
                      autoFocus
                    />
                  : <span
                      className={styles.priceEditable}
                      title="Double-click to change this student's ₪/lesson rate"
                      onDoubleClick={() => {
                        if (editingAmount) return
                        setDraft({ '60': prices['60'], '45': prices['45'], '30': prices['30'] })
                        setEditing(true)
                      }}
                    >
                      ₪{prices[d]}
                    </span>
                }
              </span>
            )}
          </td>
        ))}
        <td className={`${styles.center} ${styles.amount}`}>
          {editingAmount ? (
            <div className={styles.amountEditRow}>
              <input
                className={styles.amountInput}
                value={amountDraft}
                onChange={e => setAmountDraft(e.target.value)}
                autoFocus
              />
              <button className={styles.miniSave} onClick={handleSaveAmount} title="Save">✓</button>
              <button className={styles.miniCancel} onClick={() => { setEditingAmount(false); setAmountSaveError(null) }} title="Cancel">✕</button>
              {amountOverride != null && (
                <button className={styles.miniReset} onClick={handleResetAmount} title="Reset to calculated amount">↺</button>
              )}
              {amountSaveError && <span className={styles.phoneErrorMsg}>{amountSaveError}</span>}
            </div>
          ) : editing ? (
            <div className={styles.amountEditRow}>
              <span className={styles.amountValue}>₪{roundedAmount}</span>
              <button className={styles.miniSave} onClick={handleSave} title="Save price">✓</button>
              <button className={styles.miniCancel} onClick={() => setEditing(false)} title="Cancel">✕</button>
            </div>
          ) : (
            <span
              className={styles.amountEditable}
              title="Double-click to set a one-off amount due for this invoice"
              onDoubleClick={() => {
                if (editing) return
                handleStartAmountEdit()
              }}
            >
              ₪{roundedAmount}
              {amountOverride != null && (
                <span className={styles.adjustedBadge} title="Manually adjusted — double-click to change or reset">adjusted</span>
              )}
            </span>
          )}
        </td>
        <td className={styles.waCell}>
          {needsDetails ? (
            <button className={`${styles.waChipMissing} ${isExpanded ? styles.waChipActive : ''}`} onClick={handleToggleExpand}>
              {!phone ? '📱 הוסף טלפון' : '⚠️ השלם שם מלא'}
            </button>
          ) : errorMessage ? (
            <button className={styles.waChipError} onClick={handleSendClick} title={errorMessage} disabled={busy}>
              {busy ? '…' : '⚠️ נסה שוב'}
            </button>
          ) : linkUsable ? (
            <span className={styles.waReadyGroup}>
              <button className={styles.waChipReady} onClick={handleSendClick} disabled={busy}>📱 שלח</button>
              <button className={styles.regenBtn} onClick={handleRegenerate} disabled={busy} title="Create a new link">↻</button>
            </span>
          ) : (
            <button className={styles.waChipPrepare} onClick={handleSendClick} disabled={busy} title="Creates the payment link — click again to send once it's ready">
              {busy ? '…' : '🔗 הכן קישור'}
            </button>
          )}
        </td>
      </tr>
      {isExpanded && (
        <tr className={styles.expandRow}>
          <td colSpan={7} className={styles.expandCell}>
            <div className={styles.expandInner}>
              <span className={styles.expandLabel}>📱 {row.student}:</span>
              {!phone && (
                <div className={styles.expandInputWrap}>
                  <input
                    type="tel"
                    className={`${styles.phoneInput} ${phoneError ? styles.phoneInputError : ''}`}
                    placeholder="050-1234567"
                    value={phoneInput}
                    onChange={e => { setPhoneInput(e.target.value); setPhoneError(false) }}
                    onKeyDown={e => e.key === 'Enter' && handleSaveDetails()}
                    autoFocus
                    dir="ltr"
                  />
                  {phoneError && <div className={styles.phoneErrorMsg}>פורמט שגוי — דוגמה: 050-1234567</div>}
                </div>
              )}
              {!nameOk && (
                <div className={styles.expandInputWrap}>
                  <input
                    type="text"
                    className={`${styles.phoneInput} ${nameError ? styles.phoneInputError : ''}`}
                    placeholder="שם פרטי ושם משפחה"
                    value={nameInput}
                    onChange={e => { setNameInput(e.target.value); setNameError(false) }}
                    onKeyDown={e => e.key === 'Enter' && handleSaveDetails()}
                    dir="rtl"
                  />
                  {nameError && <div className={styles.phoneErrorMsg}>נדרש שם פרטי ושם משפחה</div>}
                </div>
              )}
              <button className={styles.btnSavePhone} onClick={handleSaveDetails}>שמור</button>
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

