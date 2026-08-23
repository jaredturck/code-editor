import { describe, expect, it } from 'vitest'
import {
  MAX_CHAT_ATTACHMENTS,
  modelImageCapability,
  normalizeChatAttachments,
  persistedChatAttachments,
} from '@/features/chat/chatAttachments'

describe('chat image attachments', () => {
  it('normalizes bounded image attachments and removes transient previews for persistence', () => {
    const attachments = normalizeChatAttachments(
      Array.from({ length: MAX_CHAT_ATTACHMENTS + 2 }, (_, index) => ({
        id: `image-${index}`,
        name: `image-${index}.png`,
        type: 'image/png',
        content: `base64-${index}`,
        preview: `data:image/png;base64,base64-${index}`,
      })),
    )

    expect(attachments).toHaveLength(MAX_CHAT_ATTACHMENTS)
    expect(persistedChatAttachments(attachments)).toEqual(
      attachments.map(({ preview: _preview, ...attachment }) => attachment),
    )
  })

  it('uses provider metadata conservatively for image-input support', () => {
    expect(modelImageCapability('gemini', 'gemini-3.5-flash').image).toBe(true)
    expect(modelImageCapability('anthropic', 'claude-4-sonnet').image).toBe(true)
    expect(modelImageCapability('local', 'plain-text-model').image).toBe(false)
  })
})
