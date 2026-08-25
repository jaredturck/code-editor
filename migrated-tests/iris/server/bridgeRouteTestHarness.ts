import { Readable } from 'node:stream'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { handleBridgeRequest } from '../../server/desktopBridge/routes/router'
import { DEVELOPMENT_BRIDGE_PERMISSIONS } from '../../server/desktopBridge/shared/bridgeAuthorization'
import type { BridgePermissionState } from '../../server/desktopBridge/shared/bridgeAuthorization'

export interface BridgeRouteTestResponse {
  status: number
  headers: Record<string, string | number | readonly string[]>
  handled: boolean
  text: string
  json: Record<string, any> | null
}

export async function invokeBridgeRoute({
  baseDir,
  url,
  method = 'POST',
  body,
  permissions,
}: {
  baseDir: string
  url: string
  method?: string
  body?: unknown
  permissions?: Partial<BridgePermissionState>
}): Promise<BridgeRouteTestResponse> {
  const payload = body === undefined ? [] : [Buffer.from(JSON.stringify(body))]
  const request = Readable.from(payload) as Readable & Partial<IncomingMessage>
  request.url = url
  request.method = method
  request.headers = {}

  const headers: Record<string, string | number | readonly string[]> = {}
  let responseBody = ''
  let ended = false
  const response = {
    statusCode: 200,
    get writableEnded() {
      return ended
    },
    setHeader(name: string, value: string | number | readonly string[]) {
      headers[name.toLowerCase()] = value
      return this
    },
    end(value: string | Buffer = '') {
      responseBody += String(value)
      ended = true
      return this
    },
  }

  let handled = false
  try {
    handled = await handleBridgeRequest(request as IncomingMessage, response as unknown as ServerResponse, baseDir, {
      permissions: { ...DEVELOPMENT_BRIDGE_PERMISSIONS, ...permissions },
    })
  } catch (error) {
    const candidate = error as { statusCode?: unknown; message?: unknown }
    response.statusCode = Number.isInteger(candidate.statusCode) ? Number(candidate.statusCode) : 500
    response.end(
      JSON.stringify({
        error: typeof candidate.message === 'string' ? candidate.message : 'Unexpected local bridge error',
      }),
    )
  }

  return {
    status: response.statusCode,
    headers,
    handled,
    text: responseBody,
    json: responseBody ? (JSON.parse(responseBody) as Record<string, any>) : null,
  }
}
