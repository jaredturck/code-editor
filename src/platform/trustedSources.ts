/**
 * trustedSources.js
 *
 * A curated registry of trusted "link databases" / reference sources, plus
 * lookupTrustedSources() — the resolver behind the agent's `sources.lookup` tool.
 *
 * Why this exists: the agent was guessing URLs when it needed external facts. This
 * registry gives it a vetted set of authoritative sources per topic kind (an
 * encyclopedia, scholarly indexes, code/docs, package registries, dictionaries,
 * government/open data, books, news) together with a ready-to-use search URL and,
 * where one exists, a keyless JSON API endpoint. The tool only RESOLVES targets —
 * the agent still fetches them with the existing methods (search.web / web.fetch /
 * a curl in terminal.exec), all of which remain subject to the web access guard.
 *
 * Endpoint patterns were checked against each source's live docs (2026-06). `{q}`
 * is replaced with the URL-encoded query; entries that need a key are flagged so the
 * agent can fall back to the human-facing search URL instead.
 */

export type SourceKind =
  'encyclopedia' | 'scholarly' | 'code' | 'docs' | 'package' | 'reference' | 'gov' | 'data' | 'books' | 'news'

export interface TrustedSource {
  id: string
  name: string
  kinds: SourceKind[]
  domains: string[]
  summary: string
  search?: string
  api?: string
  requiresKey?: boolean
  noJs: boolean
}

export interface TrustedSourceTarget {
  id: string
  name: string
  kinds: SourceKind[]
  domains: string[]
  summary: string
  searchUrl?: string
  apiUrl?: string
  noJs: boolean
  requiresKey: boolean
}

export interface TrustedSourceLookupOptions {
  kind?: SourceKind | string
  limit?: number
}

export interface TrustedSourceLookupResult {
  topic: string
  kind: string | null
  availableKinds?: SourceKind[]
  count?: number
  sources: TrustedSourceTarget[]
  error?: string
  usage?: string
}

const TRUSTED_SOURCES: TrustedSource[] = [
  // ── Encyclopedia / general facts ───────────────────────────────────────────
  {
    id: 'wikipedia',
    name: 'Wikipedia',
    kinds: ['encyclopedia', 'reference'],
    domains: ['en.wikipedia.org', 'wikipedia.org'],
    summary: 'Free encyclopedia — the default for general background, definitions, people, places, events.',
    search: 'https://en.wikipedia.org/w/index.php?search={q}',
    // OpenSearch (keyless, curl-friendly) returns title/desc/url tuples; REST summary
    // gives a one-paragraph extract per title.
    api: 'https://en.wikipedia.org/w/api.php?action=opensearch&format=json&limit=10&search={q}',
    noJs: true,
  },
  {
    id: 'wikidata',
    name: 'Wikidata',
    kinds: ['data', 'reference', 'encyclopedia'],
    domains: ['wikidata.org', 'www.wikidata.org'],
    summary: 'Structured facts (entities, identifiers, properties) — good for precise attributes and IDs.',
    search: 'https://www.wikidata.org/w/index.php?search={q}',
    api: 'https://www.wikidata.org/w/api.php?action=wbsearchentities&format=json&language=en&limit=10&search={q}',
    noJs: true,
  },
  {
    id: 'britannica',
    name: 'Encyclopaedia Britannica',
    kinds: ['encyclopedia', 'reference'],
    domains: ['britannica.com', 'www.britannica.com'],
    summary: 'Editorially reviewed encyclopedia — a second authoritative source to cross-check Wikipedia.',
    search: 'https://www.britannica.com/search?query={q}',
    noJs: false,
  },

  // ── Scholarly / research ───────────────────────────────────────────────────
  {
    id: 'arxiv',
    name: 'arXiv',
    kinds: ['scholarly'],
    domains: ['arxiv.org', 'export.arxiv.org'],
    summary: 'Open preprints (CS, physics, math, stats) — primary source for recent research papers.',
    search: 'https://arxiv.org/abs/?searchtype=all&query={q}',
    api: 'http://export.arxiv.org/api/query?search_query=all:{q}&max_results=10',
    noJs: true,
  },
  {
    id: 'semantic-scholar',
    name: 'Semantic Scholar',
    kinds: ['scholarly'],
    domains: ['semanticscholar.org', 'api.semanticscholar.org'],
    summary: 'Academic graph across all fields — keyless relevance search with abstracts.',
    search: 'https://www.semanticscholar.org/search?q={q}',
    api: 'https://api.semanticscholar.org/graph/v1/paper/search?limit=10&fields=title,abstract,url,year,authors&query={q}',
    noJs: true,
  },
  {
    id: 'crossref',
    name: 'Crossref',
    kinds: ['scholarly'],
    domains: ['crossref.org', 'api.crossref.org'],
    summary: 'DOI metadata for the scholarly record — resolve a paper/DOI to authoritative metadata.',
    search: 'https://search.crossref.org/?q={q}',
    api: 'https://api.crossref.org/works?rows=10&query={q}',
    noJs: true,
  },
  {
    id: 'openalex',
    name: 'OpenAlex',
    kinds: ['scholarly', 'data'],
    domains: ['openalex.org', 'api.openalex.org'],
    summary: 'Open index of works, authors, venues — broad scholarly coverage (free key / mailto polite pool).',
    search: 'https://openalex.org/works?search={q}',
    api: 'https://api.openalex.org/works?search={q}',
    requiresKey: true,
    noJs: true,
  },
  {
    id: 'pubmed',
    name: 'PubMed (NCBI)',
    kinds: ['scholarly'],
    domains: ['pubmed.ncbi.nlm.nih.gov', 'eutils.ncbi.nlm.nih.gov'],
    summary: 'Biomedical literature — the authoritative index for medicine and life sciences.',
    search: 'https://pubmed.ncbi.nlm.nih.gov/?term={q}',
    api: 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&retmode=json&retmax=10&term={q}',
    noJs: true,
  },

  // ── Code / Q&A / developer docs ────────────────────────────────────────────
  {
    id: 'mdn',
    name: 'MDN Web Docs',
    kinds: ['docs', 'code'],
    domains: ['developer.mozilla.org'],
    summary: 'Authoritative web-platform docs (HTML/CSS/JS/Web APIs).',
    search: 'https://developer.mozilla.org/en-US/search?q={q}',
    noJs: false,
  },
  {
    id: 'stackoverflow',
    name: 'Stack Overflow',
    kinds: ['code'],
    domains: ['stackoverflow.com', 'api.stackexchange.com'],
    summary: 'Programming Q&A — real-world error/usage answers; keyless Stack Exchange search API.',
    search: 'https://stackoverflow.com/search?q={q}',
    api: 'https://api.stackexchange.com/2.3/search/advanced?order=desc&sort=relevance&site=stackoverflow&q={q}',
    noJs: true,
  },
  {
    id: 'devdocs',
    name: 'DevDocs',
    kinds: ['docs', 'code'],
    domains: ['devdocs.io'],
    summary: 'Aggregated API documentation for many languages/libraries in one place.',
    search: 'https://devdocs.io/#q={q}',
    noJs: false,
  },
  {
    id: 'github',
    name: 'GitHub',
    kinds: ['code'],
    domains: ['github.com', 'api.github.com'],
    summary: 'Source code and repositories — find implementations, examples, issues (REST search is rate-limited).',
    search: 'https://github.com/search?type=repositories&q={q}',
    api: 'https://api.github.com/search/repositories?per_page=10&q={q}',
    noJs: true,
  },

  // ── Package registries ─────────────────────────────────────────────────────
  {
    id: 'npm',
    name: 'npm registry',
    kinds: ['package', 'code'],
    domains: ['npmjs.com', 'www.npmjs.com', 'registry.npmjs.org'],
    summary: 'JavaScript/Node packages — keyless search + per-package metadata.',
    search: 'https://www.npmjs.com/search?q={q}',
    api: 'https://registry.npmjs.org/-/v1/search?size=10&text={q}',
    noJs: true,
  },
  {
    id: 'pypi',
    name: 'PyPI',
    kinds: ['package', 'code'],
    domains: ['pypi.org'],
    summary: 'Python packages — per-package JSON at /pypi/<name>/json.',
    search: 'https://pypi.org/search/?q={q}',
    noJs: false,
  },
  {
    id: 'crates',
    name: 'crates.io',
    kinds: ['package', 'code'],
    domains: ['crates.io'],
    summary: 'Rust packages — keyless search API.',
    search: 'https://crates.io/search?q={q}',
    api: 'https://crates.io/api/v1/crates?per_page=10&q={q}',
    noJs: true,
  },

  // ── Dictionary / reference ─────────────────────────────────────────────────
  {
    id: 'wiktionary',
    name: 'Wiktionary',
    kinds: ['reference'],
    domains: ['en.wiktionary.org'],
    summary: 'Multilingual dictionary — definitions, etymology, pronunciation.',
    search: 'https://en.wiktionary.org/w/index.php?search={q}',
    api: 'https://en.wiktionary.org/w/api.php?action=opensearch&format=json&limit=10&search={q}',
    noJs: true,
  },
  {
    id: 'dictionaryapi',
    name: 'Free Dictionary API',
    kinds: ['reference'],
    domains: ['api.dictionaryapi.dev'],
    summary: 'Keyless English dictionary JSON — definitions/synonyms for a single word.',
    api: 'https://api.dictionaryapi.dev/api/v2/entries/en/{q}',
    noJs: true,
  },

  // ── Government / open data ─────────────────────────────────────────────────
  {
    id: 'data-gov',
    name: 'Data.gov',
    kinds: ['gov', 'data'],
    domains: ['catalog.data.gov', 'data.gov'],
    summary: 'US government open-data catalog — official datasets and publications.',
    search: 'https://catalog.data.gov/dataset?q={q}',
    api: 'https://catalog.data.gov/api/3/action/package_search?rows=10&q={q}',
    noJs: true,
  },
  {
    id: 'worldbank',
    name: 'World Bank Open Data',
    kinds: ['data', 'gov'],
    domains: ['data.worldbank.org', 'api.worldbank.org'],
    summary: 'Global development indicators — authoritative country/economic statistics.',
    search: 'https://data.worldbank.org/?q={q}',
    noJs: false,
  },
  {
    id: 'our-world-in-data',
    name: 'Our World in Data',
    kinds: ['data'],
    domains: ['ourworldindata.org'],
    summary: 'Research-grade charts and datasets on global problems (health, climate, economics).',
    search: 'https://ourworldindata.org/search?q={q}',
    noJs: false,
  },

  // ── Books ──────────────────────────────────────────────────────────────────
  {
    id: 'openlibrary',
    name: 'Open Library',
    kinds: ['books', 'reference'],
    domains: ['openlibrary.org'],
    summary: 'Open catalog of books — keyless search.json with rich metadata.',
    search: 'https://openlibrary.org/search?q={q}',
    api: 'https://openlibrary.org/search.json?limit=10&q={q}',
    noJs: true,
  },

  // ── News (trusted wire services) ───────────────────────────────────────────
  {
    id: 'ap-news',
    name: 'AP News',
    kinds: ['news'],
    domains: ['apnews.com'],
    summary: 'Associated Press — trusted wire reporting for current events.',
    search: 'https://apnews.com/search?q={q}',
    noJs: false,
  },
  {
    id: 'reuters',
    name: 'Reuters',
    kinds: ['news'],
    domains: ['reuters.com', 'www.reuters.com'],
    summary: 'Reuters — trusted wire reporting for current events.',
    search: 'https://www.reuters.com/site-search/?query={q}',
    noJs: false,
  },
]

// When a caller asks for a kind, also offer these closely-related kinds.
const KIND_SYNONYMS: Record<string, SourceKind[]> = {
  docs: ['docs', 'code'],
  code: ['code', 'docs', 'package'],
  package: ['package', 'code'],
  encyclopedia: ['encyclopedia', 'reference'],
  reference: ['reference', 'encyclopedia'],
  scholarly: ['scholarly', 'data'],
  data: ['data', 'gov', 'scholarly'],
  gov: ['gov', 'data'],
  books: ['books', 'reference'],
  news: ['news'],
}

// Default mix when no kind is given — a broad, high-signal set.
const DEFAULT_KINDS: SourceKind[] = ['encyclopedia', 'scholarly', 'code', 'docs', 'reference']

// Fills template from the supplied values without changing the source template.
function fillTemplate(template: string | undefined, query: string): string | undefined {
  if (!template) return undefined
  return template.replace(/\{q\}/g, encodeURIComponent(query))
}

/** All distinct kinds the registry covers (for tool help / UI). */
export function trustedSourceKinds(): SourceKind[] {
  const set = new Set<SourceKind>()
  for (const s of TRUSTED_SOURCES) for (const k of s.kinds) set.add(k)
  return [...set].sort()
}

/**
 * Resolve trusted sources for a topic. Returns ready-to-use targets (a human
 * search URL and, where available, a keyless JSON API URL) — the caller fetches
 * them with the existing tools; this never makes a network request itself.
 *
 * @param {string} topic
 * @param {{ kind?: SourceKind|string, limit?: number }} [options]
 */
export function lookupTrustedSources(
  topic: string,
  options: TrustedSourceLookupOptions = {},
): TrustedSourceLookupResult {
  const query = String(topic || '').trim()
  if (!query) {
    return {
      topic: '',
      kind: null,
      sources: [],
      error: 'A non-empty topic is required.',
    }
  }

  const requestedKind = String(options.kind || '')
    .trim()
    .toLowerCase()
  const limit = Math.max(1, Math.min(20, Number(options.limit) || 8))

  const wantedKinds = requestedKind ? KIND_SYNONYMS[requestedKind] || [requestedKind] : DEFAULT_KINDS
  const wanted = new Set<string>(wantedKinds)

  // Primary kind first, then related, preserving registry order within each tier.
  const scored = TRUSTED_SOURCES.map((s) => {
    const exact = requestedKind && s.kinds.some((kind) => kind === requestedKind)
    const related = s.kinds.some((k) => wanted.has(k))
    return { s, rank: exact ? 0 : related ? 1 : 2 }
  })
    .filter((e) => e.rank < 2)
    .sort((a, b) => a.rank - b.rank)

  const sources = scored.slice(0, limit).map(({ s }) => ({
    id: s.id,
    name: s.name,
    kinds: s.kinds,
    domains: s.domains,
    summary: s.summary,
    searchUrl: fillTemplate(s.search, query),
    apiUrl: fillTemplate(s.api, query),
    noJs: Boolean(s.noJs),
    requiresKey: Boolean(s.requiresKey),
  }))

  return {
    topic: query,
    kind: requestedKind || null,
    availableKinds: trustedSourceKinds(),
    count: sources.length,
    sources,
    usage:
      'These are vetted source targets, not results. Fetch the apiUrl (keyless JSON, prefer for noJs sources) or searchUrl with web.fetch / search.web / curl — all still subject to the web access guard.',
  }
}

export { TRUSTED_SOURCES }
