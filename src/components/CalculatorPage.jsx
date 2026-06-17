import { useState, useEffect } from 'react'
import { useCalendarData } from '../hooks/useCalendarData.js'
import { EditableTable } from './EditableTable.jsx'
import { safeTotalsCsvBytes } from '../lib/csvExport.js'
import styles from './CalculatorPage.module.css'

function currentMonth() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export function CalculatorPage({ accessToken, config, customPrices, onCustomPriceChange, onStudentsChange }) {
  const [month, setMonth] = useState(currentMonth)
  const { rows, summary, loading, error, calculate } = useCalendarData(accessToken, {
    ...config,
    custom_prices: customPrices,
  })

  useEffect(() => {
    if (rows) onStudentsChange?.(rows.map(r => r.student))
  }, [rows, onStudentsChange])

  const handleRun = () => calculate(month)

  const handleDownload = () => {
    if (!rows?.length) return
    const bytes = safeTotalsCsvBytes(rows)
    const blob = new Blob([bytes], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `lessons-${month}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className={styles.page}>
      <h2 className={styles.heading}>Lesson Calculator</h2>
      <div className={styles.controls}>
        <input
          type="month"
          className={styles.monthInput}
          value={month}
          onChange={e => setMonth(e.target.value)}
        />
        <button className={styles.btnPrimary} onClick={handleRun} disabled={loading}>
          {loading ? 'Loading…' : 'Calculate'}
        </button>
        {rows?.length > 0 && (
          <button className={styles.btnSecondary} onClick={handleDownload}>
            Download CSV
          </button>
        )}
      </div>

      {error && <div className={styles.error}>{error}</div>}

      {summary && (
        <div className={styles.summaryBar}>
          <span>{summary.month}</span>
          <span>{summary.students} students</span>
          <span className={styles.total}>Total: ₪{summary.total_amount_due}</span>
        </div>
      )}

      {rows?.length > 0 && (
        <EditableTable
          rows={rows}
          config={config}
          customPrices={customPrices}
          onCustomPriceChange={onCustomPriceChange}
        />
      )}

      {rows?.length === 0 && !loading && (
        <div className={styles.empty}>No lessons found for {month}.</div>
      )}
    </div>
  )
}
