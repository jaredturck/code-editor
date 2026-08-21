/**
 * Pure DuckDuckGo URL construction and DOM extraction helpers. This module intentionally has
 * no Electron dependency so selector behavior can be covered by ordinary jsdom tests.
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
  hostname: string;
  snippet: string;
}

export interface ExtractedDuckDuckGoPage {
  results?: DuckDuckGoBrowserSearchResult[];
  relatedQueries?: string[];
  challenge?: boolean;
  bodyText?: string;
  pageUrl?: string;
}

/** Resolves the environment switch used to fall back to the retained legacy implementation. */
export function resolveDuckDuckGoSearchMode(value: unknown): DuckDuckGoSearchMode {
  const normalized = String(value || '')
    .trim()
    .toLowerCase();
  if (normalized === 'legacy' || normalized === 'auto' || normalized === 'browser') {
    return normalized;
  }
  return 'browser';
}

/** Builds the normal DuckDuckGo web-results URL using the existing IRIS search settings. */
export function buildDuckDuckGoSearchUrl(request: DuckDuckGoBrowserSearchRequest): string {
  const query = String(request.query || '')
    .trim()
    .slice(0, 600);
  if (!query) throw new Error('A DuckDuckGo search query is required.');

  const target = new URL('https://duckduckgo.com/');
  target.searchParams.set('q', query);
  target.searchParams.set('ia', 'web');

  const region = String(request.region || '')
    .trim()
    .toLowerCase();
  if (region && region !== 'wt-wt') target.searchParams.set('kl', region);

  const safeSearch = String(request.safeSearch || 'moderate').toLowerCase();
  target.searchParams.set('kp', safeSearch === 'strict' ? '1' : safeSearch === 'off' ? '-2' : '-1');

  const timeRange = String(request.timeRange || 'all').toLowerCase();
  const dateFilter =
    timeRange === 'day'
      ? 'd'
      : timeRange === 'week'
        ? 'w'
        : timeRange === 'month'
          ? 'm'
          : timeRange === 'year'
            ? 'y'
            : '';
  if (dateFilter) target.searchParams.set('df', dateFilter);

  return target.toString();
}

/**
 * Runs inside DuckDuckGo's rendered page. It deliberately relies on semantic data attributes
 * and HTML structure rather than generated class names. Chromium has already parsed the HTML,
 * so the function returns only title, URL, hostname, and snippet fields.
 */
export function extractDuckDuckGoPage(
  maxResults: number,
  timeoutMs: number,
): Promise<ExtractedDuckDuckGoPage> {
  const normalizeText = (value: unknown, limit: number): string =>
    String(value || '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, limit);

  const normalizeResultUrl = (value: unknown): string => {
    try {
      const parsed = new URL(String(value || ''), window.location.href);
      if (parsed.hostname === 'duckduckgo.com' || parsed.hostname.endsWith('.duckduckgo.com')) {
        const redirected = parsed.searchParams.get('uddg');
        if (redirected) return normalizeResultUrl(decodeURIComponent(redirected));
        return '';
      }
      return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.toString() : '';
    } catch {
      return '';
    }
  };

  const collect = (): ExtractedDuckDuckGoPage => {
    const primaryCards = Array.from(
      document.querySelectorAll(
        '[data-testid="mainline"] li[data-layout="organic"] article[data-testid="result"]',
      ),
    );
    const fallbackCards = Array.from(
      document.querySelectorAll(
        '[data-testid="mainline"] article[data-testid="result"][data-nrn="result"]',
      ),
    ).filter((card) => card.closest('li[data-layout="ad"]') === null);
    const cards = primaryCards.length ? primaryCards : fallbackCards;
    const seen = new Set<string>();
    const results: DuckDuckGoBrowserSearchResult[] = [];

    for (const card of cards) {
      if (card.getAttribute('data-testid') === 'ad') continue;
      const titleLink = card.querySelector<HTMLAnchorElement>(
        'a[data-testid="result-title-a"][href]',
      );
      const displayLink = card.querySelector<HTMLAnchorElement>(
        'a[data-testid="result-extras-url-link"][href]',
      );
      const url = normalizeResultUrl(titleLink?.href || displayLink?.href);
      const title = normalizeText(titleLink?.textContent, 260);
      if (!url || !title || seen.has(url)) continue;

      let hostname = '';
      try {
        hostname = new URL(url).hostname;
      } catch {
        hostname = '';
      }

      const snippetNode = card.querySelector('[data-result="snippet"]');
      const snippet = normalizeText(snippetNode?.textContent, 520);
      seen.add(url);
      results.push({ title, url, hostname, snippet });
      if (results.length >= maxResults) break;
    }

    const relatedQueries = Array.from(
      document.querySelectorAll<HTMLAnchorElement>(
        '[data-testid="mainline"] a[href*="?q="][data-testid*="related"], [data-testid="mainline"] [data-testid*="related"] a[href*="?q="]',
      ),
    )
      .map((link) => normalizeText(link.textContent, 120))
      .filter((value, index, list) => Boolean(value) && list.indexOf(value) === index)
      .slice(0, 8);

    const fullBodyText = String(document.body?.innerText || '');
    const lowerBody = fullBodyText.toLowerCase();
    const challenge =
      lowerBody.includes('unfortunately, bots use duckduckgo too') ||
      lowerBody.includes('anomaly detected') ||
      lowerBody.includes('please complete the following challenge');

    return {
      results,
      relatedQueries,
      challenge,
      bodyText: normalizeText(fullBodyText, 700),
      pageUrl: window.location.href,
    };
  };

  return new Promise((resolve) => {
    let settled = false;
    let observer: MutationObserver | null = null;
    let timer = 0;

    const finish = (payload: ExtractedDuckDuckGoPage): void => {
      if (settled) return;
      settled = true;
      observer?.disconnect();
      window.clearTimeout(timer);
      resolve(payload);
    };

    const inspect = (): void => {
      const payload = collect();
      if ((payload.results?.length || 0) > 0 || payload.challenge) finish(payload);
    };

    inspect();
    if (settled) return;

    observer = new MutationObserver(inspect);
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
    });
    timer = window.setTimeout(() => finish(collect()), Math.max(1000, timeoutMs));
  });
}
