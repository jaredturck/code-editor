const simpleCommands = new Set(['pwd', 'ls', 'cat', 'head', 'tail', 'stat', 'file', 'wc', 'tree', 'which', 'grep'])

const safeGitSubcommands = new Set(['status', 'diff', 'log', 'show', 'rev-parse', 'ls-files', 'grep', 'blame'])

const unsafeFindOptions = new Set([
  '-delete',
  '-exec',
  '-execdir',
  '-ok',
  '-okdir',
  '-fprint',
  '-fprint0',
  '-fprintf',
  '-fls',
])

const unsafeFdOptions = new Set(['-x', '--exec', '-X', '--exec-batch'])
const unsafeRgOptions = new Set(['--pre', '--pre-glob'])
const unsafeGitOptions = new Set([
  '--exec-path',
  '--config-env',
  '--paginate',
  '-p',
  '--ext-diff',
  '--textconv',
  '--no-index',
])

function splitWords(command: string) {
  const words: string[] = []
  let current = ''
  let quote = ''
  let escaped = false

  for (const char of command) {
    if (escaped) {
      current += char
      escaped = false
      continue
    }
    if (char === '\\' && quote !== "'") {
      escaped = true
      continue
    }
    if (quote) {
      if (char === quote) quote = ''
      else current += char
      continue
    }
    if (char === '"' || char === "'") {
      quote = char
      continue
    }
    if (/\s/.test(char)) {
      if (current) {
        words.push(current)
        current = ''
      }
      continue
    }
    current += char
  }

  if (escaped || quote) return null
  if (current) words.push(current)
  return words
}

function hasAny(words: string[], blocked: Set<string>) {
  return words.some((word) => blocked.has(word) || [...blocked].some((item) => word.startsWith(`${item}=`)))
}

function pathValueEscapesWorkspace(value: string) {
  const normalized = value.replace(/\\/g, '/')
  return (
    normalized.startsWith('/') ||
    normalized.startsWith('~/') ||
    /^[A-Za-z]:\//.test(normalized) ||
    normalized === '..' ||
    normalized.startsWith('../') ||
    normalized.includes('/../')
  )
}

function escapesWorkspace(words: string[]) {
  return words.slice(1).some((word) => {
    if (!word) return false
    const value = word.startsWith('-') && word.includes('=') ? word.slice(word.indexOf('=') + 1) : word
    return pathValueEscapesWorkspace(value)
  })
}

function commandName(value: string) {
  const clean = value.replace(/\\/g, '/')
  return clean.slice(clean.lastIndexOf('/') + 1)
}

function safeGit(words: string[]) {
  const args = words.slice(1)
  let index = 0
  while (index < args.length && args[index].startsWith('-')) {
    if (unsafeGitOptions.has(args[index])) return false
    if (args[index] === '-C' || args[index] === '--git-dir' || args[index] === '--work-tree') return false
    index += 1
  }
  const subcommand = args[index]
  if (!subcommand || !safeGitSubcommands.has(subcommand)) return false
  const rest = args.slice(index + 1)
  if (hasAny(rest, unsafeGitOptions)) return false
  if (subcommand === 'diff' && rest.some((word) => word === '--output' || word.startsWith('--output='))) return false
  return true
}

/**
 * Conservative classifier for terminal commands that only inspect the current project.
 * False negatives merely keep the normal approval prompt; false positives would weaken safety,
 * so shell composition, redirection, execution hooks, network/package tools and interpreters are
 * intentionally outside this allowlist.
 */
export function isReadOnlyWorkspaceCommand(command: unknown) {
  const text = String(command || '').trim()
  if (!text || text.length > 4000) return false
  if (/[\r\n;|<>`]/.test(text) || /&&|\|\||\$\(/.test(text)) return false

  const words = splitWords(text)
  if (!words?.length) return false
  const name = commandName(words[0])
  if (escapesWorkspace(words)) return false

  if (simpleCommands.has(name)) return true
  if (name === 'command') return words.length >= 3 && words[1] === '-v'
  if (name === 'rg') return !hasAny(words.slice(1), unsafeRgOptions)
  if (name === 'fd') return !hasAny(words.slice(1), unsafeFdOptions)
  if (name === 'find') return !hasAny(words.slice(1), unsafeFindOptions)
  if (name === 'git') return safeGit(words)

  return false
}
