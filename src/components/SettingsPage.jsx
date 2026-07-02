import { useState } from 'react'
import { buildPaymentMessage, DEFAULT_MESSAGE_TEMPLATE } from '../lib/whatsapp.js'
import styles from './SettingsPage.module.css'

const DURATION_LABELS = { '60': '60 min', '45': '45 min', '30': '30 min' }
const TYPES = ['regular', 'non_regular']
const TYPE_LABEL = { regular: 'Regular', non_regular: 'Non-regular' }

function currentMonth() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function initialPrices(settings, config) {
  const saved = settings?.default_prices
  if (saved?.regular && saved?.non_regular) return deepClone(saved)
  return deepClone(config?.prices ?? { regular: {}, non_regular: {} })
}

export function SettingsPage({ config, settings, onSave }) {
  const [prices, setPrices] = useState(() => initialPrices(settings, config))
  const [messageTemplate, setMessageTemplate] = useState(
    () => settings?.default_message || DEFAULT_MESSAGE_TEMPLATE
  )
  const [saved, setSaved] = useState(false)

  const handlePrice = (type, duration, value) => {
    setPrices(prev => ({
      ...prev,
      [type]: { ...prev[type], [duration]: value },
    }))
    setSaved(false)
  }

  const handleResetPrices = () => {
    setPrices(deepClone(config?.prices ?? { regular: {}, non_regular: {} }))
    setSaved(false)
  }

  const handleResetMessage = () => {
    setMessageTemplate(DEFAULT_MESSAGE_TEMPLATE)
    setSaved(false)
  }

  const handleSave = async () => {
    const cleaned = {}
    for (const type of TYPES) {
      cleaned[type] = {}
      for (const d of ['60', '45', '30']) {
        const v = parseFloat(prices[type]?.[d])
        cleaned[type][d] = isNaN(v) ? config?.prices?.[type]?.[d] : v
      }
    }
    await onSave({
      ...settings,
      default_prices: cleaned,
      default_message: messageTemplate,
    })
    setSaved(true)
  }

  const preview = buildPaymentMessage('דנה', 300, currentMonth(), messageTemplate)

  return (
    <div className={styles.page}>
      <h2 className={styles.heading}>Settings</h2>
      <p className={styles.hint}>
        Default prices and the WhatsApp message template used for every student
        unless overridden on the Custom Prices page.
      </p>

      <div className={styles.card}>
        <div className={styles.cardHeader}>
          <h3 className={styles.cardTitle}>Default prices</h3>
          <button className={styles.resetBtn} onClick={handleResetPrices}>
            Reset to original
          </button>
        </div>
        {TYPES.map(type => (
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
                    value={prices[type]?.[d] ?? ''}
                    onChange={e => handlePrice(type, d, e.target.value)}
                  />
                </label>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className={styles.card}>
        <div className={styles.cardHeader}>
          <h3 className={styles.cardTitle}>Default WhatsApp message</h3>
          <button className={styles.resetBtn} onClick={handleResetMessage}>
            Reset to original
          </button>
        </div>
        <p className={styles.tokenHint}>
          Use <code>{'{student}'}</code>, <code>{'{amount}'}</code>, and{' '}
          <code>{'{month}'}</code> — they're replaced automatically per student.
        </p>
        <textarea
          className={styles.textarea}
          dir="rtl"
          rows={5}
          value={messageTemplate}
          onChange={e => { setMessageTemplate(e.target.value); setSaved(false) }}
        />
        <div className={styles.previewWrap}>
          <span className={styles.previewLabel}>Preview</span>
          <pre className={styles.preview} dir="rtl">{preview}</pre>
        </div>
      </div>

      <div className={styles.footer}>
        {saved && <span className={styles.savedMsg}>Saved!</span>}
        <button className={styles.btnPrimary} onClick={handleSave}>Save settings</button>
      </div>
    </div>
  )
}

function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj))
}
