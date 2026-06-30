import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { Toggle } from '../src/components/SettingsModal'

describe('Settings Toggle', () => {
  it('keeps a contained thumb and reports changes', () => {
    const on_change = vi.fn()
    render(<Toggle checked onChange={on_change} />)

    const toggle = screen.getByRole('switch')
    expect(toggle).toHaveClass('h-6', 'w-11')
    expect(toggle.firstElementChild).toHaveClass('left-1', 'top-1', 'h-4', 'w-4', 'translate-x-5')
    fireEvent.click(toggle)
    expect(on_change).toHaveBeenCalledWith(false)
  })
})
