const simpleCommands = new Set(['pwd', 'ls', 'cat', 'head', 'tail', 'stat', 'file', 'wc', 'tree', 'which', 'grep'])
const workspaceMutationCommands = new Set(['mkdir', 'touch', 'cp', 'mv', 'rm', 'rmdir'])
const directProjectCommands = new Set(['vite', 'tsc', 'eslint', 'prettier', 'vitest', 'jest', 'pytest', 'ruff'])
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

const hardBlockedPatterns = [
  /(?:^|\s)rm\s+(?:-[^\s]*r[^\s]*f|-[^\s]*f[^\s]*r)\s+(?:\/|\*|~)(?:\s|$)/i,
  /(?:^|\s)rm\s+(?:-[^\s]*r[^\s]*f|-[^\s]*f[^\s]*r)\s+\.?\/?(?:\s|$)/i,
  /\b(?:mkfs(?:\.[a-z0-9]+)?|fdisk|parted|wipefs)\b/i,
  /\bdd\b[^\n]*\bof=\/dev\//i,
  /\b(?:shutdown|reboot|poweroff|halt)\b/i,
  /:\(\)\s*\{\s*:\|:\s*&\s*\}\s*;/,
  /(?:^|[\s"'])~?\/\.ssh(?:\/|\s|$)/i,
  /(?:^|[\s"'])~?\/\.gnupg(?:\/|\s|$)/i,
  /(?:^|[\s"'])\/etc\/(?:shadow|gshadow)(?:\s|$)/i,
]

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

function normalizePath(value: string) {
  return value.replace(/\\/g, '/').replace(/\/+$/, '')
}

export function isWorkspacePath(value: unknown, workspaceRoot: unknown) {
  const root = normalizePath(String(workspaceRoot || '').trim())
  const raw = String(value || '').trim()
  if (!root) return false
  if (!raw || raw === '.' || raw === './') return true

  const normalized = normalizePath(raw)
  if (normalized === '~' || normalized.startsWith('~/')) return false
  if (normalized === '..' || normalized.startsWith('../') || normalized.includes('/../')) return false

  const absolute = normalized.startsWith('/') || /^[A-Za-z]:\//.test(normalized)
  if (!absolute) return true
  return normalized === root || normalized.startsWith(`${root}/`)
}

function stripRedirectionPrefix(value: string) {
  return value.replace(/^\d*(?:>>?|<<?)/, '')
}

function hasOutsideShellExpansion(value: string) {
  if (/`|\$\(/.test(value)) return true
  return /\$(?:[A-Za-z_][A-Za-z0-9_]*|[0-9@*#?!$-]|\{[^}]+\})/.test(value)
}

function argumentEscapesKnownWorkspace(value: string, workspaceRoot: string): boolean {
  if (!value) return false
  let candidate = value.startsWith('-') && value.includes('=') ? value.slice(value.indexOf('=') + 1) : value
  candidate = stripRedirectionPrefix(candidate)
  if (!candidate || candidate === '--') return false
  if (/^https?:\/\//i.test(candidate)) return false
  if (hasOutsideShellExpansion(candidate)) return true

  if (/\s/.test(candidate)) {
    const nested = splitWords(candidate)
    if (nested && nested.length > 1 && nested.some((word) => argumentEscapesKnownWorkspace(word, workspaceRoot))) {
      return true
    }
  }

  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(candidate)) return true
  if (candidate.startsWith('-') && !candidate.includes('=')) return false
  return !isWorkspacePath(candidate, workspaceRoot)
}

function argumentObviouslyEscapesWorkspace(value: string) {
  if (!value) return false
  let candidate = value.startsWith('-') && value.includes('=') ? value.slice(value.indexOf('=') + 1) : value
  candidate = stripRedirectionPrefix(candidate)
  if (!candidate || candidate === '--') return false
  if (/^https?:\/\//i.test(candidate)) return false
  if (hasOutsideShellExpansion(candidate)) return true
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(candidate)) return true
  if (candidate.startsWith('-') && !candidate.includes('=')) return false

  const normalized = normalizePath(candidate)
  if (normalized === '~' || normalized.startsWith('~/')) return true
  if (normalized === '..' || normalized.startsWith('../') || normalized.includes('/../')) return true
  return normalized.startsWith('/') || /^[A-Za-z]:\//.test(normalized)
}

function commandArgumentsEscapeWorkspace(words: string[], workspaceRoot: string) {
  return words.slice(1).some((word) => argumentEscapesKnownWorkspace(word, workspaceRoot))
}

function commandName(value: string) {
  const clean = value.replace(/\\/g, '/')
  return clean.slice(clean.lastIndexOf('/') + 1)
}

function commandMutatesOutsideWorkspace(words: string[]) {
  const name = commandName(String(words[0] || '')).toLowerCase()
  const args = words.slice(1).map((word) => word.toLowerCase())
  const hasGlobalFlag = args.some((word) => word === '-g' || word === '--global' || word === '--system')

  if (['npm', 'pnpm', 'bun'].includes(name) && (hasGlobalFlag || args[0] === 'link')) return true
  if (name === 'yarn' && (hasGlobalFlag || args[0] === 'global')) return true
  if (name === 'cargo' && ['install', 'uninstall'].includes(args[0] || '')) return true
  if (name === 'go' && args[0] === 'install') return true
  if (name === 'uv' && args[0] === 'tool') return true
  if (name === 'pipx' && ['install', 'uninstall', 'upgrade'].includes(args[0] || '')) return true
  if (name === 'gem' && ['install', 'uninstall', 'update'].includes(args[0] || '')) return true
  if (name === 'composer' && args[0] === 'global') return true
  if (name === 'corepack' && ['enable', 'disable'].includes(args[0] || '')) return true
  return false
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

function safePackageManager(name: string, words: string[]) {
  const subcommand = String(words[1] || '').toLowerCase()
  if (words.some((word) => word === '-g' || word === '--global' || word === '--system')) return false

  if (name === 'npm') {
    return ['run', 'test', 'start', 'install', 'i', 'ci', 'create', 'init'].includes(subcommand)
  }
  if (name === 'pnpm') {
    return ['run', 'test', 'start', 'install', 'i', 'add', 'create', 'dlx'].includes(subcommand)
  }
  if (name === 'yarn') {
    return ['run', 'test', 'start', 'install', 'add', 'create'].includes(subcommand)
  }
  if (name === 'bun') {
    return ['run', 'test', 'install', 'add', 'create', 'x'].includes(subcommand)
  }
  return false
}

function safeNpx(words: string[]) {
  const target = String(words[1] || '').toLowerCase()
  return /^(?:create-[a-z0-9@._-]+|vite(?:@[^\s]+)?|tsc|eslint|prettier|vitest|jest)$/.test(target)
}

function safePython(name: string, words: string[]) {
  if (name !== 'python' && name !== 'python3' && name !== 'py') return false
  if (words.some((word) => ['-c', '--command'].includes(word))) return false
  if (words[1] === '-m') return ['pytest', 'venv', 'compileall'].includes(String(words[2] || ''))
  return Boolean(words[1]) && !String(words[1]).startsWith('-')
}

function safeProjectCommand(name: string, words: string[]) {
  if (directProjectCommands.has(name)) return true
  if (workspaceMutationCommands.has(name)) return words.length >= 2
  if (['npm', 'pnpm', 'yarn', 'bun'].includes(name)) return safePackageManager(name, words)
  if (name === 'npx') return safeNpx(words)
  if (safePython(name, words)) return true
  if (name === 'uv') return ['run', 'sync', 'add', 'remove', 'lock', 'venv'].includes(String(words[1] || ''))
  if (name === 'cargo')
    return ['build', 'check', 'test', 'run', 'fmt', 'clippy', 'add', 'remove'].includes(String(words[1] || ''))
  if (name === 'go') return ['build', 'test', 'run', 'fmt', 'vet', 'get', 'mod'].includes(String(words[1] || ''))
  if (name === 'node') {
    return !words.some((word) => ['-e', '--eval', '-p', '--print'].includes(word)) && words.length >= 2
  }
  return false
}

function validSimpleCommand(command: unknown) {
  const text = String(command || '').trim()
  if (!text || text.length > 4000) return null
  if (/[\r\n;|<>`]/.test(text) || /&&|\|\||\$\(/.test(text)) return null
  return splitWords(text)
}

export function isEditorOwnedGitCommand(command: unknown) {
  const words = validSimpleCommand(command)
  if (!words?.length || commandName(words[0]).toLowerCase() !== 'git') return false
  return !safeGit(words)
}

export function isHardBlockedTerminalCommand(command: unknown) {
  const text = String(command || '').trim()
  if (isEditorOwnedGitCommand(text)) return true
  return hardBlockedPatterns.some((pattern) => pattern.test(text))
}

export function terminalCommandEscapesWorkspace(command: unknown, workspaceRoot: unknown, cwd: unknown = '') {
  const root = String(workspaceRoot || '').trim()
  if (!root) return false
  const requestedCwd = String(cwd || '').trim()
  if (requestedCwd && !isWorkspacePath(requestedCwd, root)) return true
  const words = splitWords(String(command || '').trim())
  if (!words?.length) return false
  if (commandMutatesOutsideWorkspace(words)) return true
  return commandArgumentsEscapeWorkspace(words, root)
}

export function isReadOnlyWorkspaceCommand(command: unknown, workspaceRoot: unknown = '', cwd: unknown = '') {
  const words = validSimpleCommand(command)
  if (!words?.length) return false
  const root = String(workspaceRoot || '').trim()
  if (root) {
    if (terminalCommandEscapesWorkspace(command, root, cwd)) return false
  } else if (words.slice(1).some(argumentObviouslyEscapesWorkspace)) {
    return false
  }
  const name = commandName(words[0])

  if (simpleCommands.has(name)) return true
  if (name === 'command') return words.length >= 3 && words[1] === '-v'
  if (name === 'rg') return !hasAny(words.slice(1), unsafeRgOptions)
  if (name === 'fd') return !hasAny(words.slice(1), unsafeFdOptions)
  if (name === 'find') return !hasAny(words.slice(1), unsafeFindOptions)
  if (name === 'git') return safeGit(words)
  return false
}

export function isWorkspaceAutonomousCommand(command: unknown, workspaceRoot: unknown, cwd: unknown = '') {
  if (isHardBlockedTerminalCommand(command)) return false
  if (isReadOnlyWorkspaceCommand(command, workspaceRoot, cwd)) return true

  const words = validSimpleCommand(command)
  if (!words?.length) return false
  const root = String(workspaceRoot || '').trim()
  if (!root || terminalCommandEscapesWorkspace(command, root, cwd)) return false
  return safeProjectCommand(commandName(words[0]), words)
}
