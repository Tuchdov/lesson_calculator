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
    expect(onCustomPriceChange).toHaveBeenCalledWith(['Alice'], {
      regular: { '60': 325, '45': 150, '30': 100 },
      non_regular: { '60': 325, '45': 150, '30': 100 },
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
