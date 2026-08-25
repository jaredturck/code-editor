import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const rendererShared = path.join(process.cwd(), 'src/platform/agent/agentBusShared.ts')
const backendShared = path.join(process.cwd(), 'backend/desktopBridge/shared/agentBusShared.ts')

describe('agent bus shared parity', () => {
  it('keeps the renderer and backend build-root copies byte-for-byte identical', () => {
    expect(fs.readFileSync(backendShared, 'utf8')).toBe(fs.readFileSync(rendererShared, 'utf8'))
  })
})
