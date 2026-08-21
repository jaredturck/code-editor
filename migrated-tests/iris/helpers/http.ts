/**
 * Provides shared setup or helpers for the http test surface. It keeps test-only behavior
 * separate from production modules.
 */

interface JsonResponseOptions {
  ok?: boolean;
  status?: number;
  statusText?: string;
}

interface FetchMockLike {
  mock: {
    calls: unknown[][];
  };
}

export function jsonResponse<T>(
  data: T,
  { ok = true, status = 200, statusText = '' }: JsonResponseOptions = {},
) {
  return {
    ok,
    status,
    statusText,
    json: async () => data,
    text: async () => (typeof data === 'string' ? data : JSON.stringify(data)),
  };
}

// Parses fetch call into the canonical representation used by the surrounding test scenario.
export function parseFetchCall(fetchMock: FetchMockLike, index = 0) {
  const [url, options = {}] = fetchMock.mock.calls[index] as [string, RequestInit?];
  const headers =
    options.headers instanceof Headers
      ? Object.fromEntries(options.headers.entries())
      : Array.isArray(options.headers)
        ? Object.fromEntries(options.headers)
        : (options.headers as Record<string, string> | undefined);
  return {
    url,
    options: { ...options, headers } as Omit<RequestInit, 'headers'> & {
      headers?: Record<string, string>;
    },
    body: typeof options.body === 'string' ? JSON.parse(options.body) : undefined,
  };
}
