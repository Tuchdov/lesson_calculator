import { useState } from 'react'
import { buildPaymentMessage, DEFAULT_MESSAGE_TEMPLATE, upgradeMessageTemplate } from '../lib/whatsapp.js'
import { DEFAULT_CANCELLED_KEYWORDS, DEFAULT_PAID_CANCELLATION_PHRASES, DEFAULT_LESSON_KEYWORDS, DEFAULT_MAKEUP_PHRASES, MAKEUP_AUTO_MIN, MAKEUP_AUTO_MAX } from '../lib/calendarPayments.js'
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

// Saved list if customized (null = never customized), else the default.
function initialList(saved, defaults) {
  return saved != null ? [...saved] : [...defaults]
}

export function SettingsPage({ config, settings, onSave }) {
  const [prices, setPrices] = useState(() => initialPrices(settings, config))
  const [messageTemplate, setMessageTemplate] = useState(
    () => upgradeMessageTemplate(settings?.default_message) || DEFAULT_MESSAGE_TEMPLATE
  )
  const [paidCancelPhrases, setPaidCancelPhrases] = useState(() => initialList(settings?.paid_cancellation_phrases, DEFAULT_PAID_CANCELLATION_PHRASES))
  const [keywords, setKeywords] = useState(() => initialList(settings?.cancelled_keywords, config?.cancelled_keywords ?? DEFAULT_CANCELLED_KEYWORDS))
  const [lessonKeywords, setLessonKeywords] = useState(() => initialList(settings?.lesson_keywords, DEFAULT_LESSON_KEYWORDS))
  const [makeupPhrases, setMakeupPhrases] = useState(() => initialList(settings?.makeup_phrases, DEFAULT_MAKEUP_PHRASES))
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

  const listChanger = (setter) => (next) => {
    setter(next)
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
      paid_cancellation_phrases: paidCancelPhrases,
      cancelled_keywords: keywords,
      lesson_keywords: lessonKeywords,
      makeup_phrases: makeupPhrases,
    })
    setSaved(true)
  }

  const preview = buildPaymentMessage('נועה', 300, currentMonth(), messageTemplate, 4, undefined, 'דנה לוי')

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
          Use <code>{'{payer}'}</code> (who pays: a parent, else the
          student), <code>{'{student}'}</code> (the student),{' '}
          <code>{'{amount}'}</code>, <code>{'{month}'}</code>,{' '}
          <code>{'{lessons}'}</code>, and <code>{'{link}'}</code> — they're
          replaced automatically per student. If <code>{'{link}'}</code> isn't in the template, the
          payment link is added at the end instead.
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

      <PhraseListCard
        title="Lesson keywords"
        hint="A calendar event counts as a lesson when its title contains any of these. The student's name is read from around the keyword."
        items={lessonKeywords}
        defaults={DEFAULT_LESSON_KEYWORDS}
        onChange={listChanger(setLessonKeywords)}
        emptyText="No keywords — no lessons will be counted."
        placeholder="כתיבה והלחנה"
        addLabel="Add keyword"
      />

      <PhraseListCard
        title="Paid cancellation phrases"
        hint="A lesson whose title contains any of these phrases is billed even though it's cancelled."
        items={paidCancelPhrases}
        defaults={DEFAULT_PAID_CANCELLATION_PHRASES}
        onChange={listChanger(setPaidCancelPhrases)}
        emptyText="No phrases — paid cancellations won't be detected."
        placeholder="ביטול בתשלום"
        addLabel="Add phrase"
      />

      <PhraseListCard
        title="Cancelled lesson keywords"
        hint="A lesson whose title contains any of these keywords is treated as cancelled and excluded (unless it also matches a paid cancellation phrase above)."
        items={keywords}
        defaults={config?.cancelled_keywords ?? DEFAULT_CANCELLED_KEYWORDS}
        onChange={listChanger(setKeywords)}
        emptyText="No keywords — cancelled lessons won't be detected."
        placeholder="בוטל"
        addLabel="Add keyword"
      />

      <PhraseListCard
        title="Make-up phrases"
        hint={`A ${MAKEUP_AUTO_MIN}–${MAKEUP_AUTO_MAX - 1} minute lesson with a non-standard length (e.g. 75 min) whose title contains one of these is charged as the standard lesson inside it, with the extra minutes free, instead of asking you each month. Shorter or longer events still ask you.`}
        items={makeupPhrases}
        defaults={DEFAULT_MAKEUP_PHRASES}
        onChange={listChanger(setMakeupPhrases)}
        emptyText="No phrases — every non-standard lesson asks you how to charge it."
        placeholder="השלמה"
        addLabel="Add phrase"
      />

      <div className={styles.footer}>
        {saved && <span className={styles.savedMsg}>Saved!</span>}
        <button className={styles.btnPrimary} onClick={handleSave}>Save settings</button>
      </div>
    </div>
  )
}

function PhraseListCard({ title, hint, items, defaults, onChange, emptyText, placeholder, addLabel }) {
  const [draft, setDraft] = useState('')

  const handleAdd = () => {
    const value = draft.trim()
    if (!value || items.includes(value)) return
    onChange([...items, value])
    setDraft('')
  }

  return (
    <div className={styles.card}>
      <div className={styles.cardHeader}>
        <h3 className={styles.cardTitle}>{title}</h3>
        <button className={styles.resetBtn} onClick={() => onChange([...defaults])}>
          Reset to original
        </button>
      </div>
      <p className={styles.tokenHint}>{hint}</p>
      <div className={styles.phraseList}>
        {items.length === 0 && <div className={styles.emptyPhrases}>{emptyText}</div>}
        {items.map((item, i) => (
          <div key={i} className={styles.phraseRow}>
            <span className={styles.phraseText} dir="rtl">{item}</span>
            <button className={styles.removeBtn} onClick={() => onChange(items.filter((_, j) => j !== i))}>
              Remove
            </button>
          </div>
        ))}
      </div>
      <div className={styles.addPhraseRow}>
        <input
          type="text"
          className={styles.input}
          dir="rtl"
          placeholder={placeholder}
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleAdd()}
        />
        <button className={styles.btnPrimary} onClick={handleAdd}>{addLabel}</button>
      </div>
    </div>
  )
}

function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj))
}
