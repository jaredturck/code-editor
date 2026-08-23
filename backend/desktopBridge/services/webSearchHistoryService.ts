/**
 * Provides the encrypted persistence surface for standalone web-search sessions. The renderer
 * stores normalized quick and detailed research results here so expensive local or hosted model
 * work can be reopened without repeating retrieval or synthesis.
 */

import {
  clearEncryptedWebSearchSessions,
  createEncryptedWebSearchSession,
  deleteEncryptedWebSearchSession,
  duplicateEncryptedWebSearchSession,
  getEncryptedWebSearchSession,
  listEncryptedWebSearchSessions,
  upsertEncryptedWebSearchSession,
} from '../storage/encryptedDatabase.js'

export async function listWebSearchHistory(limit: unknown): Promise<Record<string, unknown>[]> {
  return listEncryptedWebSearchSessions(Number(limit) || 100)
}

export async function createWebSearchHistorySession(session: unknown): Promise<Record<string, unknown>> {
  return createEncryptedWebSearchSession(session)
}

export async function getWebSearchHistorySession(id: unknown): Promise<Record<string, unknown> | null> {
  return getEncryptedWebSearchSession(id)
}

export async function saveWebSearchHistorySession(id: unknown, session: unknown): Promise<Record<string, unknown>> {
  return upsertEncryptedWebSearchSession(id, session)
}

export async function duplicateWebSearchHistorySession(id: unknown): Promise<Record<string, unknown>> {
  return duplicateEncryptedWebSearchSession(id)
}

export async function deleteWebSearchHistorySession(id: unknown): Promise<number> {
  return deleteEncryptedWebSearchSession(id)
}

export async function clearWebSearchHistory(): Promise<number> {
  return clearEncryptedWebSearchSessions()
}
