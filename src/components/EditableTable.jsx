import { useState, useEffect } from 'react'
import styles from './EditableTable.module.css'

const DURATION_COLS = ['60', '45', '30']
const TYPE_LABEL = { regular: 'Regular', non_regular: 'Non-regular' }
const TYPE_CHIP = { regular: styles.chipGreen, non_regular: styles.chipAmber }

export function EditableTable({ rows, config, customPrices, onCustomPriceChange }) {
  const grouped = groupByType(rows)

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
      <td colSpan={6}>
        <span className={`${styles.chip} ${TYPE_CHIP[type]}`}>{TYPE_LABEL[type]}</span>
      </td>
    </tr>
  )
}

function StudentRow({ row, config, customPrices, onCustomPriceChange }) {
  const custom = customPrices?.[row.student]
  const prices = resolveRowPrices(row.student, row.student_type === 'regular', config, custom)

  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(custom ? { ...custom } : null)

  useEffect(() => {
    setDraft(custom ? { ...custom } : null)
    setEditing(false)
  }, [custom])

  const amount = row.lessons_60 * Number(prices['60'])
    + row.lessons_45 * Number(prices['45'])
    + row.lessons_30 * Number(prices['30'])

  const handleSave = () => {
    const parsed = {}
    for (const d of DURATION_COLS) {
      const v = parseFloat(draft?.[d])
      parsed[d] = isNaN(v) ? prices[d] : v
    }
    // Save in tiered format so both regular and non-regular are covered.
    // If the student already has tiered custom prices, update the current
    // type's tier and preserve the other.
    let update
    if (custom && ('regular' in custom || 'non_regular' in custom)) {
      update = { ...custom, [row.student_type]: parsed }
    } else {
      update = { regular: parsed, non_regular: parsed }
    }
    onCustomPriceChange?.(row.student, update)
    setEditing(false)
  }

  return (
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
        ₪{Math.round(amount * 100) / 100}
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
    </tr>
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
