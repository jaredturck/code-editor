/** Verifies authenticated File Manager media responses support bounded video range playback. */

import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { Readable, Writable } from 'node:stream'
import { afterEach, describe, expect, it } from 'vitest'
import { handleFileRoutes } from '../../backend/desktopBridge/routes/fileRoutes'
import type { BridgeRequest, BridgeResponse } from '../../backend/desktopBridge/types'

const temporaryRoots: string[] = []

class TestResponse extends Writable {
  statusCode = 200
  headers = new Map<string, string>()
  chunks: Buffer[] = []

  setHeader(name: string, value: string | number | readonly string[]) {
    this.headers.set(name.toLowerCase(), String(value))
    return this
  }

  getHeader(name: string) {
    return this.headers.get(name.toLowerCase())
  }

  _write(chunk: Buffer | string, _encoding: BufferEncoding, callback: (error?: Error | null) => void) {
    this.chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
    callback()
  }

  body(): Buffer {
    return Buffer.concat(this.chunks)
  }
}

function createRequest(url: string, range = ''): BridgeRequest {
  const request = Readable.from([]) as BridgeRequest
  request.url = url
  request.method = 'GET'
  request.headers = range ? { range } : {}
  return request
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })))
})

describe('file media route', () => {
  it('streams requested MP4 byte ranges with browser media headers', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'iris-media-'))
    temporaryRoots.push(root)
    const videoPath = path.join(root, 'clip.mp4')
    await fs.writeFile(videoPath, Buffer.from('0123456789'))
    const url = `/api/local/fs/media?path=${encodeURIComponent(videoPath)}`
    const request = createRequest(url, 'bytes=2-5')
    const response = new TestResponse()

    const handled = await handleFileRoutes(
      request,
      response as unknown as BridgeResponse,
      root,
      new URL(url, 'http://localhost'),
      '/api/local/fs/media',
      {
        permissions: {
          fileRead: true,
          fileWrite: false,
          terminal: false,
          launcher: false,
          automation: false,
          microphone: false,
        },
      },
    )

    expect(handled).toBe(true)
    expect(response.statusCode).toBe(206)
    expect(response.getHeader('content-type')).toBe('video/mp4')
    expect(response.getHeader('accept-ranges')).toBe('bytes')
    expect(response.getHeader('content-range')).toBe('bytes 2-5/10')
    expect(response.body().toString()).toBe('2345')
  })

  it('rejects unsupported media files and invalid byte ranges', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'iris-media-'))
    temporaryRoots.push(root)
    const textPath = path.join(root, 'notes.txt')
    const videoPath = path.join(root, 'clip.mp4')
    await fs.writeFile(textPath, 'notes')
    await fs.writeFile(videoPath, 'video')

    const textUrl = `/api/local/fs/media?path=${encodeURIComponent(textPath)}`
    const textResponse = new TestResponse()
    await handleFileRoutes(
      createRequest(textUrl),
      textResponse as unknown as BridgeResponse,
      root,
      new URL(textUrl, 'http://localhost'),
      '/api/local/fs/media',
      {
        permissions: {
          fileRead: true,
          fileWrite: false,
          terminal: false,
          launcher: false,
          automation: false,
          microphone: false,
        },
      },
    )
    expect(textResponse.statusCode).toBe(400)

    const videoUrl = `/api/local/fs/media?path=${encodeURIComponent(videoPath)}`
    const rangeResponse = new TestResponse()
    await handleFileRoutes(
      createRequest(videoUrl, 'bytes=50-60'),
      rangeResponse as unknown as BridgeResponse,
      root,
      new URL(videoUrl, 'http://localhost'),
      '/api/local/fs/media',
      {
        permissions: {
          fileRead: true,
          fileWrite: false,
          terminal: false,
          launcher: false,
          automation: false,
          microphone: false,
        },
      },
    )
    expect(rangeResponse.statusCode).toBe(416)
    expect(rangeResponse.getHeader('content-range')).toBe('bytes */5')
  })
})
