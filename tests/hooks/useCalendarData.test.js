import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useCalendarData } from '../../src/hooks/useCalendarData.js'
import { fetchCalendarEvents } from '../../src/api/calendarApi.js'
import { deferred } from './deferred.js'

vi.mock('../../src/api/calendarApi.js', () => ({ fetchCalendarEvents: vi.fn() }))

const config = {
  calendar_id: 'lessons@example.com',
  prices: {
    regular: { '60': 200, '45': 150, '30': 100 },
    non_regular: { '60': 250, '45': 180, '30': 120 },
  },
}
const events = [{
  summary: 'Alice - פיתוח קול',
  start: { dateTime: '2026-03-10T10:00:00Z' },
  end: { dateTime: '2026-03-10T11:00:00Z' },
}]

beforeEach(() => { fetchCalendarEvents.mockReset().mockResolvedValue(events) })

describe('useCalendarData', () => {
  it.each([
    ['token provider', null, config],
    ['configuration', vi.fn(), null],
  ])('does nothing without a %s', async (_label, getToken, settings) => {
    const { result } = renderHook(() => useCalendarData(getToken, settings))
    await act(async () => { await result.current.calculate('2026-03') })

    expect(fetchCalendarEvents).not.toHaveBeenCalled()
    expect(result.current).toMatchObject({ rows: null, summary: null, loading: false, error: null })
  })

  it('loads the three-month window and exposes calculated rows and summary', async () => {
    const getToken = vi.fn()
    const request = deferred()
    fetchCalendarEvents.mockReturnValueOnce(request.promise)
    const { result } = renderHook(() => useCalendarData(getToken, config))
    expect(result.current).toMatchObject({ rows: null, summary: null, loading: false, error: null })

    let calculating
    act(() => { calculating = result.current.calculate('2026-03') })
    expect(result.current.loading).toBe(true)
    expect(fetchCalendarEvents).toHaveBeenCalledWith(
      getToken, 'lessons@example.com',
      new Date('2026-01-01T00:00:00Z'), new Date('2026-04-01T00:00:00Z'),
    )
    await act(async () => {
      request.resolve(events)
      await calculating
    })

    expect(result.current.loading).toBe(false)
    expect(result.current.error).toBeNull()
    expect(result.current.rows).toEqual([{
      student: 'Alice', aliases: [], name_conflicts: [], student_type: 'non_regular',
      lessons_60: 1, lessons_45: 0, lessons_30: 0, amount_due: 250, review_items: [],
    }])
    expect(result.current.summary).toEqual({ month: '2026-03', students: 1, total_amount_due: 250 })
  })

  it('defaults to the primary calendar and handles an empty month', async () => {
    fetchCalendarEvents.mockResolvedValueOnce([])
    const getToken = vi.fn()
    const { result } = renderHook(() => useCalendarData(getToken, { prices: config.prices }))
    await act(async () => { await result.current.calculate('2026-01') })

    expect(fetchCalendarEvents).toHaveBeenCalledWith(
      getToken, 'primary', new Date('2025-11-01T00:00:00Z'), new Date('2026-02-01T00:00:00Z'),
    )
    expect(result.current.rows).toEqual([])
    expect(result.current.summary).toEqual({ month: '2026-01', students: 0, total_amount_due: 0 })
    expect(result.current.loading).toBe(false)
  })

  it.each([new Error('Calendar unavailable'), 'Calendar unavailable'])(
    'reports fetch failures and clears the error when retrying (%s)', async failure => {
      fetchCalendarEvents.mockRejectedValueOnce(failure)
      const { result } = renderHook(() => useCalendarData(vi.fn(), config))
      await act(async () => { await result.current.calculate('2026-03') })
      expect(result.current).toMatchObject({
        error: 'Calendar unavailable', loading: false, rows: null, summary: null,
      })

      const retry = deferred()
      fetchCalendarEvents.mockReturnValueOnce(retry.promise)
      let calculating
      act(() => { calculating = result.current.calculate('2026-03') })
      expect(result.current.error).toBeNull()
      expect(result.current.loading).toBe(true)
      await act(async () => {
        retry.resolve(events)
        await calculating
      })
      expect(result.current.loading).toBe(false)
      expect(result.current.rows).toHaveLength(1)
    },
  )

  it('preserves the previous result if a later request fails', async () => {
    const { result } = renderHook(() => useCalendarData(vi.fn(), config))
    await act(async () => { await result.current.calculate('2026-03') })
    const { rows, summary } = result.current
    fetchCalendarEvents.mockRejectedValueOnce(new Error('Offline'))
    await act(async () => { await result.current.calculate('2026-04') })

    expect(result.current.rows).toEqual(rows)
    expect(result.current.summary).toEqual(summary)
    expect(result.current.error).toBe('Offline')
    expect(result.current.loading).toBe(false)
  })

  it('uses the latest token provider, calendar, and pricing after rerender', async () => {
    const { result, rerender } = renderHook(
      ({ getToken, settings }) => useCalendarData(getToken, settings),
      { initialProps: { getToken: vi.fn(), settings: config } },
    )
    const getToken = vi.fn()
    rerender({
      getToken,
      settings: {
        ...config, calendar_id: 'other@example.com',
        custom_prices: { Alice: { '60': 300, '45': 200, '30': 150 } },
      },
    })
    await act(async () => { await result.current.calculate('2026-03') })

    expect(fetchCalendarEvents).toHaveBeenCalledWith(
      getToken, 'other@example.com', expect.any(Date), expect.any(Date),
    )
    expect(result.current.rows[0].amount_due).toBe(300)
    expect(result.current.summary.total_amount_due).toBe(300)
  })
  // Value: protects=a run still in flight when the account switches (reset) never fills the table with the previous account's students; fails_when=the runRef check after the fetch is removed or reset() stops bumping it; why_new=reset/runRef were untested; seam=none
  it('discards a run that finishes after reset() and reports nothing from it', async () => {
    const pending = deferred()
    const failing = deferred()
    fetchCalendarEvents.mockReturnValueOnce(pending.promise).mockReturnValueOnce(failing.promise)
    const { result } = renderHook(() => useCalendarData(vi.fn(), config))

    let first
    act(() => { first = result.current.calculate('2026-03') })
    expect(result.current.loading).toBe(true)
    act(() => { result.current.reset() })
    expect(result.current).toMatchObject({ rows: null, summary: null, loading: false, error: null, calculatedWith: null })
    await act(async () => {
      pending.resolve(events)
      await first
    })
    expect(result.current).toMatchObject({ rows: null, summary: null, loading: false, error: null, calculatedWith: null })

    let second
    act(() => { second = result.current.calculate('2026-03') })
    act(() => { result.current.reset() })
    await act(async () => {
      failing.reject(new Error('Token revoked'))
      await second
    })
    expect(result.current).toMatchObject({ rows: null, loading: false, error: null })
  })

  // Value: protects=an older, slower Calculate (e.g. the previous month) cannot overwrite or un-load the newer one's rows, and calculatedWith records the config the shown rows came from; fails_when=stale runs are applied, or a stale run's finally clears loading for the newer run; why_new=only single-run paths were tested; seam=none
  it('keeps the newest calculation when an older one finishes later', async () => {
    const older = deferred()
    const newer = deferred()
    fetchCalendarEvents.mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise)
    const { result } = renderHook(() => useCalendarData(vi.fn(), config))

    let first
    let second
    act(() => { first = result.current.calculate('2026-02') })
    act(() => { second = result.current.calculate('2026-03') })
    await act(async () => {
      older.reject(new Error('Slow failure'))
      await first
    })
    expect(result.current.loading).toBe(true)
    expect(result.current.error).toBeNull()

    await act(async () => {
      newer.resolve(events)
      await second
    })
    expect(result.current.loading).toBe(false)
    expect(result.current.summary.month).toBe('2026-03')
    expect(result.current.rows[0].amount_due).toBe(250)
    expect(result.current.calculatedWith).toBe(config)

    const late = deferred()
    fetchCalendarEvents.mockReturnValueOnce(late.promise).mockResolvedValueOnce([])
    let third
    let fourth
    act(() => { third = result.current.calculate('2026-01') })
    await act(async () => { fourth = result.current.calculate('2026-04'); await fourth })
    await act(async () => {
      late.resolve(events)
      await third
    })
    expect(result.current.summary).toEqual({ month: '2026-04', students: 0, total_amount_due: 0 })
    expect(result.current.rows).toEqual([])
    expect(result.current.loading).toBe(false)
  })
})
