/**
 * Writes durable files through a same-directory temporary file and rename. This keeps
 * indexes, settings mirrors, skill definitions, and other replace-in-place records from
 * being left partially written if the process stops during serialization or disk I/O.
 */

import { randomBytes } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'

export interface AtomicWriteOptions {
  encoding?: BufferEncoding
  mode?: number
}

// Builds a collision-resistant temporary path beside the destination file for atomic replacement.
function temporarySibling(targetPath: string): string {
  const suffix = randomBytes(8).toString('hex')
  return path.join(path.dirname(targetPath), `.${path.basename(targetPath)}.${process.pid}.${Date.now()}.${suffix}.tmp`)
}

/**
 * Replaces a file only after the complete new value has been written and flushed. The
 * temporary file lives beside the target so the final rename stays on the same filesystem.
 */
export async function atomicWriteFile(
  targetPath: string,
  data: string | Uint8Array,
  options: AtomicWriteOptions = {},
): Promise<void> {
  await fs.mkdir(path.dirname(targetPath), { recursive: true })
  const temporaryPath = temporarySibling(targetPath)
  let handle: Awaited<ReturnType<typeof fs.open>> | null = null

  try {
    handle = await fs.open(temporaryPath, 'wx', options.mode ?? 0o600)
    if (typeof data === 'string') {
      await handle.writeFile(data, options.encoding ?? 'utf8')
    } else {
      await handle.writeFile(data)
    }
    await handle.sync()
    await handle.close()
    handle = null
    await fs.rename(temporaryPath, targetPath)
  } catch (error) {
    if (handle) await handle.close().catch(() => undefined)
    await fs.rm(temporaryPath, { force: true }).catch(() => undefined)
    throw error
  }
}

/** Serializes a JSON value and commits it through the same atomic replacement path. */
export async function atomicWriteJson(
  targetPath: string,
  value: unknown,
  options: AtomicWriteOptions & { spaces?: number } = {},
): Promise<void> {
  await atomicWriteFile(targetPath, JSON.stringify(value, null, options.spaces ?? 0), options)
}
