import { useCallback, useEffect, useRef, useState } from 'react'
import { billingRequest } from '../lib/billingClient.js'
import { loadLegacyPaymentLinks, loadPaymentLinks } from '../lib/payments.js'
import { toAgorot } from '../lib/billing.js'

export function useBilling(getAccessToken, owner, month) {
  const [state, setState] = useState({ data: null, loading: true, error: null })
  const generation = useRef(0)
  const sequence = useRef(0)
  const importedOwner = useRef(null)
  const controllers = useRef(new Set())
  const refresh = useCallback(async () => {
    const epoch = generation.current
    const request = ++sequence.current
    const controller = new AbortController()
    controllers.current.add(controller)
    const active = () => epoch === generation.current && !controller.signal.aborted
    const options = { owner, signal: controller.signal }
    setState(previous => ({ ...previous, loading: true, error: null }))
    try {
      if (!owner) throw new Error('Sign in to load Billing.')
      if (owner && importedOwner.current !== owner) {
        const old = await loadLegacyPaymentLinks(owner)
        if (!active()) return null
        const entries = Object.entries(old).map(([key, entry]) => ({ month: key.slice(0, 7), student: key.slice(8), link: entry.link, amountAgorot: toAgorot(entry.amount) }))
        // Reviewed history only: the server adds holds, never infers unpaid debt.
        for (let offset = 0; offset < entries.length; offset += 100) {
          if (!active()) return null
          await billingRequest(getAccessToken, '/api/billing', { action: 'importLegacy', month, entries: entries.slice(offset, offset + 100) }, options)
        }
        // Only prune local copies after every historical record is durable.
        if (!active()) return null
        await loadPaymentLinks(owner)
        if (!active()) return null
        importedOwner.current = owner
      }
      if (!active()) return null
      const data = await billingRequest(getAccessToken, `/api/billing?month=${encodeURIComponent(month)}`, undefined, options)
      if (epoch === generation.current && request === sequence.current) setState({ data, owner, loading: false, error: null })
      return data
    } catch (err) {
      if (epoch === generation.current && request === sequence.current) setState({ data: null, loading: false, error: err.message })
      return null
    } finally {
      controllers.current.delete(controller)
    }
  }, [getAccessToken, owner, month])
  useEffect(() => {
    const epoch = ++generation.current
    const activeControllers = controllers.current
    queueMicrotask(() => { if (generation.current === epoch) void refresh() })
    const onFocus = () => { void refresh() }
    window.addEventListener('focus', onFocus)
    return () => {
      generation.current = epoch + 1
      for (const controller of activeControllers) controller.abort()
      activeControllers.clear()
      window.removeEventListener('focus', onFocus)
    }
  }, [refresh])

  const action = useCallback(async (actionName, input) => {
    const epoch = generation.current
    const controller = new AbortController()
    controllers.current.add(controller)
    try {
      const data = await billingRequest(getAccessToken, '/api/billing', { ...input, action: actionName, month }, { owner, signal: controller.signal })
      if (epoch === generation.current) await refresh()
      return data
    } finally { controllers.current.delete(controller) }
  }, [getAccessToken, month, owner, refresh])

  const current = state.owner === owner && state.data?.month === month
  return { data: current ? state.data : null, loading: state.loading || (!current && !state.error), error: state.error, refresh, action }
}
