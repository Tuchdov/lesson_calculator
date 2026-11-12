import { createElement } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { EditableTable } from '../../src/components/EditableTable.jsx'

const row = {
  student: 'Alice', student_type: 'regular',
  lessons_60: 1, lessons_45: 0, lessons_30: 0, amount_due: 200,
}
const config = {
  prices: {
    regular: { '60': 200, '45': 150, '30': 100 },
    non_regular: { '60': 250, '45': 180, '30': 120 },
  },
}

describe('EditableTable price editing', () => {
  it('discards an open draft when custom prices change and opens with the new price', () => {
    const onCustomPriceChange = vi.fn()
    const props = { rows: [row], config, month: '2026-03', onCustomPriceChange }
    const { rerender } = render(createElement(EditableTable, props))

    fireEvent.doubleClick(screen.getByTitle("Double-click to change this student's ₪/lesson rate"))
    fireEvent.change(screen.getByDisplayValue('200'), { target: { value: '220' } })
    expect(screen.getByDisplayValue('220')).toBeTruthy()

    const customPrices = { Alice: { '60': 300, '45': 150, '30': 100 } }
    rerender(createElement(EditableTable, { ...props, customPrices }))
    expect(screen.queryByDisplayValue('220')).toBeNull()
    expect(screen.getByTitle("Double-click to change this student's ₪/lesson rate").textContent).toBe('₪300')

    fireEvent.doubleClick(screen.getByTitle("Double-click to change this student's ₪/lesson rate"))
    expect(screen.getByDisplayValue('300')).toBeTruthy()
    fireEvent.change(screen.getByDisplayValue('300'), { target: { value: '325' } })
    fireEvent.click(screen.getByTitle('Save price'))
    // Only the tier the row bills at changes; the flat price stays for the other.
    expect(onCustomPriceChange).toHaveBeenCalledWith(['Alice'], {
      regular: { '60': 325, '45': 150, '30': 100 },
      non_regular: { '60': 300, '45': 150, '30': 100 },
    })
  })

  // Value: protects=editing a full-price row's rate saves the full price only, so the student's discounted price is unchanged on Custom Prices; fails_when=the edit is written to both tiers (the old behaviour without a tiered custom price); why_new=prices edited on the calculator must land on the tier shown; seam=none
  it('saves an edited full price to the full-price tier only', () => {
    const onCustomPriceChange = vi.fn()
    const fullPrice = { ...row, student_type: 'non_regular', amount_due: 250 }
    render(createElement(EditableTable, { rows: [fullPrice], config, month: '2026-03', onCustomPriceChange }))
    fireEvent.doubleClick(screen.getByTitle("Double-click to change this student's ₪/lesson rate"))
    fireEvent.change(screen.getByDisplayValue('250'), { target: { value: '270' } })
    fireEvent.click(screen.getByTitle('Save price'))
    expect(onCustomPriceChange).toHaveBeenCalledWith(['Alice'], {
      regular: { '60': 200, '45': 150, '30': 100 },
      non_regular: { '60': 270, '45': 180, '30': 120 },
    })
  })

  // Value: protects=after toggling to the discounted price, an edited rate is saved as the student's discounted price even when a tiered price exists; fails_when=the edit lands on the full-price tier or wipes the other tier; why_new=user-reported: discount edits after toggling must reach Custom Prices; seam=none
  it('saves an edit made after granting the discount to the discounted tier', () => {
    const onCustomPriceChange = vi.fn()
    const fullPrice = { ...row, student_type: 'non_regular', amount_due: 260 }
    const tiered = { regular: { '60': 210, '45': 160, '30': 110 }, non_regular: { '60': 260, '45': 190, '30': 130 } }
    render(createElement(EditableTable, {
      rows: [fullPrice], config, month: '2026-03', tierOverrides: { '2026-03:Alice': 'regular' },
      customPrices: { Alice: tiered }, onCustomPriceChange,
    }))
    fireEvent.doubleClick(screen.getByTitle("Double-click to change this student's ₪/lesson rate"))
    fireEvent.change(screen.getByDisplayValue('210'), { target: { value: '195' } })
    fireEvent.click(screen.getByTitle('Save price'))
    expect(onCustomPriceChange).toHaveBeenCalledWith(['Alice'], {
      regular: { '60': 195, '45': 160, '30': 110 },
      non_regular: tiered.non_regular,
    })
  })
})

describe('EditableTable price editing across spellings', () => {
  const spelled = { ...row, student: 'Alice', aliases: ['Alice 11.5 (Mom)', 'Alice Cohen'], name_conflicts: [] }
  const edit = (props) => {
    render(createElement(EditableTable, { rows: [spelled], config, month: '2026-03', ...props }))
    fireEvent.doubleClick(screen.getByTitle("Double-click to change this student's ₪/lesson rate"))
    fireEvent.change(screen.getByDisplayValue('200'), { target: { value: '220' } })
    fireEvent.click(screen.getByTitle('Save price'))
  }
  const same = { regular: { '60': 200, '45': 150, '30': 100 }, non_regular: { '60': 200, '45': 150, '30': 100 } }

  // Value: protects=a rate edit is saved under every other spelling that already has a saved price, so the spellings still agree and the row is not blocked as "two students?"; fails_when=onCustomPriceChange receives only row.student, leaving the alias on the old price; why_new=the edit used to write the canonical key alone; seam=none
  it('saves the new rate under each priced spelling, not unpriced ones', () => {
    const onCustomPriceChange = vi.fn()
    edit({ onCustomPriceChange, customPrices: { Alice: same, 'Alice 11.5 (Mom)': same } })
    expect(onCustomPriceChange).toHaveBeenCalledTimes(1)
    const [students, update] = onCustomPriceChange.mock.calls[0]
    expect(students).toEqual(['Alice', 'Alice 11.5 (Mom)'])
    expect(update.regular['60']).toBe(220)
  })

  // Value: protects=spellings that conflict (probably two students) are never edited together; fails_when=the name_conflicts check is dropped and a rate written for one student lands on the other; why_new=aliases are now written to; seam=none
  it('writes only the row itself when its spellings conflict', () => {
    const onCustomPriceChange = vi.fn()
    const conflicted = { ...spelled, name_conflicts: ['price'] }
    render(createElement(EditableTable, { rows: [conflicted], config, month: '2026-03', onCustomPriceChange, customPrices: { Alice: same, 'Alice 11.5 (Mom)': same } }))
    fireEvent.doubleClick(screen.getByTitle("Double-click to change this student's ₪/lesson rate"))
    fireEvent.change(screen.getByDisplayValue('200'), { target: { value: '220' } })
    fireEvent.click(screen.getByTitle('Save price'))
    expect(onCustomPriceChange.mock.calls[0][0]).toEqual(['Alice'])
  })
})

describe('EditableTable discount toggle', () => {
  const fullPrice = { ...row, student_type: 'non_regular', amount_due: 250 }

  it('grants the discounted price for the month on a full-price row', () => {
    const onTierOverrideChange = vi.fn()
    render(createElement(EditableTable, { rows: [fullPrice], config, month: '2026-03', onTierOverrideChange }))
    fireEvent.click(screen.getByTitle('Click to give the discounted price this month'))
    expect(onTierOverrideChange).toHaveBeenCalledWith('2026-03', 'Alice', 'regular')
  })

  it('bills a granted row at the discounted price and can switch it back', async () => {
    const onTierOverrideChange = vi.fn()
    render(createElement(EditableTable, { rows: [fullPrice], config, month: '2026-03', tierOverrides: { '2026-03:Alice': 'regular' }, onTierOverrideChange }))
    expect(screen.getByTitle('Double-click to set a one-off amount due for this invoice').textContent).toBe('₪200')
    fireEvent.click(screen.getByTitle('Discount granted for this month — click to charge the full price'))
    await vi.waitFor(() => expect(onTierOverrideChange).toHaveBeenCalledWith('2026-03', 'Alice', null))
  })

  it('shows the error and allows a retry when the save fails', async () => {
    const onTierOverrideChange = vi.fn().mockRejectedValueOnce(new Error('Storage is full'))
    render(createElement(EditableTable, { rows: [fullPrice], config, month: '2026-03', onTierOverrideChange }))
    const toggle = screen.getByTitle('Click to give the discounted price this month')
    fireEvent.click(toggle)
    expect((await screen.findByRole('alert')).textContent).toBe('Storage is full')
    expect(toggle.disabled).toBe(false)

    fireEvent.click(toggle)
    await vi.waitFor(() => expect(onTierOverrideChange).toHaveBeenCalledTimes(2))
    await vi.waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
  })

  it('reports a clear that stops part way through the spellings', async () => {
    const onTierOverrideChange = vi.fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('Storage is full'))
    const spelled = { ...fullPrice, aliases: ['Alice Cohen'], name_conflicts: [] }
    const tierOverrides = { '2026-03:Alice': 'regular', '2026-03:Alice Cohen': 'regular' }
    render(createElement(EditableTable, { rows: [spelled], config, month: '2026-03', tierOverrides, onTierOverrideChange }))
    fireEvent.click(screen.getByTitle('Discount granted for this month — click to charge the full price'))
    expect((await screen.findByRole('alert')).textContent).toBe('Storage is full')
    expect(onTierOverrideChange.mock.calls.map(c => c[1])).toEqual(['Alice', 'Alice Cohen'])
  })

  // Value: protects=editing a granted row's rate never lowers the student's full price; fails_when=the edit is saved to both tiers, so clearing the grant (or next month) still bills the discounted rate; why_new=granted rows edit the discounted tier; seam=none
  it.each([
    ['no custom price', undefined, { '60': 250, '45': 180, '30': 120 }],
    ['a flat custom price', { '60': 240, '45': 170, '30': 110 }, { '60': 240, '45': 170, '30': 110 }],
  ])('editing the rate of a granted row with %s keeps the full price', (_, custom, fullPrices) => {
    const onCustomPriceChange = vi.fn()
    render(createElement(EditableTable, {
      rows: [fullPrice], config, month: '2026-03', tierOverrides: { '2026-03:Alice': 'regular' },
      customPrices: custom ? { Alice: custom } : undefined, onCustomPriceChange,
    }))
    const rate = screen.getByTitle("Double-click to change this student's ₪/lesson rate")
    fireEvent.doubleClick(rate)
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '190' } })
    fireEvent.click(screen.getByTitle('Save price'))
    const [, update] = onCustomPriceChange.mock.calls[0]
    expect(update.regular['60']).toBe(190)
    expect(update.non_regular).toEqual(fullPrices)
  })

  it('offers no toggle on a row that already qualifies for the discount', () => {
    render(createElement(EditableTable, { rows: [row], config, month: '2026-03' }))
    expect(screen.queryByRole('button', { name: /Discounted price/ })).toBeNull()
  })
})

describe('EditableTable lesson count editing', () => {
  const COUNT_HINT = 'Double-click to change the number of lessons this month'

  // Value: protects=the teacher can change a month's lesson count and it is saved for that invoice only; fails_when=the count isn't editable or saves under the wrong month/student; why_new=new feature; seam=none
  it('saves edited counts for the month, and adds lessons in an empty duration', async () => {
    const onLessonOverrideChange = vi.fn()
    render(createElement(EditableTable, { rows: [row], config, month: '2026-03', onLessonOverrideChange }))
    fireEvent.doubleClick(screen.getByTitle(COUNT_HINT))
    fireEvent.change(screen.getByLabelText('60-min lessons'), { target: { value: '3' } })
    fireEvent.change(screen.getByLabelText('30-min lessons'), { target: { value: '1' } })
    fireEvent.click(screen.getByTitle('Save lesson count'))
    await vi.waitFor(() => expect(onLessonOverrideChange).toHaveBeenCalledWith('2026-03', 'Alice', { '60': 3, '45': 0, '30': 1 }))
  })

  // Value: protects=typing the calendar's numbers back is a reset, and bad input never saves; fails_when=an override equal to the calendar is stored (row stays "lessons edited") or "1.5" is saved; why_new=new feature; seam=none
  it('treats the calendar counts as a reset and rejects non-whole numbers', async () => {
    const onLessonOverrideChange = vi.fn()
    const edited = { ...row, lessons_60: 3, calendar_lessons: { '60': 1, '45': 0, '30': 0 } }
    const lessonOverrides = { '2026-03:Alice': { '60': 3, '45': 0, '30': 0 } }
    render(createElement(EditableTable, { rows: [edited], config, month: '2026-03', lessonOverrides, onLessonOverrideChange }))
    expect(screen.getByText('lessons edited')).toBeTruthy()
    fireEvent.doubleClick(screen.getByTitle(COUNT_HINT))
    fireEvent.change(screen.getByLabelText('60-min lessons'), { target: { value: '1.5' } })
    fireEvent.click(screen.getByTitle('Save lesson count'))
    expect(screen.getByText('Enter whole numbers (0 or more)')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('60-min lessons'), { target: { value: '1' } })
    fireEvent.click(screen.getByTitle('Save lesson count'))
    await vi.waitFor(() => expect(onLessonOverrideChange).toHaveBeenCalledWith('2026-03', 'Alice', null))
    expect(onLessonOverrideChange).toHaveBeenCalledTimes(1)
  })
})
