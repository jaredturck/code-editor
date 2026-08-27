import { executeTerminalCommand, findFiles, readTextFile } from '@/platform/desktopBridge'

export interface CodeNavigationMatch {
  path: string
  line: number
  content: string
  symbol?: string
  kind?: 'text' | 'definition' | 'reference' | 'file'
}

function text(value: unknown) {
  return String(value || '').trim()
}

function shellQuote(value: string) {
  return `'${String(value || '').replace(/'/g, `'"'"'`)}'`
}

function parseRipgrep(output: unknown, kind: CodeNavigationMatch['kind'], symbol = ''): CodeNavigationMatch[] {
  const raw = typeof output === 'string'
    ? output
    : String((output as any)?.stdout || (output as any)?.output || (output as any)?.text || '')
  return raw
    .split(/\r?\n/)
    .map((line) => {
      const match = line.match(/^(.+?):(\d+):(.*)$/)
      if (!match) return null
      return {
        path: match[1],
        line: Number(match[2]) || 1,
        content: match[3],
        ...(symbol ? { symbol } : {}),
        kind,
      } satisfies CodeNavigationMatch
    })
    .filter((item): item is CodeNavigationMatch => Boolean(item))
}

export async function searchCodeText(
  workspaceRoot: string,
  query: string,
  options: { ignoreCase?: boolean; fixedStrings?: boolean; glob?: string; maxResults?: number } = {},
) {
  const pattern = text(query)
  if (!pattern) return []
  const flags = [
    '--line-number',
    '--no-heading',
    '--color=never',
    options.ignoreCase !== false ? '--ignore-case' : '',
    options.fixedStrings !== false ? '--fixed-strings' : '',
    options.glob ? `--glob ${shellQuote(options.glob)}` : '',
  ]
    .filter(Boolean)
    .join(' ')
  const result = await executeTerminalCommand(`rg ${flags} -- ${shellQuote(pattern)} .`, workspaceRoot)
  return parseRipgrep(result, 'text').slice(0, Math.max(1, Number(options.maxResults) || 100))
}

export async function searchCodeFileNames(workspaceRoot: string, query: string, maxResults = 100) {
  const result = await findFiles(workspaceRoot, query, {
    mode: 'name',
    maxResults: Math.max(1, Math.min(500, Number(maxResults) || 100)),
    fuzzy: true,
  })
  const items = Array.isArray((result as any)?.results)
    ? (result as any).results
    : Array.isArray((result as any)?.matches)
      ? (result as any).matches
      : []
  return items.slice(0, maxResults).map((item: any) => ({
    path: String(item.path || item.file || item),
    line: 1,
    content: '',
    kind: 'file' as const,
  }))
}

function definitionPatterns(symbol: string) {
  const escaped = symbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return [
    `(?:function|class|interface|type|enum|const|let|var)\\s+${escaped}\\b`,
    `(?:def|class)\\s+${escaped}\\b`,
    `(?:struct|trait|enum|fn|type)\\s+${escaped}\\b`,
    `(?:func|type)\\s+${escaped}\\b`,
    `(?:public|private|protected|static|async|export|default|abstract|readonly|final|sealed|internal|open|override|virtual|partial|extern|unsafe|new|inline|pub|mut|const|let|var|function|class|interface|type|enum|def|fn|func|struct|trait)\\b[^\\n]{0,100}\\b${escaped}\\b`,
  ]
}

export async function findCodeDefinition(workspaceRoot: string, symbolInput: string, maxResults = 40) {
  const symbol = text(symbolInput)
  if (!symbol) return []
  const pattern = definitionPatterns(symbol).join('|')
  const result = await executeTerminalCommand(
    `rg --line-number --no-heading --color=never --glob '!node_modules/**' --glob '!dist/**' --glob '!build/**' -e ${shellQuote(pattern)} .`,
    workspaceRoot,
  )
  return parseRipgrep(result, 'definition', symbol).slice(0, maxResults)
}

export async function findCodeReferences(workspaceRoot: string, symbolInput: string, maxResults = 120) {
  const symbol = text(symbolInput)
  if (!symbol) return []
  const escaped = symbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const result = await executeTerminalCommand(
    `rg --line-number --no-heading --color=never --glob '!node_modules/**' --glob '!dist/**' --glob '!build/**' -e ${shellQuote(`\\b${escaped}\\b`)} .`,
    workspaceRoot,
  )
  return parseRipgrep(result, 'reference', symbol).slice(0, maxResults)
}

export async function readCodeRange(path: string, startLine = 1, lineCount = 240) {
  return readTextFile(path, {
    startLine: Math.max(1, Number(startLine) || 1),
    lineCount: Math.max(1, Math.min(2000, Number(lineCount) || 240)),
  })
}

export async function navigateCode(
  workspaceRoot: string,
  request:
    | { kind: 'text'; query: string; maxResults?: number }
    | { kind: 'files'; query: string; maxResults?: number }
    | { kind: 'definition'; symbol: string; maxResults?: number }
    | { kind: 'references'; symbol: string; maxResults?: number },
) {
  if (request.kind === 'files') return searchCodeFileNames(workspaceRoot, request.query, request.maxResults)
  if (request.kind === 'definition') return findCodeDefinition(workspaceRoot, request.symbol, request.maxResults)
  if (request.kind === 'references') return findCodeReferences(workspaceRoot, request.symbol, request.maxResults)
  return searchCodeText(workspaceRoot, request.query, { maxResults: request.maxResults })
}
