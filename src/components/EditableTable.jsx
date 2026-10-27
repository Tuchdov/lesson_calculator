import { useState } from 'react'
import { validateIsraeliPhone, buildPaymentMessage, buildWhatsAppUrl } from '../lib/whatsapp.js'
import { hasFullName, invoiceRecord, invoiceRecordName, amountChanged, isValidAmount } from '../lib/payments.js'
import { requestPaymentLink } from '../lib/paymentLinkClient.js'
import { resolveRowPrices, computeRowAmount, detailsFor, totalLessons, reviewKey, reviewResolution, storedReviewResolution, storedReviewName, reviewItemAmount, baseLessonPrice, proRataPrice, defaultReviewMode } from '../lib/rowPricing.js'
import styles from './EditableTable.module.css'

const DURATION_COLS = ['60', '45', '30']
const TYPE_LABEL = { regular: 'Regular', non_regular: 'Non-regular' }
const TYPE_CHIP = { regular: styles.chipGreen, non_regular: styles.chipAmber }

export function EditableTable({ rows, config, customPrices, onCustomPriceChange, customerDetails, onCustomerDetailChange, month, defaultMessage, amountOverrides, onAmountOverrideChange, paymentLinks, onPaymentLinkChange, getAccessToken, prepareStatus, reviewResolutions, onReviewResolutionChange }) {
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
                  details={detailsFor(customerDetails, row)}
                  onCustomerDetailChange={onCustomerDetailChange}
                  month={month}
                  defaultMessage={defaultMessage}
                  expandedRow={expandedRow}
                  setExpandedRow={setExpandedRow}
                  amountOverride={invoiceRecord(amountOverrides, month, row)}
                  amountOverrideName={invoiceRecordName(amountOverrides, month, row)}
                  onAmountOverrideChange={onAmountOverrideChange}
                  linkEntry={invoiceRecord(paymentLinks, month, row)}
                  onPaymentLinkChange={onPaymentLinkChange}
                  getAccessToken={getAccessToken}
                  batchState={prepareStatus?.[row.student]}
                  reviewResolutions={reviewResolutions}
                  onReviewResolutionChange={onReviewResolutionChange}
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

/**
 * Render one student's invoice row, including price edits, contact details,
 * payment-link preparation, review items, and WhatsApp actions.
 * @param {object} props Student data, pricing, payment state, and callbacks.
 * @returns {import('react').ReactNode} The invoice row and optional details rows.
 */
function StudentRow({ row, config, customPrices, onCustomPriceChange, details, onCustomerDetailChange, month, defaultMessage, expandedRow, setExpandedRow, amountOverride, amountOverrideName, onAmountOverrideChange, linkEntry, onPaymentLinkChange, getAccessToken, batchState, reviewResolutions, onReviewResolutionChange }) {
  const { phone, full_name: fullName } = details
  const custom = customPrices?.[row.student]
  const prices = resolveRowPrices(row.student, row.student_type === 'regular', config, custom)

  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(custom ? { ...custom } : null)
  const [previousCustom, setPreviousCustom] = useState(custom)
  const [phoneInput, setPhoneInput] = useState('')
  const [phoneError, setPhoneError] = useState(false)
  const [nameInput, setNameInput] = useState('')
  const [nameError, setNameError] = useState(false)
  const [editingAmount, setEditingAmount] = useState(false)
  const [amountDraft, setAmountDraft] = useState('')
  const [amountSaveError, setAmountSaveError] = useState(null)
  const [localBusy, setLocalBusy] = useState(false)
  const [localError, setLocalError] = useState(null)

  if (previousCustom !== custom) {
    setPreviousCustom(custom)
    setDraft(custom ? { ...custom } : null)
    setEditing(false)
  }

  const { amount: computedAmount, extra: reviewExtra, unresolved: reviewUnresolved } = computeRowAmount(row, prices, reviewResolutions, month)
  const roundedAmount = amountOverride ?? computedAmount
  const lessonCount = totalLessons(row)
  // An amount override is the teacher's final number, so it settles review.
  const needsReview = amountOverride == null && reviewUnresolved > 0
  const hasReviewItems = row.review_items?.length > 0

  const effectiveName = fullName || row.student
  const nameOk = hasFullName(effectiveName)
  const needsDetails = !phone || !nameOk
  const linkUsable = !!linkEntry && !amountChanged(linkEntry.amount, roundedAmount)
  const busy = localBusy || batchState === 'loading'
  const errorMessage = localError || batchState?.error || null
  // Saved spellings that contradict each other are probably two students.
  const nameConflict = row.name_conflicts?.length > 0

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
      // An adjustment found under an older spelling is cleared there too.
      if (amountOverrideName && amountOverrideName !== row.student) {
        await onAmountOverrideChange?.(month, amountOverrideName, null)
      }
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
  const reviewOpen = expandedRow === `review:${row.student}`
  const toggleReview = () => setExpandedRow(reviewOpen ? null : `review:${row.student}`)

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
        numberOfLessons: lessonCount,
        paymentProfile: details.payment_profile,
        invoiceDescription: details.invoice_description,
      })
      await onPaymentLinkChange?.(month, row.student, link, roundedAmount)
    } catch (err) {
      setLocalError(err.message ?? 'Failed to create the link. Try again.')
    } finally {
      setLocalBusy(false)
    }
  }

  const handleSendClick = async () => {
    if (busy || needsReview || nameConflict) return
    if (linkUsable) {
      const template = details.message || defaultMessage || undefined
      const msg = buildPaymentMessage(effectiveName, roundedAmount, month, template, lessonCount, linkEntry.link)
      window.open(buildWhatsAppUrl(phone, msg), '_blank', 'noopener')
      return
    }
    await mintLink()
  }

  const handleRegenerate = async (e) => {
    e.stopPropagation()
    if (busy || needsReview || nameConflict) return
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
          {nameConflict && (
            <span className={styles.reviewChip} title={`Different ${row.name_conflicts.join(', ')} saved under: ${[row.student, ...(row.aliases ?? [])].join(' / ')}`}>
              ⚠️ two students? different {row.name_conflicts.join(' / ')}
            </span>
          )}
          {hasReviewItems && (
            needsReview ? (
              <button className={styles.reviewChip} onClick={toggleReview} title="Lessons with a non-standard duration — choose how to charge them">
                ⚠️ {reviewUnresolved} not counted
              </button>
            ) : (
              <button className={styles.reviewChipDone} onClick={toggleReview} title="Review how non-standard lessons are charged">
                +₪{reviewExtra} extra
              </button>
            )
          )}
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
          {nameConflict ? (
            <span className={styles.waChipMissing} title={`Saved as: ${[row.student, ...(row.aliases ?? [])].join(' / ')}. Give each student a distinct name on Custom Prices, then Calculate again.`}>
              ⚠️ שני תלמידים?
            </span>
          ) : needsReview ? (
            <button className={`${styles.waChipMissing} ${reviewOpen ? styles.waChipActive : ''}`} onClick={toggleReview}>
              ⚠️ דרושה בדיקה
            </button>
          ) : needsDetails ? (
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
      {reviewOpen && (
        <tr className={styles.expandRow}>
          <td colSpan={7} className={styles.expandCell}>
            <div className={styles.reviewList}>
              {row.review_items.map(item => (
                <ReviewItem
                  key={item.id}
                  item={item}
                  prices={prices}
                  resolution={reviewResolution(item, reviewResolutions, month, row)}
                  stored={storedReviewResolution(item, reviewResolutions, month, row)}
                  onSave={async resolution => {
                    await onReviewResolutionChange?.(reviewKey(month, row.student, item.id), resolution)
                    // An answer found under an older spelling is cleared there too.
                    const storedName = storedReviewName(item, reviewResolutions, month, row)
                    if (resolution == null && storedName && storedName !== row.student) {
                      await onReviewResolutionChange?.(reviewKey(month, storedName, item.id), null)
                    }
                  }}
                />
              ))}
              {amountOverride != null && (
                <div className={styles.reviewHint}>The amount is manually adjusted, so these choices don't change it.</div>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  )
}

const REVIEW_MODE_LABEL = { prorata: 'Pro-rata', base: 'Standard lesson only', fixed: 'Fixed amount', free: "Don't charge" }

function ReviewItem({ item, prices, resolution, stored, onSave }) {
  const [mode, setMode] = useState(() => resolution?.mode ?? defaultReviewMode(item, prices))
  const [fixedAmount, setFixedAmount] = useState(() => (resolution?.mode === 'fixed' ? String(resolution.amount) : ''))
  const [error, setError] = useState(null)

  const base = baseLessonPrice(item.minutes ?? 0, prices)
  const optionAmount = {
    prorata: proRataPrice(item.minutes, prices),
    base,
    free: 0,
  }
  const date = new Date(item.start).toLocaleDateString('he-IL', { day: 'numeric', month: 'numeric' })

  const persist = async (next) => {
    try {
      await onSave(next)
      setError(null)
    } catch (err) {
      setError(err.message ?? 'Failed to save. Try again.')
    }
  }

  const handleSave = async () => {
    let next = { mode }
    if (mode === 'fixed') {
      const v = parseFloat(fixedAmount)
      if (isNaN(v) || v < 0) {
        setError('Enter an amount')
        return
      }
      next = { mode, amount: Math.round(v * 100) / 100 }
    }
    await persist(next)
  }

  return (
    <div className={styles.reviewItem}>
      <div className={styles.reviewTitle}>
        <span dir="rtl">{item.summary}</span>
        <span className={styles.reviewMeta}>{date} · {item.minutes ?? '?'} min</span>
        {resolution && (
          <span className={styles.reviewMeta}>
            → ₪{reviewItemAmount(item, resolution, prices)} ({REVIEW_MODE_LABEL[resolution.mode]}{!stored ? ', make-up phrase' : ''})
          </span>
        )}
      </div>
      <div className={styles.reviewOptions}>
        {['prorata', 'base', 'fixed', 'free'].filter(m => m !== 'base' || base > 0).map(m => (
          <label key={m} className={styles.reviewOption}>
            <input type="radio" name={`review-${item.id}`} checked={mode === m} onChange={() => { setMode(m); setError(null) }} />
            {REVIEW_MODE_LABEL[m]}
            {m === 'fixed'
              ? (
                <input
                  className={styles.amountInput}
                  value={fixedAmount}
                  placeholder="₪"
                  onFocus={() => setMode('fixed')}
                  onChange={e => { setFixedAmount(e.target.value); setError(null) }}
                />
              )
              : <span className={styles.reviewMeta}>₪{optionAmount[m]}</span>}
          </label>
        ))}
        <button className={styles.btnSavePhone} onClick={handleSave}>שמור</button>
        {stored && <button className={styles.btnCancelPhone} onClick={() => persist(null)}>נקה</button>}
        {error && <span className={styles.phoneErrorMsg}>{error}</span>}
      </div>
    </div>
  )
}

function groupByType(rows = []) {
  const g = { regular: [], non_regular: [] }
  for (const r of rows) g[r.student_type]?.push(r)
  for (const type of Object.keys(g)) g[type].sort((a, b) => a.student.localeCompare(b.student, 'he'))
  return g
}

