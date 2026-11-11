import { createElement } from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { deferred } from './deferred.js'

const upload = vi.hoisted(() => ({ fn: vi.fn() }))
vi.mock('../../src/lib/previewImageClient.js', () => ({ uploadPreviewImage: upload.fn }))

const { SettingsPage } = await import('../../src/components/SettingsPage.jsx')

const OLD = 'https://abc.public.blob.vercel-storage.com/preview/photo-old.jpg'
const NEW = 'https://abc.public.blob.vercel-storage.com/preview/photo-new.jpg'
const config = { prices: { regular: { '60': 260, '45': 210, '30': 190 }, non_regular: { '60': 280, '45': 230, '30': 210 } } }

describe('SettingsPage payment link photo', () => {
  // Value: protects=Remove photo can't be undone by an upload still in flight; fails_when=Remove stays enabled while uploading; why_new=found in PR review; seam=previewImageClient
  it('disables Remove photo until the upload finishes', async () => {
    const pending = deferred()
    upload.fn.mockReturnValue(pending.promise)
    render(createElement(SettingsPage, { config, settings: { preview_image: OLD }, onSave: vi.fn(), getAccessToken: vi.fn() }))

    const file = new File(['x'], 'photo.png', { type: 'image/png' })
    await act(async () => { fireEvent.change(screen.getByLabelText('Payment link photo'), { target: { files: [file] } }) })
    expect(screen.getByText('Remove photo').disabled).toBe(true)

    await act(async () => { pending.resolve(NEW) })
    expect(screen.getByText('Remove photo').disabled).toBe(false)
    expect(screen.getByAltText('Payment link photo').getAttribute('src')).toBe(NEW)
  })
})
