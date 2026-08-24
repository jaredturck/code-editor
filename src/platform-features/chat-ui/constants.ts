/**
 * Defines the stable labels, limits, and presentation constants shared by Chat panel
 * components and controllers. Keeping them together prevents timeline, artifact, approval,
 * and history views from drifting into different conventions.
 */

import type { ChatMessage } from './types'

export const CHAT_MESSAGES_STORAGE_KEY = 'iris_chat_messages'
export const MAX_PERSISTED_MESSAGES = 120
// Console timeline only renders the most recent N events. A long multi-agent run can emit
// hundreds of trace/tool events; rendering them all (re-checked on the 1s tick) is what makes the
// panel lag. The full run is still saved — this just bounds what's painted at once.
export const CONSOLE_TIMELINE_RENDER_CAP = 200

// New chats start empty — the panel shows a faded prompt until the first message is sent.
export const DEFAULT_MESSAGES: ChatMessage[] = []

export const APPROVAL_REQUEST_TIMEOUT_MS = 10_000
export const QUESTION_REQUEST_TIMEOUT_MS = 660_000
export const APPROVAL_FLOAT_EXTRA_WIDTH = 420
export const CONSOLE_FLOAT_WIDTH = 430
export const SIDE_SPLIT_PANEL_WIDTH = 320
export const CONSOLE_FLOAT_BREAKPOINT = 980
