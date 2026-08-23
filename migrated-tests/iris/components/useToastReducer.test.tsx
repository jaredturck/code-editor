/**
 * Exercises the observable use toast reducer contract, with regression cases for “adds
 * newest toasts first” and “caps toast history at twenty items”. The suite documents
 * caller-visible behavior so implementation refactors cannot silently weaken those
 * guarantees.
 */

import { describe, expect, it, vi } from 'vitest'
import { reducer, type ToasterToast } from '@/components/ui/use-toast'

describe('toast reducer', () => {
  it('adds newest toasts first', () => {
    const state = reducer({ toasts: [{ id: 'old' }] }, { type: 'ADD_TOAST', toast: { id: 'new' } })
    expect(state.toasts.map((toast) => toast.id)).toEqual(['new', 'old'])
  })

  it('caps toast history at twenty items', () => {
    let state: { toasts: ToasterToast[] } = { toasts: [] }
    for (let index = 0; index < 25; index += 1) {
      state = reducer(state, {
        type: 'ADD_TOAST',
        toast: { id: String(index) },
      })
    }
    expect(state.toasts).toHaveLength(20)
    expect(state.toasts[0].id).toBe('24')
  })

  it('updates only the matching toast', () => {
    const state = reducer(
      {
        toasts: [
          { id: 'one', title: 'Old' },
          { id: 'two', title: 'Keep' },
        ],
      },
      {
        type: 'UPDATE_TOAST',
        toast: { id: 'one', title: 'New' },
      },
    )
    expect(state.toasts).toEqual([
      { id: 'one', title: 'New' },
      { id: 'two', title: 'Keep' },
    ])
  })

  it('dismisses one toast or all toasts', () => {
    vi.useFakeTimers()
    const initial = {
      toasts: [
        { id: 'one', open: true },
        { id: 'two', open: true },
      ],
    }
    expect(reducer(initial, { type: 'DISMISS_TOAST', toastId: 'one' }).toasts).toEqual([
      { id: 'one', open: false },
      { id: 'two', open: true },
    ])
    expect(reducer(initial, { type: 'DISMISS_TOAST' }).toasts.every((toast) => toast.open === false)).toBe(true)
  })

  it('removes one toast or all toasts', () => {
    const initial = { toasts: [{ id: 'one' }, { id: 'two' }] }
    expect(reducer(initial, { type: 'REMOVE_TOAST', toastId: 'one' }).toasts).toEqual([{ id: 'two' }])
    expect(reducer(initial, { type: 'REMOVE_TOAST' }).toasts).toEqual([])
  })
})
