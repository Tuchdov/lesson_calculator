import { useState } from 'react'
import { buildPaymentMessage, DEFAULT_MESSAGE_TEMPLATE } from '../lib/whatsapp.js'
import { DEFAULT_CANCELLED_KEYWORDS, DEFAULT_PAID_CANCELLATION_PHRASES, DEFAULT_LESSON_KEYWORDS, DEFAULT_MAKEUP_PHRASES, MAKEUP_AUTO_MIN, MAKEUP_AUTO_MAX, currentMonthKey } from '../lib/calendarPayments.js'
import { TYPES, TYPE_LABEL } from '../lib/priceConstants.js'
import { buildGrowDescription, fitsInvoiceLimit, MAX_INVOICE_DESCRIPTION } from '../lib/payments.js'
import { uploadPreviewImage } from '../lib/previewImageClient.js'
import styles from './SettingsPage.module.css'

const DURATION_LABELS = { '60': '60 min', '45': '45 min', '30': '30 min' }
// Sample student for the invoice preview and its length check.
const SAMPLE_STUDENT = 'דנה לוי'

/**
 * The default prices to start editing from: the saved ones when both tiers are
 * set, else the pricing config.
 * @param {object} settings Saved settings.
 * @param {object} config The pricing config.
 * @returns {object} A copy of the prices per tier.
 */
function initialPrices(settings, config) {
  const saved = settings?.default_prices
  if (saved?.regular && saved?.non_regular) return deepClone(saved)
  return deepClone(config?.prices ?? { regular: {}, non_regular: {} })
}

/**
 * Saved list if customized (null = never customized), else the default.
 * @param {string[] | null} saved The saved list.
 * @param {string[]} defaults The built-in list.
 * @returns {string[]} A copy to edit.
 */
function initialList(saved, defaults) {
  return saved != null ? [...saved] : [...defaults]
}

/**
 * Settings: default prices, the WhatsApp message and invoice text, the preview
 * photo, and the phrase lists that decide which events count.
 * @param {object} props config, settings, onSave and getAccessToken.
 * @returns {import('react').ReactNode} The page.
 */
export function SettingsPage({ config, settings, onSave, getAccessToken }) {
  const [prices, setPrices] = useState(() => initialPrices(settings, config))
  const [messageTemplate, setMessageTemplate] = useState(
    () => settings?.default_message || DEFAULT_MESSAGE_TEMPLATE
  )
  const [invoiceTemplate, setInvoiceTemplate] = useState(() => settings?.default_invoice_description ?? '')
  const [invoiceTooLong, setInvoiceTooLong] = useState(false)
  const [paidCancelPhrases, setPaidCancelPhrases] = useState(() => initialList(settings?.paid_cancellation_phrases, DEFAULT_PAID_CANCELLATION_PHRASES))
  const [keywords, setKeywords] = useState(() => initialList(settings?.cancelled_keywords, config?.cancelled_keywords ?? DEFAULT_CANCELLED_KEYWORDS))
  const [lessonKeywords, setLessonKeywords] = useState(() => initialList(settings?.lesson_keywords, DEFAULT_LESSON_KEYWORDS))
  const [makeupPhrases, setMakeupPhrases] = useState(() => initialList(settings?.makeup_phrases, DEFAULT_MAKEUP_PHRASES))
  const [previewImage, setPreviewImage] = useState(() => settings?.preview_image ?? '')
  const [imageUploading, setImageUploading] = useState(false)
  const [imageError, setImageError] = useState('')
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

  const handleImageFile = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setImageUploading(true)
    setImageError('')
    try {
      setPreviewImage(await uploadPreviewImage(getAccessToken, file))
      setSaved(false)
    } catch (err) {
      setImageError(err.message || 'Could not upload the photo. Try again.')
    } finally {
      setImageUploading(false)
    }
  }

  const listChanger = (setter) => (next) => {
    setter(next)
    setSaved(false)
  }

  const handleSave = async () => {
    const invoice = invoiceTemplate.trim()
    if (invoice && !fitsInvoiceLimit(SAMPLE_STUDENT, invoice)) {
      setInvoiceTooLong(true)
      return
    }
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
      default_invoice_description: invoice,
      preview_image: previewImage,
      paid_cancellation_phrases: paidCancelPhrases,
      cancelled_keywords: keywords,
      lesson_keywords: lessonKeywords,
      makeup_phrases: makeupPhrases,
    })
    setSaved(true)
  }

  const preview = buildPaymentMessage(SAMPLE_STUDENT, 300, currentMonthKey(), messageTemplate, 4)
  const invoicePreview = buildGrowDescription(SAMPLE_STUDENT, currentMonthKey(), invoiceTemplate.trim() || undefined)

  return (
    <div className={styles.page}>
      <h2 className={styles.heading}>Settings</h2>
      <p className={styles.hint}>
        Default prices, invoice text and WhatsApp message template used for
        every student unless overridden on the Custom Prices page.
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
          Use <code>{'{payer}'}</code> or <code>{'{student}'}</code> (both are
          who pays: a parent, else the student), <code>{'{first_name}'}</code>{' '}
          (their first name),{' '}
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

      <div className={styles.card}>
        <div className={styles.cardHeader}>
          <h3 className={styles.cardTitle}>Default invoice text</h3>
          <button className={styles.resetBtn} onClick={() => { setInvoiceTemplate(''); setInvoiceTooLong(false); setSaved(false) }}>
            Reset to original
          </button>
        </div>
        <p className={styles.tokenHint}>
          The description on the payment page and invoice. Use{' '}
          <code>{'{student}'}</code> and <code>{'{month}'}</code> — they're
          replaced automatically per student. Leave empty for the built-in
          wording. A student's own invoice text on the Custom Prices page
          replaces this.
        </p>
        <input
          type="text"
          className={`${styles.input} ${styles.fullInput} ${invoiceTooLong ? styles.inputError : ''}`}
          dir="rtl"
          aria-label="Default invoice text"
          aria-invalid={invoiceTooLong ? true : undefined}
          aria-describedby={invoiceTooLong ? 'default-invoice-error' : undefined}
          placeholder="תשלום עבור שיעורי שירה - {student} - {month}"
          value={invoiceTemplate}
          onChange={e => { setInvoiceTemplate(e.target.value); setInvoiceTooLong(false); setSaved(false) }}
        />
        {invoiceTooLong && <span id="default-invoice-error" className={styles.fieldError}>Too long: at most {MAX_INVOICE_DESCRIPTION} characters once the name and month are filled in</span>}
        <div className={styles.previewWrap}>
          <span className={styles.previewLabel}>Preview</span>
          <pre className={styles.preview} dir="rtl">{invoicePreview}</pre>
        </div>
      </div>

      <div className={styles.card}>
        <div className={styles.cardHeader}>
          <h3 className={styles.cardTitle}>Payment link photo</h3>
          {previewImage && (
            // Disabled mid-upload: a finishing upload would bring the photo back.
            <button className={styles.resetBtn} disabled={imageUploading} onClick={() => { setPreviewImage(''); setImageError(''); setSaved(false) }}>
              Remove photo
            </button>
          )}
        </div>
        <p className={styles.tokenHint}>
          Shown in the WhatsApp preview of the payment link. Applies to links
          created after you save; links already prepared keep their old preview.
        </p>
        {previewImage && (
          <img className={styles.previewImage} src={previewImage} alt="Payment link photo" />
        )}
        <label className={styles.uploadRow}>
          <span className={styles.btnPrimary} aria-disabled={imageUploading || undefined}>
            {imageUploading ? 'Uploading…' : previewImage ? 'Replace photo' : 'Upload photo'}
          </span>
          <input
            type="file"
            accept="image/*"
            className={styles.fileInput}
            aria-label="Payment link photo"
            disabled={imageUploading}
            onChange={handleImageFile}
          />
        </label>
        {imageError && <span className={styles.fieldError} role="alert">{imageError}</span>}
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

/**
 * An editable list of phrases (add, remove, reset to the defaults).
 * @param {object} props title, hint, items, defaults, onChange, emptyText,
 *   placeholder and addLabel.
 * @returns {import('react').ReactNode} The card.
 */
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

/**
 * A deep copy of plain JSON data.
 * @param {object} obj Data to copy.
 * @returns {object} The copy.
 */
function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj))
}
