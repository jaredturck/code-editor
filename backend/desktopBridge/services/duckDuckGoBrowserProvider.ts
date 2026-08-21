/**
 * Holds the optional Electron-owned DuckDuckGo browser search callback used by the local
 * bridge. The bridge remains Electron-agnostic: it only sees a typed function that returns
 * normalized search-engine result cards.
 */

export type DuckDuckGoSearchMode = 'browser' | 'legacy' | 'auto';

export interface DuckDuckGoBrowserProgressEvent {
  type: string;
  message: string;
  current?: number;
  total?: number;
  detail?: Record<string, unknown>;
}

export interface DuckDuckGoBrowserSearchRequest {
  query: string;
  maxResults: number;
  safeSearch: string;
  timeRange: string;
  locale: string;
  region: string;
  signal?: AbortSignal;
  onProgress?: (event: DuckDuckGoBrowserProgressEvent) => void;
}

export interface DuckDuckGoBrowserSearchResult {
  title: string;
  url: string;
  hostname?: string;
  snippet?: string;
}

export interface DuckDuckGoBrowserSearchResponse {
  results: DuckDuckGoBrowserSearchResult[];
  relatedQueries?: string[];
  pageUrl?: string;
  elapsedMs?: number;
  cacheHit?: boolean;
}

export type DuckDuckGoBrowserSearch = (
  request: DuckDuckGoBrowserSearchRequest,
) => Promise<DuckDuckGoBrowserSearchResponse>;

interface DuckDuckGoBrowserRegistration {
  id: symbol;
  mode: DuckDuckGoSearchMode;
  search: DuckDuckGoBrowserSearch | null;
}

let activeRegistration: DuckDuckGoBrowserRegistration = {
  id: Symbol('duckduckgo-unconfigured'),
  mode: 'legacy',
  search: null,
};

/** Converts a caller-supplied mode into the three supported transport choices. */
export function normalizeDuckDuckGoSearchMode(
  value: unknown,
  fallback: DuckDuckGoSearchMode = 'browser',
): DuckDuckGoSearchMode {
  const normalized = String(value || '')
    .trim()
    .toLowerCase();
  if (normalized === 'browser' || normalized === 'legacy' || normalized === 'auto') {
    return normalized;
  }
  return fallback;
}

/**
 * Registers one Electron browser callback for the lifetime of a bridge server. The returned
 * cleanup only clears the registration it created, which keeps overlapping test fixtures safe.
 */
export function configureDuckDuckGoBrowserProvider(options: {
  search?: DuckDuckGoBrowserSearch | null;
  mode?: DuckDuckGoSearchMode | string;
}): () => void {
  const registration: DuckDuckGoBrowserRegistration = {
    id: Symbol('duckduckgo-browser-registration'),
    mode: normalizeDuckDuckGoSearchMode(options.mode, options.search ? 'browser' : 'legacy'),
    search: typeof options.search === 'function' ? options.search : null,
  };
  activeRegistration = registration;

  return () => {
    if (activeRegistration.id !== registration.id) return;
    activeRegistration = {
      id: Symbol('duckduckgo-unconfigured'),
      mode: 'legacy',
      search: null,
    };
  };
}

/** Returns transport availability without exposing the retained callback. */
export function getDuckDuckGoBrowserProviderState(): {
  available: boolean;
  mode: DuckDuckGoSearchMode;
} {
  return {
    available: Boolean(activeRegistration.search),
    mode: activeRegistration.mode,
  };
}

/** Executes the currently registered Electron browser search callback. */
export async function searchDuckDuckGoWithBrowser(
  request: DuckDuckGoBrowserSearchRequest,
): Promise<DuckDuckGoBrowserSearchResponse> {
  const search = activeRegistration.search;
  if (!search) {
    const error = new Error(
      'DuckDuckGo browser search is unavailable because the Electron browser provider was not registered.',
    ) as Error & { statusCode?: number; code?: string };
    error.statusCode = 503;
    error.code = 'DDG_BROWSER_UNAVAILABLE';
    throw error;
  }

  return search({
    query: String(request.query || '')
      .trim()
      .slice(0, 600),
    maxResults: Math.max(1, Math.min(20, Math.round(Number(request.maxResults) || 8))),
    safeSearch: String(request.safeSearch || 'moderate').toLowerCase(),
    timeRange: String(request.timeRange || 'all').toLowerCase(),
    locale: String(request.locale || 'en-us').toLowerCase(),
    region: String(request.region || 'wt-wt').toLowerCase(),
    signal: request.signal,
    onProgress: request.onProgress,
  });
}
