/**
 * Owns the chat scroll controller state and side effects used by the Chat panel. Extracting
 * this controller keeps the large presentation component from duplicating lifecycle and
 * persistence logic.
 */

import { useEffect, useRef, useState } from 'react'
import type { ChatScrollController } from '../types'

export interface ChatScrollControllerOptions {
  messageCount: number
  timelineCount: number
  isLoading: boolean
}

/**
 * Coordinates chat scroll controller state and side effects for the React feature that
 * consumes this hook.
 */

export function useChatScrollController({
  messageCount,
  timelineCount,
  isLoading,
}: ChatScrollControllerOptions): ChatScrollController {
  const [stickToBottom, setStickToBottom] = useState(true)
  const scrollIntentTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const messagesContainerRef = useRef<HTMLDivElement | null>(null)
  const bottomRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!stickToBottom) return
    const container = messagesContainerRef.current
    if (!container) return
    container.scrollTo({ top: container.scrollHeight, behavior: 'auto' })
  }, [messageCount, timelineCount, isLoading, stickToBottom])

  useEffect(
    () => () => {
      if (scrollIntentTimeoutRef.current) {
        clearTimeout(scrollIntentTimeoutRef.current)
        scrollIntentTimeoutRef.current = null
      }
    },
    [],
  )

  // Handles messages scroll and updates the related state in the chat presentation layer.
  const handleMessagesScroll = (): void => {
    const container = messagesContainerRef.current
    if (!container) return
    const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight
    setStickToBottom(distanceFromBottom <= 80)
  }

  // Runs manual scroll intent on a bounded timer and cleans the timer up when the owner stops.
  const markManualScrollIntent = (): void => {
    setStickToBottom(false)
    if (scrollIntentTimeoutRef.current) clearTimeout(scrollIntentTimeoutRef.current)
    scrollIntentTimeoutRef.current = setTimeout(() => {
      scrollIntentTimeoutRef.current = null
    }, 180)
  }

  // Handles messages wheel and updates the related state in the chat presentation layer.
  const handleMessagesWheel = (event: React.WheelEvent<HTMLDivElement>): void => {
    const container = messagesContainerRef.current
    if (!container) return
    const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight
    if (event.deltaY < 0 || distanceFromBottom > 120) markManualScrollIntent()
  }

  // Scrolls the chat viewport to the newest content while respecting the requested behavior.
  const scrollToBottom = (): void => {
    setStickToBottom(true)
    const container = messagesContainerRef.current
    if (container) container.scrollTo({ top: container.scrollHeight, behavior: 'auto' })
  }

  return {
    stickToBottom,
    setStickToBottom,
    messagesContainerRef,
    bottomRef,
    handleMessagesScroll,
    handleMessagesWheel,
    markManualScrollIntent,
    scrollToBottom,
  }
}
