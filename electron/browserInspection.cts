import { session, WebContentsView } from 'electron'

interface BrowserInspectionNetworkState {
  blocked_requests: string[]
  failed_requests: Array<{ url: string; error: string }>
}

export interface BrowserInspectionOptions {
  settle_ms?: number
  timeout_ms?: number
  max_text_chars?: number
}

const browser_inspection_network = new Map<number, BrowserInspectionNetworkState>()
let browser_inspection_session_ready = false

export function is_loopback_browser_url(value: string) {
  try {
    const parsed = new URL(value)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false
    const hostname = parsed.hostname.toLowerCase()
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]' || hostname === '0.0.0.0'
  } catch {
    return false
  }
}

function is_allowed_inspection_resource_url(value: string) {
  try {
    const parsed = new URL(value)
    if (parsed.protocol === 'data:' || parsed.protocol === 'blob:' || parsed.protocol === 'about:') return true
    return is_loopback_browser_url(value)
  } catch {
    return false
  }
}

function bounded_push<T>(items: T[], value: T, limit = 100) {
  if (items.length < limit) items.push(value)
}

function configure_browser_inspection_session() {
  const inspection_session = session.fromPartition('agent-browser-inspect')

  if (!browser_inspection_session_ready) {
    inspection_session.setPermissionRequestHandler((_web_contents, _permission, callback) => callback(false))
    inspection_session.setPermissionCheckHandler(() => false)
    inspection_session.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (details, callback) => {
      if (is_allowed_inspection_resource_url(details.url)) {
        callback({})
        return
      }
      const state = browser_inspection_network.get(details.webContentsId)
      if (state) bounded_push(state.blocked_requests, details.url, 40)
      callback({ cancel: true })
    })
    inspection_session.webRequest.onErrorOccurred({ urls: ['<all_urls>'] }, (details) => {
      const state = browser_inspection_network.get(details.webContentsId)
      if (!state || state.blocked_requests.includes(details.url)) return
      bounded_push(state.failed_requests, { url: details.url, error: details.error }, 40)
    })
    browser_inspection_session_ready = true
  }

  return inspection_session
}

function browser_inspection_dom_script(max_text_chars: number) {
  return `(() => {
    const clean = (value) => String(value || '').replace(/\\s+/g, ' ').trim().slice(0, ${max_text_chars});
    const body = document.body;
    const root = document.getElementById('root') || document.getElementById('app');
    const candidates = body ? Array.from(body.querySelectorAll('*')).slice(0, 1000) : [];
    let visibleElementCount = 0;
    for (const element of candidates) {
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      if (style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity || '1') > 0 && rect.width > 0 && rect.height > 0) {
        visibleElementCount += 1;
      }
    }
    return {
      readyState: document.readyState,
      title: document.title || '',
      bodyText: clean(body?.innerText || body?.textContent || ''),
      bodyChildCount: body?.children?.length || 0,
      bodyHtmlLength: body?.innerHTML?.length || 0,
      visibleElementCount,
      root: root ? {
        id: root.id || '',
        text: clean(root.innerText || root.textContent || ''),
        childCount: root.children?.length || 0,
        htmlLength: root.innerHTML?.length || 0,
      } : null,
    };
  })()`
}

export async function inspect_local_browser_runtime(raw_url: string, options: BrowserInspectionOptions = {}) {
  const url = String(raw_url || '').trim()
  if (!is_loopback_browser_url(url)) {
    throw new Error('Browser runtime inspection is restricted to local loopback HTTP(S) URLs.')
  }

  const settle_ms = Math.max(100, Math.min(5000, Math.round(Number(options.settle_ms) || 700)))
  const timeout_ms = Math.max(1000, Math.min(30000, Math.round(Number(options.timeout_ms) || 15000)))
  const max_text_chars = Math.max(500, Math.min(12000, Math.round(Number(options.max_text_chars) || 6000)))
  const view = new WebContentsView({
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      session: configure_browser_inspection_session(),
    },
  })
  const web_contents = view.webContents
  const network_state: BrowserInspectionNetworkState = { blocked_requests: [], failed_requests: [] }
  const console_messages: Array<{ level: string; message: string; line: number; source: string }> = []
  let load_failure: { code: number; description: string; url: string } | null = null
  let blocked_navigation = ''

  browser_inspection_network.set(web_contents.id, network_state)
  web_contents.setWindowOpenHandler(() => ({ action: 'deny' }))
  const guard_navigation = (event: Electron.Event, target_url: string) => {
    if (is_loopback_browser_url(target_url)) return
    event.preventDefault()
    blocked_navigation = target_url
  }
  web_contents.on('will-navigate', guard_navigation)
  web_contents.on('will-redirect', guard_navigation)
  web_contents.on('console-message', (_event, details) => {
    bounded_push(console_messages, {
      level: String(details.level || 'info'),
      message: String(details.message || '').slice(0, 2000),
      line: Number(details.lineNumber || 0),
      source: String(details.sourceId || '').slice(0, 1000),
    })
  })
  web_contents.on(
    'did-fail-load',
    (_event, error_code, error_description, validated_url, is_main_frame) => {
      if (is_main_frame && error_code !== -3) {
        load_failure = {
          code: Number(error_code),
          description: String(error_description || ''),
          url: String(validated_url || url),
        }
      }
    },
  )

  let timeout: NodeJS.Timeout | null = null
  try {
    await Promise.race([
      web_contents.loadURL(url),
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error(`Browser inspection timed out after ${timeout_ms}ms.`)), timeout_ms)
      }),
    ])
    if (timeout) clearTimeout(timeout)
    timeout = null
    await new Promise((resolve_settle) => setTimeout(resolve_settle, settle_ms))

    let dom: Record<string, unknown> | null = null
    let dom_error = ''
    try {
      dom = await web_contents.executeJavaScript(browser_inspection_dom_script(max_text_chars), true)
    } catch (error) {
      dom_error = error instanceof Error ? error.message : 'Unable to inspect the rendered DOM.'
    }

    const console_errors = console_messages.filter((entry) => {
      const level = entry.level.toLowerCase()
      return level === 'error' || /^uncaught\b/i.test(entry.message)
    })
    const body_text = String(dom?.bodyText || '')
    const visible_elements = Number(dom?.visibleElementCount || 0)
    const root = dom?.root && typeof dom.root === 'object' ? (dom.root as Record<string, unknown>) : null
    const blank_page = !body_text && visible_elements === 0 && Number(root?.childCount || 0) === 0

    return {
      ok:
        !load_failure &&
        !blocked_navigation &&
        !dom_error &&
        console_errors.length === 0 &&
        network_state.blocked_requests.length === 0 &&
        network_state.failed_requests.length === 0,
      requestedUrl: url,
      finalUrl: web_contents.getURL() || url,
      title: web_contents.getTitle() || '',
      loadFailure: load_failure,
      blockedNavigation: blocked_navigation || null,
      console: console_messages,
      consoleErrors: console_errors,
      blockedRequests: network_state.blocked_requests,
      failedRequests: network_state.failed_requests,
      dom,
      domError: dom_error || null,
      blankPage: blank_page,
      settleMs: settle_ms,
    }
  } catch (error) {
    if (timeout) clearTimeout(timeout)
    return {
      ok: false,
      requestedUrl: url,
      finalUrl: web_contents.isDestroyed() ? url : web_contents.getURL() || url,
      title: web_contents.isDestroyed() ? '' : web_contents.getTitle() || '',
      loadFailure:
        load_failure || {
          code: 0,
          description: error instanceof Error ? error.message : 'Browser inspection failed.',
          url,
        },
      blockedNavigation: blocked_navigation || null,
      console: console_messages,
      consoleErrors: console_messages.filter((entry) => entry.level.toLowerCase() === 'error'),
      blockedRequests: network_state.blocked_requests,
      failedRequests: network_state.failed_requests,
      dom: null,
      domError: null,
      blankPage: true,
      settleMs: settle_ms,
    }
  } finally {
    browser_inspection_network.delete(web_contents.id)
    if (!web_contents.isDestroyed()) web_contents.close()
  }
}
