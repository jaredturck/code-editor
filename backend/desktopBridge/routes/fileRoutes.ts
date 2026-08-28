/** Coding-only bridge routes: project files, exact search, terminal, and managed dev process. */
import type { BridgeRequest, BridgeResponse } from '../types.js'
import type { BridgeSecurityContext } from '../shared/bridgeAuthorization.js'
import { requireBridgePermission } from '../shared/bridgeAuthorization.js'
import {
  DEFAULT_FIND_DEPTH,
  DEFAULT_FIND_FUZZY_THRESHOLD,
  DEFAULT_FIND_RESULTS,
  DEFAULT_READ_LINE_COUNT,
  DEFAULT_TREE_DEPTH,
  MAX_READ_CHARS,
  MAX_READ_LINE_COUNT,
  buildTree,
  findFiles,
  fs,
  isBinary,
  parseNumber,
  path,
  readJsonBody,
  resolveFindRootPath,
  runCommand,
  sendJson,
} from '../services/fileService.js'
import {
  getDevEnvironmentStatus,
  startManagedDevEnvironment,
  stopManagedDevEnvironment,
} from '../services/launcherService.js'
import { atomicWriteFile } from '../shared/atomicFile.js'
import { buildUnifiedDiff } from '../shared/unifiedDiff.js'
import {
  resolveDirectoryWithinRoot,
  resolveExistingPathWithinRoot,
  resolveWritablePathWithinRoot,
} from '../shared/filesystemBoundary.js'
import { acquireOperation, operationLimitPayload } from '../shared/operationLimiter.js'

async function handleReadRoutes(
  req: BridgeRequest,
  res: BridgeResponse,
  baseDir: string,
  pathname: string,
  securityContext?: BridgeSecurityContext,
) {
  if (pathname === '/api/local/fs/list' && req.method === 'POST') {
    requireBridgePermission(securityContext, 'fileRead')
    const body = await readJsonBody(req)
    const rootPath = await resolveDirectoryWithinRoot(body.path || '.', baseDir)
    const depth = Number.isFinite(body.depth) ? Number(body.depth) : DEFAULT_TREE_DEPTH
    sendJson(res, 200, { rootPath, tree: await buildTree(rootPath, Math.max(1, Math.min(depth, 8))) })
    return true
  }

  if (pathname === '/api/local/fs/find' && req.method === 'POST') {
    requireBridgePermission(securityContext, 'fileRead')
    const body = await readJsonBody(req)
    await resolveWritablePathWithinRoot(body.path || '.', baseDir)
    const resolved = await resolveFindRootPath(body.path || '.', baseDir)
    resolved.rootPath = await resolveDirectoryWithinRoot(resolved.rootPath, baseDir)
    const result = await findFiles(resolved.rootPath, {
      query: body.query,
      mode: body.mode || body.searchIn || 'auto',
      useRegex: body.useRegex === true || body.regex === true,
      ignoreCase: body.ignoreCase !== false,
      depth: Number.isFinite(Number(body.depth)) ? Number(body.depth) : DEFAULT_FIND_DEPTH,
      maxResults: Number.isFinite(Number(body.maxResults)) ? Number(body.maxResults) : DEFAULT_FIND_RESULTS,
      fuzzy: body.fuzzy !== false,
      fuzzyThreshold: Number.isFinite(Number(body.fuzzyThreshold))
        ? Number(body.fuzzyThreshold)
        : DEFAULT_FIND_FUZZY_THRESHOLD,
    })
    sendJson(res, 200, {
      ...result,
      requestedPath: resolved.requestedPath,
      pathResolution: resolved.resolvedBy,
      attemptedPaths: resolved.attemptedPaths,
    })
    return true
  }

  if (pathname === '/api/local/fs/read' && req.method === 'POST') {
    requireBridgePermission(securityContext, 'fileRead')
    const body = await readJsonBody(req)
    const targetPath = await resolveExistingPathWithinRoot(body.path, baseDir)
    const stats = await fs.stat(targetPath)
    if (stats.isDirectory()) {
      sendJson(res, 400, { error: 'Cannot read a directory as file content' })
      return true
    }
    const buffer = await fs.readFile(targetPath)
    if (isBinary(buffer)) {
      sendJson(res, 200, {
        path: targetPath,
        isBinary: true,
        content: '',
        totalLines: 0,
        truncated: false,
        hasMore: false,
      })
      return true
    }
    const text = buffer.toString('utf8').replace(/\r\n?/g, '\n')
    const lines = text.split('\n')
    const totalLines = text ? lines.length : 0

    const patternInput = body.pattern === undefined ? '' : String(body.pattern)
    if (patternInput) {
      const ignoreCase = body.ignoreCase !== false
      const context = parseNumber(body.patternContext ?? body.contextLines, 2, 0, 20)
      const limit = parseNumber(body.maxResults, 50, 1, 500)
      let matcher: (line: string) => boolean
      try {
        if (body.patternRegex === true || body.useRegex === true) {
          const expression = new RegExp(patternInput, ignoreCase ? 'i' : '')
          matcher = (line) => expression.test(line)
        } else {
          const needle = ignoreCase ? patternInput.toLowerCase() : patternInput
          matcher = (line) => (ignoreCase ? line.toLowerCase() : line).includes(needle)
        }
      } catch (error) {
        sendJson(res, 400, {
          error: `Invalid search expression: ${error instanceof Error ? error.message : String(error)}`,
        })
        return true
      }
      const hits: Array<{ line: number; content: string; context: string[] }> = []
      for (let index = 0; index < lines.length && hits.length < limit; index += 1) {
        if (!matcher(lines[index])) continue
        hits.push({
          line: index + 1,
          content: lines[index],
          context: lines.slice(Math.max(0, index - context), Math.min(lines.length, index + context + 1)),
        })
      }
      sendJson(res, 200, {
        path: targetPath,
        isBinary: false,
        mode: 'pattern',
        pattern: patternInput,
        matches: hits,
        matchCount: hits.length,
        totalLines,
      })
      return true
    }

    const tail = Number.isFinite(Number(body.tail)) ? Math.max(0, Math.round(Number(body.tail))) : 0
    const startLine =
      tail > 0
        ? Math.max(1, totalLines - Math.min(MAX_READ_LINE_COUNT, tail) + 1)
        : parseNumber(body.startLine, 1, 1, Math.max(1, totalLines || 1))
    const lineCount =
      tail > 0
        ? Math.min(MAX_READ_LINE_COUNT, tail)
        : parseNumber(body.lineCount, DEFAULT_READ_LINE_COUNT, 1, MAX_READ_LINE_COUNT)
    const selected = lines.slice(startLine - 1, Math.min(totalLines, startLine - 1 + lineCount))
    const maxChars = Number.isFinite(Number(body.maxChars))
      ? parseNumber(body.maxChars, MAX_READ_CHARS, 200, MAX_READ_CHARS)
      : MAX_READ_CHARS
    const raw = selected.join('\n')
    const content = raw.slice(0, maxChars)
    const endLine = startLine + Math.max(0, selected.length - 1)
    sendJson(res, 200, {
      path: targetPath,
      isBinary: false,
      content,
      startLine,
      endLine,
      lineCount: selected.length,
      totalLines,
      truncated: raw.length > content.length || endLine < totalLines,
      hasMore: endLine < totalLines,
      nextStartLine: endLine < totalLines ? endLine + 1 : null,
    })
    return true
  }
  return false
}

async function handleWriteRoutes(
  req: BridgeRequest,
  res: BridgeResponse,
  baseDir: string,
  pathname: string,
  securityContext?: BridgeSecurityContext,
) {
  if (pathname === '/api/local/fs/write' && req.method === 'POST') {
    requireBridgePermission(securityContext, 'fileWrite')
    const body = await readJsonBody(req)
    const targetPath = await resolveWritablePathWithinRoot(body.path, baseDir)
    await fs.mkdir(path.dirname(targetPath), { recursive: true })
    if (body.append === true) await fs.appendFile(targetPath, String(body.content ?? ''), 'utf8')
    else await atomicWriteFile(targetPath, String(body.content ?? ''), { encoding: 'utf8' })
    const stats = await fs.stat(targetPath)
    sendJson(res, 200, { path: targetPath, saved: true, append: body.append === true, modifiedAt: stats.mtimeMs })
    return true
  }

  if (pathname === '/api/local/fs/edit' && req.method === 'POST') {
    requireBridgePermission(securityContext, 'fileWrite')
    const body = await readJsonBody(req)
    const targetPath = await resolveWritablePathWithinRoot(body.path, baseDir)
    const oldText = String(body.oldText ?? body.oldString ?? '')
    const newText = String(body.newText ?? body.newString ?? '')
    if (!oldText || oldText === newText) {
      sendJson(res, 400, {
        applied: false,
        error: !oldText ? 'oldText is required' : 'oldText and newText are identical',
      })
      return true
    }
    let original: string
    try {
      original = (await fs.readFile(targetPath, 'utf8')).replace(/\r\n?/g, '\n')
    } catch {
      sendJson(res, 404, { applied: false, path: targetPath, error: 'File does not exist or is unreadable' })
      return true
    }
    const occurrences = original.split(oldText).length - 1
    if (!occurrences) {
      sendJson(res, 200, {
        applied: false,
        path: targetPath,
        error: 'oldText was not found; re-read the file before editing',
      })
      return true
    }
    if (occurrences > 1 && body.replaceAll !== true) {
      sendJson(res, 200, {
        applied: false,
        path: targetPath,
        occurrences,
        error: 'oldText is ambiguous; include more context or set replaceAll',
      })
      return true
    }
    const updated =
      body.replaceAll === true ? original.split(oldText).join(newText) : original.replace(oldText, newText)
    await atomicWriteFile(targetPath, updated, { encoding: 'utf8' })
    const diff = buildUnifiedDiff(original, updated, { contextLines: 3, fromLabel: targetPath, toLabel: targetPath })
    const stats = await fs.stat(targetPath)
    sendJson(res, 200, {
      path: targetPath,
      applied: true,
      saved: true,
      replacements: body.replaceAll === true ? occurrences : 1,
      diff: diff.diff,
      added: diff.added,
      removed: diff.removed,
      modifiedAt: stats.mtimeMs,
    })
    return true
  }
  return false
}

async function handleTerminal(
  req: BridgeRequest,
  res: BridgeResponse,
  baseDir: string,
  pathname: string,
  securityContext?: BridgeSecurityContext,
) {
  if (pathname !== '/api/local/terminal/execute' || req.method !== 'POST') return false
  requireBridgePermission(securityContext, 'terminal')
  const body = await readJsonBody(req)
  const command = String(body.command || '').trim()
  if (!command) {
    sendJson(res, 400, { error: 'Command is required' })
    return true
  }
  const permit = acquireOperation('terminal')
  if (!permit.allowed) {
    sendJson(res, 429, operationLimitPayload(permit))
    return true
  }
  try {
    const cwd = await resolveDirectoryWithinRoot(body.cwd || '.', baseDir)
    sendJson(res, 200, await runCommand(command, cwd, baseDir))
  } finally {
    permit.release()
  }
  return true
}

async function handleDevEnvironment(
  req: BridgeRequest,
  res: BridgeResponse,
  baseDir: string,
  pathname: string,
  securityContext?: BridgeSecurityContext,
) {
  if (!pathname.startsWith('/api/local/launcher/dev/')) return false
  const body = await readJsonBody(req).catch(() => ({}))
  if (pathname === '/api/local/launcher/dev/status' && req.method === 'POST') {
    const cwd = String(body.cwd || '').trim() ? await resolveDirectoryWithinRoot(body.cwd, baseDir) : ''
    sendJson(res, 200, await getDevEnvironmentStatus(cwd))
    return true
  }
  requireBridgePermission(securityContext, 'launcher')
  if (pathname === '/api/local/launcher/dev/start' && req.method === 'POST') {
    const cwd = await resolveDirectoryWithinRoot(body.cwd || '.', baseDir)
    const status = await startManagedDevEnvironment(cwd)
    sendJson(res, status.running ? 200 : 400, status)
    return true
  }
  if (pathname === '/api/local/launcher/dev/stop' && req.method === 'POST') {
    sendJson(res, 200, await stopManagedDevEnvironment())
    return true
  }
  return false
}

export async function handleFileRoutes(
  req: BridgeRequest,
  res: BridgeResponse,
  baseDir: string,
  requestUrl: URL,
  pathname: string,
  securityContext?: BridgeSecurityContext,
): Promise<boolean> {
  return (
    (await handleReadRoutes(req, res, baseDir, pathname, securityContext)) ||
    (await handleWriteRoutes(req, res, baseDir, pathname, securityContext)) ||
    (await handleTerminal(req, res, baseDir, pathname, securityContext)) ||
    (await handleDevEnvironment(req, res, baseDir, pathname, securityContext))
  )
}
