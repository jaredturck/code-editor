/**
 * Renderer-side activity logger.
 *
 * Thin, passive facade over the desktop bridge's `log` channel. Everything is
 * fire-and-forget so logging can never block the UI or the agent loop:
 *  - structured helpers (logInfo / logWarn / logError / logEvent / logAI),
 *  - global capture of uncaught errors + unhandled promise rejections (this is
 *    what surfaces runtime "undefined value" UI crashes with a full stack trace),
 *  - a non-intrusive mirror of console.* so existing logging flows into the file.
 *
 * In a plain browser (no desktop shell) the forwarder is a no-op and the original
 * console behaviour is untouched.
 */

import { redactSensitiveData, redactSensitiveText } from '@/platform/security';

export type LogLevel = 'debug' | 'info' | 'ai' | 'event' | 'warn' | 'error';

export interface LogEntry {
  level: LogLevel;
  scope: string;
  message: string;
  data?: unknown;
  at: number;
}

let installed = false;

// Forwards one sanitized renderer log entry to Electron when the desktop logger is available.
function bridgeLog(): ((payload: LogEntry | LogEntry[]) => void) | null {
  if (typeof window === 'undefined') return null;
  const fn = (window.orbitDesktop as unknown as { log?: (p: unknown) => void } | undefined)?.log;
  return typeof fn === 'function' ? (fn as (payload: LogEntry | LogEntry[]) => void) : null;
}

// Trim very large payloads so the log file stays readable and writes stay cheap.
function clampData(data: unknown): unknown {
  if (data === undefined || data === null) return undefined;
  try {
    const text = typeof data === 'string' ? data : JSON.stringify(data);
    if (text.length <= 2000) return data;
    return `${text.slice(0, 2000)}…[+${text.length - 2000} chars]`;
  } catch {
    return String(data);
  }
}

// Records log through the sanitized application logger.
export function log(level: LogLevel, scope: string, message: string, data?: unknown): void {
  const forward = bridgeLog();
  if (!forward) return;
  try {
    forward({
      level,
      scope: redactSensitiveText(scope || 'renderer').slice(0, 80),
      message: redactSensitiveText(message),
      data: clampData(redactSensitiveData(data)),
      at: Date.now(),
    });
  } catch {
    /* logging must never throw into callers */
  }
}

// Records info through the sanitized application logger.
export const logInfo = (scope: string, message: string, data?: unknown) =>
  log('info', scope, message, data);
// Records warn through the sanitized application logger.
export const logWarn = (scope: string, message: string, data?: unknown) =>
  log('warn', scope, message, data);
// Records error through the sanitized application logger.
export const logError = (scope: string, message: string, data?: unknown) =>
  log('error', scope, message, data);
// Records event through the sanitized application logger.
export const logEvent = (scope: string, message: string, data?: unknown) =>
  log('event', scope, message, data);
// Records AI through the sanitized application logger.
export const logAI = (message: string, data?: unknown) => log('ai', 'ai', message, data);

/** Open the local terminal streaming the live session log (orb "Show Logs"). */
export async function showLogs(): Promise<{
  ok: boolean;
  error?: string;
  file?: string;
  terminal?: string;
} | null> {
  if (typeof window === 'undefined') return null;
  const fn = (window.orbitDesktop as unknown as { showLogs?: () => Promise<unknown> } | undefined)
    ?.showLogs;
  if (typeof fn !== 'function')
    return { ok: false, error: 'Logs are only available in the desktop app.' };
  try {
    return (await fn()) as { ok: boolean; error?: string; file?: string; terminal?: string };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Failed to open logs.' };
  }
}

// Installs global error and rejection handlers so renderer failures reach the session log.
function captureGlobalErrors(): void {
  if (typeof window === 'undefined') return;

  window.addEventListener('error', (event) => {
    const err = event.error;
    logError('renderer', `Uncaught: ${event.message || (err && err.message) || 'error'}`, {
      source: event.filename ? `${event.filename}:${event.lineno}:${event.colno}` : undefined,
      stack: err instanceof Error ? err.stack : undefined,
    });
  });

  window.addEventListener('unhandledrejection', (event) => {
    const reason = (event as PromiseRejectionEvent).reason;
    logError(
      'renderer',
      `Unhandled rejection: ${reason instanceof Error ? reason.message : String(reason)}`,
      {
        stack: reason instanceof Error ? reason.stack : undefined,
      },
    );
  });
}

// Mirror console.* into the session log without changing its visible behaviour.
// A re-entrancy guard prevents the forwarder's own work from recursing.
function mirrorConsole(): void {
  if (typeof console === 'undefined') return;
  const methods: Array<[keyof Console, LogLevel]> = [
    ['log', 'info'],
    ['info', 'info'],
    ['warn', 'warn'],
    ['error', 'error'],
    ['debug', 'debug'],
  ];
  let inside = false;
  for (const [method, level] of methods) {
    const original = console[method] as (...args: unknown[]) => void;
    if (typeof original !== 'function') continue;
    (console[method] as unknown) = (...args: unknown[]) => {
      if (!inside) {
        inside = true;
        try {
          const text = args
            .map((a) =>
              typeof a === 'string'
                ? a
                : (() => {
                    try {
                      return JSON.stringify(a);
                    } catch {
                      return String(a);
                    }
                  })(),
            )
            .join(' ');
          log(level, 'renderer', text);
        } catch {
          /* non-fatal */
        } finally {
          inside = false;
        }
      }
      original(...args);
    };
  }
}

/**
 * Install global error capture + console mirroring. Idempotent; safe to call
 * before the desktop bridge exists (entries simply no-op until it does).
 */
export function initRendererLogger(): void {
  if (installed) return;
  installed = true;
  try {
    captureGlobalErrors();
    mirrorConsole();
    logEvent('renderer', 'Renderer logger attached', {
      ua: typeof navigator !== 'undefined' ? navigator.userAgent : '',
    });
  } catch {
    /* never block startup on logging */
  }
}
