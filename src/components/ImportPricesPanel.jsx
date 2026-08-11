import { useState, useMemo, useRef, useEffect, useCallback } from 'react'
import { suggestMapping, findDuplicateMappings, planImport } from '../lib/importPlanner.js'
import styles from './ImportPricesPanel.module.css'

const ACCEPTED_EXTENSIONS = ['.xlsx', '.xls', '.csv']
const MAPPING_FIELDS = [
  { key: 'name', label: 'Student name', required: true },
  { key: 'minutes', label: 'Minutes', required: true },
  { key: 'regular', label: 'Regular price', required: false },
  { key: 'nonRegular', label: 'Non-regular price', required: false },
  { key: 'phone', label: 'Phone', required: false },
]
const FIELD_LABEL = Object.fromEntries(MAPPING_FIELDS.map(f => [f.key, f.label]))

export function ImportPricesPanel({ existingKeys, availableStudents, onImport, onClose }) {
  const [fileName, setFileName] = useState('')
  const [sheetNames, setSheetNames] = useState([])
  const [selectedSheet, setSelectedSheet] = useState('')
  const [workbook, setWorkbook] = useState(null)
  const [rows, setRows] = useState(null)
  const [mapping, setMapping] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const [skipDetailOpen, setSkipDetailOpen] = useState(false)

  const headingRef = useRef(null)
  const fileInputRef = useRef(null)
  const xlsxRef = useRef(null)

  useEffect(() => {
    headingRef.current?.focus()
  }, [])

  const loadSheet = useCallback((wb, sheetName) => {
    const XLSX = xlsxRef.current
    const sheet = wb.Sheets[sheetName]
    const sheetRows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, blankrows: false })
    if (!sheetRows || sheetRows.length === 0) {
      setError("Couldn't read this file…")
      setRows(null)
      setMapping(null)
      return
    }
    setRows(sheetRows)
    setMapping(suggestMapping(sheetRows[0] ?? []))
  }, [])

  const handleFileChange = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return

    setError(null)
    setFileName(file.name)
    setRows(null)
    setMapping(null)
    setSheetNames([])
    setSelectedSheet('')
    setWorkbook(null)

    const ext = file.name.slice(file.name.lastIndexOf('.')).toLowerCase()
    if (!ACCEPTED_EXTENSIONS.includes(ext)) {
      setError('Unsupported file type. Choose an .xlsx, .xls, or .csv file.')
      return
    }

    setLoading(true)
    let XLSX
    try {
      XLSX = await import('xlsx')
    } catch {
      setError("Couldn't load the Excel reader — check your connection and try again.")
      setLoading(false)
      return
    }
    xlsxRef.current = XLSX

    try {
      const buffer = await file.arrayBuffer()
      let wb
      if (ext === '.csv') {
        let text
        try {
          text = new TextDecoder('utf-8', { fatal: true }).decode(buffer)
        } catch {
          text = new TextDecoder('windows-1255').decode(buffer)
        }
        wb = XLSX.read(text, { type: 'string' })
      } else {
        wb = XLSX.read(buffer, { type: 'array' })
      }

      if (!wb.SheetNames || wb.SheetNames.length === 0) {
        setError("Couldn't read this file…")
        return
      }

      setWorkbook(wb)
      setSheetNames(wb.SheetNames)
      const firstSheet = wb.SheetNames[0]
      setSelectedSheet(firstSheet)
      loadSheet(wb, firstSheet)
    } catch {
      setError("Couldn't read this file…")
    } finally {
      setLoading(false)
    }
  }

  const handleSheetChange = (e) => {
    const sheetName = e.target.value
    setSelectedSheet(sheetName)
    if (workbook) loadSheet(workbook, sheetName)
  }

  const handleMappingChange = (field, value) => {
    setMapping(prev => ({ ...prev, [field]: Number(value) }))
  }

  const planResult = useMemo(() => {
    if (!rows || !mapping) return null
    return planImport({ rows, mapping, existingKeys, availableStudents })
  }, [rows, mapping, existingKeys, availableStudents])

  const duplicateFields = mapping ? findDuplicateMappings(mapping) : []
  const hasEntries = Boolean(planResult && Object.keys(planResult.entries).length > 0)
  const canImport = Boolean(
    mapping &&
    mapping.name >= 0 &&
    mapping.minutes >= 0 &&
    (mapping.regular >= 0 || mapping.nonRegular >= 0) &&
    hasEntries && !busy && !loading && !error,
  )

  const handleImport = () => {
    if (!canImport || busy) return
    setBusy(true)
    onImport({ entries: planResult.entries, phones: planResult.phones })
    onClose()
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation()
      onClose()
    }
  }

  return (
    <div className={styles.panel} onKeyDown={handleKeyDown}>
      <h3 className={styles.heading} tabIndex={-1} ref={headingRef}>Import prices</h3>

      <div className={styles.fileRow}>
        <input
          ref={fileInputRef}
          type="file"
          accept=".xlsx,.xls,.csv"
          onChange={handleFileChange}
          disabled={loading}
          className={styles.fileInput}
        />
        {!fileName && <span className={styles.fileHint}>Excel (.xlsx, .xls) or CSV</span>}
      </div>

      {loading && (
        <div className={styles.loadingRow}>
          <span className={styles.spinner} />
          Reading file…
        </div>
      )}

      {error && <div className={styles.errorBlock} role="alert">{error}</div>}

      {sheetNames.length > 1 && (
        <label className={styles.mapField}>
          <span className={styles.lbl}>Sheet</span>
          <select value={selectedSheet} onChange={handleSheetChange}>
            {sheetNames.map(name => <option key={name} value={name}>{name}</option>)}
          </select>
        </label>
      )}

      {rows && mapping && (
        <>
          <div className={styles.mapRow}>
            {MAPPING_FIELDS.map(field => (
              <label key={field.key} className={styles.mapField}>
                <span className={styles.lbl}>
                  {field.label}{field.required && <span className={styles.req}> *</span>}
                </span>
                <select value={mapping[field.key]} onChange={e => handleMappingChange(field.key, e.target.value)}>
                  <option value={-1}>Choose a column…</option>
                  {rows[0].map((header, i) => (
                    <option key={i} value={i}>{String(header ?? `Column ${i + 1}`)}</option>
                  ))}
                </select>
              </label>
            ))}
          </div>

          {duplicateFields.length > 0 && (
            <div className={styles.warnInline}>
              One column is mapped to more than one field: {duplicateFields.map(f => FIELD_LABEL[f]).join(', ')}.
            </div>
          )}

          {planResult && !hasEntries && (
            <div className={styles.emptyResult}>No valid rows found in this file. Adjust the column mapping above.</div>
          )}

          {hasEntries && (
            <>
              {planResult.replacedStudents.length > 0 && (
                <div className={styles.warn} role="alert" aria-live="polite">
                  <b>{planResult.replacedStudents.length} existing student{planResult.replacedStudents.length === 1 ? '' : 's'} will be overwritten:</b>{' '}
                  {planResult.replacedStudents.join(', ')}
                </div>
              )}

              {planResult.unmatchedStudents && planResult.unmatchedStudents.length > 0 && (
                <div className={styles.warnInline} role="status">
                  {planResult.unmatchedStudents.length} imported student{planResult.unmatchedStudents.length === 1 ? " doesn't" : 's don\'t'} match any calendar student: {planResult.unmatchedStudents.join(', ')}.
                </div>
              )}

              <div className={styles.counts} aria-live="polite">
                <span><b>{planResult.counts.new}</b> new</span>
                <span><b>{planResult.counts.replaced}</b> replaced</span>
                {planResult.counts.skippedRows > 0 && <span><b>{planResult.counts.skippedRows}</b> skipped</span>}
                {planResult.counts.conflictingRows > 0 && <span><b>{planResult.counts.conflictingRows}</b> conflicting (last wins)</span>}
                {planResult.counts.invalidPhones > 0 && <span><b>{planResult.counts.invalidPhones}</b> invalid phones dropped</span>}
              </div>

              {planResult.skipDetails.length > 0 && (
                <div className={styles.skipDetail}>
                  <button type="button" className={styles.btnText} onClick={() => setSkipDetailOpen(v => !v)}>
                    {skipDetailOpen ? 'Hide' : 'Show'} row details ({planResult.skipDetails.length})
                  </button>
                  {skipDetailOpen && (
                    <ul className={styles.skipList}>
                      {planResult.skipDetails.map((d, i) => (
                        <li key={i}>Row {d.row}: {String(d.value) || '(empty)'} — {d.reason}</li>
                      ))}
                    </ul>
                  )}
                </div>
              )}

              <div className={styles.tblWrap}>
                <table>
                  <thead>
                    <tr>
                      <th></th>
                      <th className={styles.grpReg} colSpan={3}>Regular</th>
                      <th className={styles.grpNon} colSpan={3}>Non-regular</th>
                      <th></th>
                    </tr>
                    <tr>
                      <th className={styles.name}>Student</th>
                      <th>60′</th><th>45′</th><th>30′</th>
                      <th>60′</th><th>45′</th><th>30′</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...planResult.newStudents, ...planResult.replacedStudents].map(name => {
                      const entry = planResult.entries[name]
                      const isReplaced = planResult.replacedStudents.includes(name)
                      return (
                        <tr key={name}>
                          <td className={styles.name}>{name}</td>
                          <td>{entry.regular['60'] ?? '—'}</td>
                          <td>{entry.regular['45'] ?? '—'}</td>
                          <td>{entry.regular['30'] ?? '—'}</td>
                          <td>{entry.non_regular['60'] ?? '—'}</td>
                          <td>{entry.non_regular['45'] ?? '—'}</td>
                          <td>{entry.non_regular['30'] ?? '—'}</td>
                          <td>
                            <span className={isReplaced ? styles.chipRep : styles.chipNew}>
                              {isReplaced ? 'replaced' : 'new'}
                            </span>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}

      <div className={styles.footer}>
        <button type="button" className={styles.btnText} onClick={onClose}>Cancel</button>
        <button type="button" className={styles.btnPrimary} disabled={!canImport} onClick={handleImport}>Import</button>
      </div>
    </div>
  )
}
