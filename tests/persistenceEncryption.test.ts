import { randomBytes } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  decryptJson,
  encryptJson,
  NONCE_BYTES,
  TAG_BYTES,
} from '../backend/desktopBridge/storage/encryption'
import {
  filterRendererBootstrapValues,
  isLazyRendererStateKey,
  normalizeRequestedDurableStoreKeys,
} from '../backend/desktopBridge/storage/persistenceSecurityPolicy'

describe('encrypted conversation persistence', () => {
  it('uses authenticated AES-GCM payloads that do not expose plaintext', () => {
    const master_key = randomBytes(32)
    const secret = {
      role: 'user',
      content: 'private chat message that must never be stored in plaintext',
      attachments: [{ name: 'private.txt', content: 'sensitive attachment body' }],
    }

    const payload = encryptJson(master_key, 'chat-message', 'chat-1:0', 'message', secret)

    expect(payload.nonce).toHaveLength(NONCE_BYTES)
    expect(payload.tag).toHaveLength(TAG_BYTES)
    expect(payload.ciphertext.toString('utf8')).not.toContain(secret.content)
    expect(payload.ciphertext.toString('utf8')).not.toContain('sensitive attachment body')
    expect(
      decryptJson(master_key, 'chat-message', 'chat-1:0', 'message', payload),
    ).toEqual(secret)
  })

  it('rejects tampering and record substitution through GCM authentication and AAD', () => {
    const master_key = randomBytes(32)
    const payload = encryptJson(
      master_key,
      'chat-message',
      'chat-1:0',
      'message',
      { content: 'authenticated content' },
    )
    const tampered = {
      ...payload,
      ciphertext: Buffer.from(payload.ciphertext),
    }
    tampered.ciphertext[0] ^= 1

    expect(() =>
      decryptJson(master_key, 'chat-message', 'chat-1:0', 'message', tampered),
    ).toThrow()
    expect(() =>
      decryptJson(master_key, 'chat-message', 'chat-2:0', 'message', payload),
    ).toThrow()
  })
})

describe('renderer persistence exposure policy', () => {
  it('keeps per-chat checkpoints and extended run history sealed during bootstrap', () => {
    const values = filterRendererBootstrapValues({
      iris_settings: '{"theme":"dark"}',
      iris_active_chat_id: '"chat-1"',
      iris_agent_runs: '[{"id":"compact"}]',
      iris_agent_runs_full: '[{"id":"private-history"}]',
      'iris_chat_session_chat-1': '{"projectRun":{"goal":"secret goal"}}',
      'iris_chat_session_chat-2': '{"projectRun":{"goal":"another goal"}}',
    })

    expect(values.iris_settings).toBe('{"theme":"dark"}')
    expect(values.iris_active_chat_id).toBe('"chat-1"')
    expect(values.iris_agent_runs).toBeUndefined()
    expect(values.iris_agent_runs_full).toBeUndefined()
    expect(values['iris_chat_session_chat-1']).toBeUndefined()
    expect(values['iris_chat_session_chat-2']).toBeUndefined()
  })

  it('permits targeted reads only for the lazy sensitive-state namespaces', () => {
    expect(isLazyRendererStateKey('iris_chat_session_chat-1')).toBe(true)
    expect(isLazyRendererStateKey('iris_agent_runs')).toBe(true)
    expect(isLazyRendererStateKey('iris_agent_runs_full')).toBe(true)
    expect(isLazyRendererStateKey('iris_settings')).toBe(false)

    expect(
      normalizeRequestedDurableStoreKeys([
        'iris_chat_session_chat-1',
        'iris_agent_runs',
        'iris_agent_runs_full',
        'iris_settings',
        'iris_chat_session_chat-1',
      ]),
    ).toEqual(['iris_chat_session_chat-1', 'iris_agent_runs', 'iris_agent_runs_full'])
  })
})
