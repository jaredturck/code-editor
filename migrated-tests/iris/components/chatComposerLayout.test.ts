import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const source = fs.readFileSync(path.resolve('src/components/panels/ChatPanel.tsx'), 'utf8')

describe('Chat composer layout', () => {
  it('keeps the attachment, prompt, reasoning, microphone, and send controls in one row', () => {
    const rowStart = source.indexOf('data-testid="chat-composer-row"')
    const rowEnd = source.indexOf('{/* Status bar */}', rowStart)
    const row = source.slice(rowStart, rowEnd)

    expect(rowStart).toBeGreaterThan(-1)
    expect(row).toContain('<Plus size={16} />')
    expect(row).toContain('<textarea')
    expect(row).toContain('<AudioRecordButton')
    expect(row).toContain('<Send size={14} color="white" />')
    expect(row.indexOf('<Plus size={16} />')).toBeLessThan(row.indexOf('<textarea'))
    expect(row.indexOf('<textarea')).toBeLessThan(row.indexOf('<AudioRecordButton'))
    expect(row.indexOf('<AudioRecordButton')).toBeLessThan(row.indexOf('<Send size={14} color="white" />'))
  })
})
