import { describe, expect, it } from 'vitest'
import { normalize_browser_url } from '../electron/browserUrl.cts'

describe('Electron browser URL normalization', () => {
  it('defaults common loopback development targets to HTTP', () => {
    expect(normalize_browser_url('localhost:5173')).toBe('http://localhost:5173')
    expect(normalize_browser_url('127.0.0.1:3000/app')).toBe('http://127.0.0.1:3000/app')
    expect(normalize_browser_url('127.25.1.9:8080')).toBe('http://127.25.1.9:8080')
    expect(normalize_browser_url('[::1]:4173')).toBe('http://[::1]:4173')
    expect(normalize_browser_url('0.0.0.0:8000')).toBe('http://0.0.0.0:8000')
  })

  it('preserves explicit schemes and defaults ordinary hosts to HTTPS', () => {
    expect(normalize_browser_url('http://localhost:5173')).toBe('http://localhost:5173')
    expect(normalize_browser_url('https://example.com/path')).toBe('https://example.com/path')
    expect(normalize_browser_url('example.com/path')).toBe('https://example.com/path')
  })

  it('treats ordinary text as a search query', () => {
    expect(normalize_browser_url('react router docs')).toBe('https://duckduckgo.com/?q=react%20router%20docs')
  })
})
