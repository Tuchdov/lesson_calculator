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
    expect(onCustomPriceChange).toHaveBeenCalledWith('Alice', {
      regular: { '60': 325, '45': 150, '30': 100 },
      non_regular: { '60': 325, '45': 150, '30': 100 },
    })
  })
})
