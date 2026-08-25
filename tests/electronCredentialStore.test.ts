/**
 * Exercises the Electron credential vault without a real desktop wallet. The fake
 * safeStorage implementation lets the suite verify encryption-at-rest, atomic replacement,
 * backend refusal, and the provider-specific CRUD contract.
 */

import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createCredentialStore } from '../electron/platform/credentialStore.cts'

interface SafeStorageFixture {
  isEncryptionAvailable: () => boolean
  getSelectedStorageBackend: () => string
  encryptString: (value: string) => Buffer
  decryptString: (buffer: Buffer) => string
}

interface CredentialStoreFixture {
  set: (provider: string, value: string) => boolean
  get: (provider: string) => string
  list: () => string[]
  remove: (provider: string) => boolean
  status: () => Record<string, unknown>
}

const temporaryRoots: string[] = []

// Determines whether the fake safe storage for the surrounding test scenario.
function fakeSafeStorage(backend = 'kwallet6'): SafeStorageFixture {
  return {
    isEncryptionAvailable: () => true,
    getSelectedStorageBackend: () => backend,
    encryptString: (value: string) => Buffer.from(`encrypted:${Buffer.from(value).toString('base64')}`),
    // Decodes the reversible test ciphertext used by the safeStorage fixture.
    decryptString: (buffer: Buffer) => {
      const encoded = buffer.toString().replace(/^encrypted:/, '')
      return Buffer.from(encoded, 'base64').toString()
    },
  }
}

// Creates the isolated fixture used by the credential-store tests.
async function fixture(backend = 'kwallet6'): Promise<{ root: string; store: CredentialStoreFixture }> {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'iris-credentials-'))
  temporaryRoots.push(root)
  const app = { isReady: () => true, getPath: () => root }
  return {
    root,
    store: createCredentialStore({ app, safeStorage: fakeSafeStorage(backend), platform: 'linux' }),
  }
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => fsp.rm(root, { recursive: true, force: true })))
})

describe('Electron credential store', () => {
  it('stores ciphertext and returns the original provider key', async () => {
    const { root, store } = await fixture()
    expect(store.set('OpenAI', 'fake-secret-key')).toBe(true)
    expect(store.get('openai')).toBe('fake-secret-key')
    expect(store.list()).toEqual(['openai'])

    const raw = await fsp.readFile(path.join(root, 'secure-credentials.json'), 'utf8')
    expect(raw).not.toContain('fake-secret-key')
    const parsed = JSON.parse(raw)
    expect(Buffer.from(parsed.entries.openai, 'base64').toString()).toContain('encrypted:')
  })

  it('removes credentials and leaves no temporary siblings', async () => {
    const { root, store } = await fixture()
    store.set('anthropic', 'one')
    store.set('anthropic', 'two')
    expect(store.remove('anthropic')).toBe(true)
    expect(store.get('anthropic')).toBe('')
    expect(fs.readdirSync(root).filter((name) => name.endsWith('.tmp'))).toEqual([])
  })

  it('refuses Linux basic_text instead of persisting weakly protected ciphertext', async () => {
    const { root, store } = await fixture('basic_text')
    expect(store.status()).toMatchObject({
      available: false,
      persistent: false,
      backend: 'basic_text',
      reason: 'insecure-linux-basic-text-backend',
    })
    expect(() => store.set('openai', 'secret')).toThrow(/insecure-linux-basic-text-backend/)
    await expect(fsp.access(path.join(root, 'secure-credentials.json'))).rejects.toThrow()
  })

  it('refuses a symlinked credential file', async () => {
    const { root, store } = await fixture()
    const outside = path.join(root, 'outside.json')
    await fsp.writeFile(outside, JSON.stringify({ version: 1, entries: {} }))
    await fsp.symlink(outside, path.join(root, 'secure-credentials.json'))
    expect(() => store.set('openai', 'secret')).toThrow(/must not be a symlink/i)
  })
})
