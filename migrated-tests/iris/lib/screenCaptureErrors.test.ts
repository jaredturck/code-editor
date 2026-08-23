/** Protects actionable capture error messages without conflating capture and xdotool control. */

import { describe, expect, it } from 'vitest'
import { getScreenCaptureErrorMessage } from '@/features/screen-capture/captureStrategies'

describe('screen capture error messages', () => {
  it('explains the Electron portal path for denied or cancelled capture', () => {
    const error = Object.assign(new Error('denied'), {
      name: 'NotAllowedError',
    })
    expect(getScreenCaptureErrorMessage(error, true)).toContain('desktop sharing portal')
    expect(getScreenCaptureErrorMessage(error, true)).not.toContain('xdotool')
  })

  it('distinguishes missing and unreadable sources', () => {
    expect(getScreenCaptureErrorMessage(Object.assign(new Error(), { name: 'NotFoundError' }), true)).toContain(
      'No shareable screen',
    )
    expect(getScreenCaptureErrorMessage(Object.assign(new Error(), { name: 'NotReadableError' }), true)).toContain(
      'could not open',
    )
  })
})
