/**
 * Handles basic filesystem, artifact, terminal, and launcher requests. It applies operation
 * limits and launcher approval before delegating to the underlying service functions.
 */

import { createReadStream } from 'node:fs'
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
  launch,
  launchLegacyCommand,
  parseNumber,
  path,
  readJsonBody,
  resolveFindRootPath,
  runCommand,
  saveArtifact,
  listArtifacts,
  readArtifact,
  sendJson,
} from '../services/fileService.js'
import {
  classifyLauncherRequest,
  consumeLauncherApproval,
  createLauncherApproval,
  normalizeLauncherRequest,
} from '../shared/launcherSafety.js'
import { atomicWriteFile } from '../shared/atomicFile.js'
import { buildUnifiedDiff } from '../shared/unifiedDiff.js'
import { pathContainsExcludedDirectory } from '../shared/fileExclusions.js'
import {
  pathIsInside,
  resolveDirectoryWithinRoot,
  resolveDirectoryWithinRoots,
  resolveExistingPathWithinRoot,
  resolveExistingPathWithinRoots,
  resolveWritablePathWithinRoot,
  resolveWritablePathWithinRoots,
} from '../shared/filesystemBoundary.js'
import { acquireOperation, operationLimitPayload } from '../shared/operationLimiter.js'
import {
  discoverLauncherCapabilities,
  getDevEnvironmentStatus,
  startManagedDevEnvironment,
  stopManagedDevEnvironment,
} from '../services/launcherService.js'
import {
  cancelLauncherSemanticIndex,
  clearLauncherSemanticRuntimeCache,
  getLauncherSemanticStatus,
  installLauncherSemanticModel,
  rebuildLauncherSemanticIndex,
  searchLauncherSemanticIndex,
} from '../services/launcherSemanticService.js'
import {
  analyzeFileWithOllama,
  cancelFileSemanticIndex,
  clearFileSemanticIndex,
  clearFileSemanticRuntimeCache,
  findSimilarFiles,
  getFileSemanticStatus,
  installFileSemanticModels,
  preflightFileSemanticIndex,
  rebuildFileSemanticIndex,
  rescanFileSemanticIndex,
  searchFileSemanticConcepts,
  searchFileSemanticIndex,
} from '../services/fileSemanticService.js'
import { clearEncryptedApplicationData } from '../storage/encryptedDatabase.js'
import { getFileIndexAccessRoots, getFileIndexSourceState } from '../services/fileIndexSourceService.js'
import {
  browseDirectory,
  clearFileThumbnailCache,
  createFileThumbnail,
  isVideoFilePath,
  openFileWithSystem,
  revealFileInFolder,
  videoMimeTypeForPath,
} from '../services/fileBrowserService.js'

interface MediaByteRange {
  start: number
  end: number
}

function parseMediaByteRange(value: string | undefined, size: number): MediaByteRange | null {
  if (!value) return { start: 0, end: Math.max(0, size - 1) }
  const match = /^bytes=(\d*)-(\d*)$/.exec(value.trim())
  if (!match || size <= 0) return null
  const startText = match[1]
  const endText = match[2]
  if (!startText && !endText) return null

  if (!startText) {
    const suffixLength = Number(endText)
    if (!Number.isFinite(suffixLength) || suffixLength <= 0) return null
    return {
      start: Math.max(0, size - Math.floor(suffixLength)),
      end: size - 1,
    }
  }

  const start = Number(startText)
  const requestedEnd = endText ? Number(endText) : size - 1
  if (!Number.isFinite(start) || !Number.isFinite(requestedEnd) || start < 0 || requestedEnd < start || start >= size) {
    return null
  }
  return {
    start: Math.floor(start),
    end: Math.min(size - 1, Math.floor(requestedEnd)),
  }
}

async function streamVideoFile(req: BridgeRequest, res: BridgeResponse, targetPath: string): Promise<void> {
  const stats = await fs.stat(targetPath)
  if (!stats.isFile() || !isVideoFilePath(targetPath)) {
    res.statusCode = 400
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    res.end(JSON.stringify({ error: 'Media preview requires a video file' }))
    return
  }

  const rangeHeader = Array.isArray(req.headers.range) ? req.headers.range[0] : req.headers.range
  const range = parseMediaByteRange(rangeHeader, stats.size)
  if (!range) {
    res.statusCode = 416
    res.setHeader('Content-Range', `bytes */${stats.size}`)
    res.end()
    return
  }

  const partial = Boolean(rangeHeader)
  const contentLength = stats.size ? range.end - range.start + 1 : 0
  res.statusCode = partial ? 206 : 200
  res.setHeader('Accept-Ranges', 'bytes')
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('Content-Type', videoMimeTypeForPath(targetPath))
  res.setHeader('Content-Length', String(contentLength))
  res.setHeader('X-Content-Type-Options', 'nosniff')
  if (partial) {
    res.setHeader('Content-Range', `bytes ${range.start}-${range.end}/${stats.size}`)
  }
  if (req.method === 'HEAD' || stats.size === 0) {
    res.end()
    return
  }

  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(targetPath, {
      start: range.start,
      end: range.end,
    })
    stream.once('error', reject)
    stream.once('end', resolve)
    res.once('close', () => stream.destroy())
    stream.pipe(res)
  })
}

async function fileManagerRoots(baseDir: string): Promise<string[]> {
  return getFileIndexAccessRoots(baseDir)
}

async function resolveFileManagerExisting(inputPath: unknown, baseDir: string, enabled: boolean): Promise<string> {
  if (!enabled) return resolveExistingPathWithinRoot(inputPath, baseDir)
  return resolveExistingPathWithinRoots(inputPath, await fileManagerRoots(baseDir), baseDir)
}

async function resolveFileManagerDirectory(inputPath: unknown, baseDir: string, enabled: boolean): Promise<string> {
  if (!enabled) return resolveDirectoryWithinRoot(inputPath, baseDir)
  return resolveDirectoryWithinRoots(inputPath, await fileManagerRoots(baseDir), baseDir)
}

async function resolveFileManagerWritable(inputPath: unknown, baseDir: string, enabled: boolean): Promise<string> {
  if (!enabled) return resolveWritablePathWithinRoot(inputPath, baseDir)
  return resolveWritablePathWithinRoots(inputPath, await fileManagerRoots(baseDir), baseDir)
}

async function fileManagerRootForPath(targetPath: string, baseDir: string): Promise<string> {
  const roots = await fileManagerRoots(baseDir)
  return (
    roots
      .filter((rootPath) => pathIsInside(rootPath, targetPath))
      .sort((left, right) => right.length - left.length)[0] || baseDir
  )
}

/** Handles File Manager navigation, previews, search, and bounded file reads. */
export async function handleFilesystemReadRoutes(
  req: BridgeRequest,
  res: BridgeResponse,
  baseDir: string,
  requestUrl: URL,
  pathname: string,
  securityContext?: BridgeSecurityContext,
): Promise<boolean> {
  if (pathname === '/api/local/fs/media' && (req.method === 'GET' || req.method === 'HEAD')) {
    requireBridgePermission(securityContext, 'fileRead')
    const targetPath = await resolveFileManagerExisting(
      requestUrl.searchParams.get('path') || '',
      baseDir,
      requestUrl.searchParams.get('scope') === 'file-manager',
    )
    await streamVideoFile(req, res, targetPath)
    return true
  }

  if (pathname === '/api/local/fs/list' && req.method === 'POST') {
    requireBridgePermission(securityContext, 'fileRead')
    const body = await readJsonBody(req)
    const rootPath = await resolveDirectoryWithinRoot(body.path || '.', baseDir)
    if (pathContainsExcludedDirectory(baseDir, rootPath, true)) {
      throw new Error('This directory is excluded from the File Manager')
    }
    const depth = Number.isFinite(body.depth) ? Number(body.depth) : DEFAULT_TREE_DEPTH
    const tree = await buildTree(rootPath, Math.max(1, Math.min(depth, 6)))
    sendJson(res, 200, { rootPath, tree })
    return true
  }

  if (pathname === '/api/local/fs/browse' && req.method === 'POST') {
    requireBridgePermission(securityContext, 'fileRead')
    const body = await readJsonBody(req)
    const fileManager = body.fileManager === true
    const currentPath = await resolveFileManagerDirectory(body.path || '.', baseDir, fileManager)
    const result = await browseDirectory(
      currentPath,
      fileManager ? await fileManagerRootForPath(currentPath, baseDir) : await resolveDirectoryWithinRoot('.', baseDir),
    )
    sendJson(res, 200, result)
    return true
  }

  if (pathname === '/api/local/fs/thumbnail' && req.method === 'POST') {
    requireBridgePermission(securityContext, 'fileRead')
    const body = await readJsonBody(req)
    const targetPath = await resolveFileManagerExisting(body.path, baseDir, body.fileManager === true)
    const stats = await fs.stat(targetPath)
    if (!stats.isFile()) {
      sendJson(res, 400, { error: 'Thumbnail target must be a file' })
      return true
    }
    const thumbnail = await createFileThumbnail(targetPath, Number(body.width) || 240, Number(body.height) || 240)
    sendJson(res, 200, thumbnail)
    return true
  }

  if (pathname === '/api/local/fs/open' && req.method === 'POST') {
    requireBridgePermission(securityContext, 'fileRead')
    const body = await readJsonBody(req)
    const targetPath = await resolveFileManagerExisting(body.path, baseDir, body.fileManager === true)
    await openFileWithSystem(targetPath)
    sendJson(res, 200, { opened: true, path: targetPath })
    return true
  }

  if (pathname === '/api/local/fs/reveal' && req.method === 'POST') {
    requireBridgePermission(securityContext, 'fileRead')
    const body = await readJsonBody(req)
    const targetPath = await resolveFileManagerExisting(body.path, baseDir, body.fileManager === true)
    await revealFileInFolder(targetPath)
    sendJson(res, 200, { revealed: true, path: targetPath })
    return true
  }

  if (pathname === '/api/local/fs/find' && req.method === 'POST') {
    requireBridgePermission(securityContext, 'fileRead')
    const body = await readJsonBody(req)
    // Validate the requested spelling before compatibility resolution performs any stat or
    // directory reads. The final resolved spelling is checked again below.
    await resolveWritablePathWithinRoot(body.path || '.', baseDir)
    const resolvedRoot = await resolveFindRootPath(body.path || '.', baseDir)
    resolvedRoot.rootPath = await resolveDirectoryWithinRoot(resolvedRoot.rootPath, baseDir)
    const result = await findFiles(resolvedRoot.rootPath, {
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
      requestedPath: resolvedRoot.requestedPath,
      pathResolution: resolvedRoot.resolvedBy,
      attemptedPaths: resolvedRoot.attemptedPaths,
    })
    return true
  }

  if (pathname === '/api/local/fs/read' && req.method === 'POST') {
    requireBridgePermission(securityContext, 'fileRead')
    const body = await readJsonBody(req)
    const targetPath = await resolveFileManagerExisting(body.path, baseDir, body.fileManager === true)
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
        startLine: 1,
        endLine: 0,
        lineCount: 0,
        totalLines: 0,
        truncated: false,
        hasMore: false,
        nextStartLine: null,
      })
      return true
    }
    const text = buffer.toString('utf8').replace(/\r\n?/g, '\n')

    // In-file pattern search (opt-in) — jump straight to the relevant lines of a large file in
    // one call instead of paging windows or shelling out to sed/grep. Returns matching lines with
    // their true line numbers plus a little surrounding context; the broker renders them.
    const patternInput = body.pattern === undefined ? '' : String(body.pattern)
    if (patternInput.length > 0) {
      const lines = text.split('\n')
      const totalLines = text ? lines.length : 0
      const ignoreCase = body.ignoreCase !== false
      const ctx = parseNumber(body.patternContext ?? body.contextLines, 2, 0, 20)
      const limit = parseNumber(body.maxResults, 50, 1, 500)
      let matcher: (line: string) => boolean
      let patternError = ''
      if (body.patternRegex === true || body.useRegex === true) {
        try {
          const re = new RegExp(patternInput, ignoreCase ? 'i' : '')
          matcher = (line: string) => re.test(line)
        } catch (err) {
          patternError = `Invalid regex: ${(err as Error).message}`
          matcher = () => false
        }
      } else {
        const needle = ignoreCase ? patternInput.toLowerCase() : patternInput
        matcher = (line: string) => (ignoreCase ? line.toLowerCase() : line).includes(needle)
      }
      const matchLineNumbers: number[] = []
      for (let i = 0; i < lines.length && matchLineNumbers.length < limit; i++) {
        if (matcher(lines[i])) matchLineNumbers.push(i + 1)
      }
      // Expand to context windows and merge overlapping/adjacent ranges into blocks.
      const blocks: { startLine: number; endLine: number }[] = []
      for (const ln of matchLineNumbers) {
        const start = Math.max(1, ln - ctx)
        const end = Math.min(totalLines, ln + ctx)
        const last = blocks[blocks.length - 1]
        if (last && start <= last.endLine + 1) last.endLine = Math.max(last.endLine, end)
        else blocks.push({ startLine: start, endLine: end })
      }
      const matchSet = new Set(matchLineNumbers)
      const renderedBlocks = blocks.map((block) => ({
        startLine: block.startLine,
        endLine: block.endLine,
        lines: lines.slice(block.startLine - 1, block.endLine).map((content, idx) => ({
          line: block.startLine + idx,
          content,
          isMatch: matchSet.has(block.startLine + idx),
        })),
      }))
      sendJson(res, 200, {
        path: targetPath,
        isBinary: false,
        mode: 'pattern',
        pattern: patternInput,
        matchCount: matchLineNumbers.length,
        truncated: matchLineNumbers.length >= limit,
        totalLines,
        blocks: renderedBlocks,
        ...(patternError ? { error: patternError } : {}),
      })
      return true
    }

    // Tail (opt-in) — read the last N lines (logs, recent appends) without computing offsets.
    const tailCount = Number.isFinite(Number(body.tail)) ? Math.round(Number(body.tail)) : 0
    if (tailCount > 0) {
      const lines = text.split('\n')
      const totalLines = text ? lines.length : 0
      const take = Math.min(MAX_READ_LINE_COUNT, tailCount)
      const startLine = Math.max(1, totalLines - take + 1)
      const selectedLines = lines.slice(startLine - 1)
      sendJson(res, 200, {
        path: targetPath,
        isBinary: false,
        mode: 'tail',
        content: selectedLines.join('\n'),
        startLine,
        endLine: totalLines,
        lineCount: selectedLines.length,
        totalLines,
        truncated: startLine > 1,
        hasMore: false,
        nextStartLine: null,
      })
      return true
    }

    const hasWindowRequest =
      body.startLine !== undefined ||
      body.lineCount !== undefined ||
      body.endLine !== undefined ||
      body.maxChars !== undefined
    if (hasWindowRequest) {
      const lines = text.split('\n')
      const totalLines = lines.length
      const boundedStartLine = parseNumber(body.startLine, 1, 1, Math.max(1, totalLines))
      const lineCount = Number.isFinite(Number(body.lineCount))
        ? parseNumber(body.lineCount, DEFAULT_READ_LINE_COUNT, 1, MAX_READ_LINE_COUNT)
        : DEFAULT_READ_LINE_COUNT
      const maybeEndLine = Number.isFinite(Number(body.endLine))
        ? parseNumber(body.endLine, boundedStartLine + lineCount - 1, boundedStartLine, totalLines)
        : null
      const effectiveLineCount = maybeEndLine
        ? Math.max(1, Math.min(MAX_READ_LINE_COUNT, maybeEndLine - boundedStartLine + 1))
        : lineCount
      const startIndex = boundedStartLine - 1
      const sliceEndIndex = Math.min(totalLines, startIndex + effectiveLineCount)
      const selectedLines = lines.slice(startIndex, sliceEndIndex)
      const selectedTextRaw = selectedLines.join('\n')
      const maxChars = Number.isFinite(Number(body.maxChars))
        ? parseNumber(body.maxChars, MAX_READ_CHARS, 200, MAX_READ_CHARS)
        : 0
      const charTruncated = maxChars > 0 && selectedTextRaw.length > maxChars
      const selectedText = charTruncated ? selectedTextRaw.slice(0, maxChars) : selectedTextRaw
      const endLine = sliceEndIndex
      const hasMore = endLine < totalLines
      sendJson(res, 200, {
        path: targetPath,
        isBinary: false,
        content: selectedText,
        startLine: boundedStartLine,
        endLine,
        lineCount: selectedLines.length,
        totalLines,
        truncated: hasMore || charTruncated,
        hasMore,
        charTruncated,
        nextStartLine: hasMore ? endLine + 1 : null,
      })
      return true
    }
    const totalLines = text ? text.split('\n').length : 0
    sendJson(res, 200, {
      path: targetPath,
      isBinary: false,
      content: text,
      startLine: 1,
      endLine: totalLines,
      lineCount: totalLines,
      totalLines,
      truncated: false,
      hasMore: false,
      nextStartLine: null,
    })
    return true
  }

  return false
}

/** Handles semantic-index lifecycle, search, similarity, concepts, and analysis routes. */
export async function handleFileIndexRoutes(
  req: BridgeRequest,
  res: BridgeResponse,
  baseDir: string,
  requestUrl: URL,
  pathname: string,
  securityContext?: BridgeSecurityContext,
): Promise<boolean> {
  if (pathname === '/api/local/fs/index/sources' && req.method === 'POST') {
    requireBridgePermission(securityContext, 'fileRead')
    sendJson(res, 200, await getFileIndexSourceState(baseDir))
    return true
  }

  if (pathname === '/api/local/fs/index/status' && req.method === 'POST') {
    requireBridgePermission(securityContext, 'fileRead')
    const body = await readJsonBody(req).catch(() => ({}))
    const status = await getFileSemanticStatus(baseDir, body.buildIfMissing === true)
    sendJson(res, 200, status)
    return true
  }

  if (pathname === '/api/local/fs/index/install' && req.method === 'POST') {
    requireBridgePermission(securityContext, 'fileRead')
    const status = await installFileSemanticModels(baseDir)
    sendJson(res, 200, status)
    return true
  }

  if (pathname === '/api/local/fs/index/preflight' && req.method === 'POST') {
    requireBridgePermission(securityContext, 'fileRead')
    const body = await readJsonBody(req).catch(() => ({}))
    const preflight = await preflightFileSemanticIndex(
      baseDir,
      Array.isArray(body.selectedSourceIds) ? body.selectedSourceIds : [],
      true,
    )
    sendJson(res, 200, preflight)
    return true
  }

  if (pathname === '/api/local/fs/index/rebuild' && req.method === 'POST') {
    requireBridgePermission(securityContext, 'fileRead')
    const body = await readJsonBody(req).catch(() => ({}))
    const status = await rebuildFileSemanticIndex(
      baseDir,
      body.confirmLargeScan === true,
      Array.isArray(body.selectedSourceIds) ? body.selectedSourceIds : [],
    )
    sendJson(res, 200, status)
    return true
  }

  if (pathname === '/api/local/fs/index/rescan' && req.method === 'POST') {
    requireBridgePermission(securityContext, 'fileRead')
    const status = await rescanFileSemanticIndex(baseDir)
    sendJson(res, 200, status)
    return true
  }

  if (pathname === '/api/local/fs/index/cancel' && req.method === 'POST') {
    requireBridgePermission(securityContext, 'fileRead')
    const status = await cancelFileSemanticIndex(baseDir)
    sendJson(res, 200, status)
    return true
  }

  if (pathname === '/api/local/fs/index/clear' && req.method === 'POST') {
    requireBridgePermission(securityContext, 'fileRead')
    const status = await clearFileSemanticIndex(baseDir)
    sendJson(res, 200, status)
    return true
  }

  if (pathname === '/api/local/fs/semantic/search' && req.method === 'POST') {
    requireBridgePermission(securityContext, 'fileRead')
    const body = await readJsonBody(req)
    const results = await searchFileSemanticIndex(body.query, body.limit, body.kind)
    sendJson(res, 200, { results })
    return true
  }

  if (pathname === '/api/local/fs/semantic/similar' && req.method === 'POST') {
    requireBridgePermission(securityContext, 'fileRead')
    const body = await readJsonBody(req)
    const targetPath = await resolveFileManagerExisting(body.path, baseDir, true)
    const results = await findSimilarFiles(targetPath, body.limit)
    sendJson(res, 200, { results })
    return true
  }

  if (pathname === '/api/local/fs/semantic/concepts' && req.method === 'POST') {
    requireBridgePermission(securityContext, 'fileRead')
    const body = await readJsonBody(req)
    const groups = await searchFileSemanticConcepts(body.query, body.groupLimit, body.filesPerGroup)
    sendJson(res, 200, { groups })
    return true
  }

  if (pathname === '/api/local/fs/analyze' && req.method === 'POST') {
    requireBridgePermission(securityContext, 'fileRead')
    const body = await readJsonBody(req)
    const targetPath = await resolveFileManagerExisting(body.path, baseDir, body.fileManager === true)
    const analysis = await analyzeFileWithOllama(targetPath)
    sendJson(res, 200, analysis)
    return true
  }

  return false
}

/** Handles explicit File Manager writes after bridge permission and path checks. */
export async function handleFilesystemWriteRoutes(
  req: BridgeRequest,
  res: BridgeResponse,
  baseDir: string,
  requestUrl: URL,
  pathname: string,
  securityContext?: BridgeSecurityContext,
): Promise<boolean> {
  if (pathname === '/api/local/fs/write' && req.method === 'POST') {
    requireBridgePermission(securityContext, 'fileWrite')
    const body = await readJsonBody(req)
    const targetPath = await resolveFileManagerWritable(body.path, baseDir, body.fileManager === true)
    await fs.mkdir(path.dirname(targetPath), { recursive: true })
    if (body.append === true) {
      await fs.appendFile(targetPath, String(body.content ?? ''), 'utf8')
    } else {
      await atomicWriteFile(targetPath, String(body.content ?? ''), {
        encoding: 'utf8',
      })
    }
    const savedStats = await fs.stat(targetPath)
    sendJson(res, 200, {
      path: targetPath,
      saved: true,
      append: body.append === true,
      modifiedAt: savedStats.mtimeMs,
    })
    return true
  }

  // POST /api/local/fs/edit — exact string replacement (str_replace).
  //
  // The most reliable way for a model to edit a file: supply the exact existing snippet (oldText)
  // and its replacement (newText). We verify the snippet is present and unambiguous before writing,
  // then atomically persist (auto-save) and return a real diff. Far more accurate than unified-diff
  // patches, which break on the smallest context/offset drift.
  if (pathname === '/api/local/fs/edit' && req.method === 'POST') {
    requireBridgePermission(securityContext, 'fileWrite')
    const body = await readJsonBody(req)
    const targetPath = await resolveFileManagerWritable(body.path, baseDir, body.fileManager === true)
    const oldText = String(body.oldText ?? body.oldString ?? '')
    const newText = String(body.newText ?? body.newString ?? '')
    const replaceAll = body.replaceAll === true

    if (!oldText) {
      sendJson(res, 400, { applied: false, error: 'oldText is required for fs/edit.' })
      return true
    }
    if (oldText === newText) {
      sendJson(res, 400, {
        applied: false,
        error: 'oldText and newText are identical — nothing to change.',
      })
      return true
    }

    let original: string
    try {
      original = await fs.readFile(targetPath, 'utf8')
    } catch {
      sendJson(res, 200, {
        applied: false,
        path: targetPath,
        error: 'File does not exist or is unreadable. Use files.write to create a new file.',
      })
      return true
    }
    original = original.replace(/\r\n?/g, '\n')

    // Count exact, non-overlapping occurrences without regex (oldText may contain regex specials).
    let occurrences = 0
    let scan = original.indexOf(oldText)
    let firstIndex = scan
    while (scan !== -1) {
      occurrences++
      scan = original.indexOf(oldText, scan + oldText.length)
    }

    if (occurrences === 0) {
      sendJson(res, 200, {
        applied: false,
        path: targetPath,
        error:
          'oldText was not found in the file. Read the file first and copy the exact text (including whitespace/indentation).',
      })
      return true
    }
    if (occurrences > 1 && !replaceAll) {
      sendJson(res, 200, {
        applied: false,
        path: targetPath,
        occurrences,
        error: `oldText matches ${occurrences} places — it must be unique. Add surrounding lines to disambiguate, or pass replaceAll:true to change every occurrence.`,
      })
      return true
    }

    const updated = replaceAll
      ? original.split(oldText).join(newText)
      : original.slice(0, firstIndex) + newText + original.slice(firstIndex + oldText.length)

    await atomicWriteFile(targetPath, updated, { encoding: 'utf8' })
    const savedStats = await fs.stat(targetPath)
    const diff = buildUnifiedDiff(original, updated, {
      contextLines: 3,
      fromLabel: targetPath,
      toLabel: targetPath,
    })
    sendJson(res, 200, {
      path: targetPath,
      applied: true,
      saved: true,
      replacements: replaceAll ? occurrences : 1,
      diff: diff.diff,
      added: diff.added,
      removed: diff.removed,
      modifiedAt: savedStats.mtimeMs,
    })
    return true
  }

  return false
}

/** Handles encrypted artifact creation, listing, and bounded content reads. */
export async function handleArtifactRoutes(
  req: BridgeRequest,
  res: BridgeResponse,
  baseDir: string,
  requestUrl: URL,
  pathname: string,
  securityContext?: BridgeSecurityContext,
): Promise<boolean> {
  if (pathname === '/api/local/artifacts/save' && req.method === 'POST') {
    requireBridgePermission(securityContext, 'fileWrite')
    const body = await readJsonBody(req)
    const artifact = await saveArtifact({
      filename: body.filename,
      content: body.content,
      summary: body.summary,
      type: body.type,
      chatId: body.chatId,
      append: body.append === true,
    })
    sendJson(res, 200, { artifact })
    return true
  }

  if (pathname === '/api/local/artifacts/list' && req.method === 'POST') {
    requireBridgePermission(securityContext, 'fileRead')
    const body = await readJsonBody(req).catch(() => ({}))
    const artifacts = await listArtifacts({
      limit: body?.limit,
      chatId: body?.chatId,
    })
    sendJson(res, 200, { artifacts })
    return true
  }

  if (pathname === '/api/local/artifacts/read' && req.method === 'POST') {
    requireBridgePermission(securityContext, 'fileRead')
    const body = await readJsonBody(req)
    const artifact = await readArtifact(body?.id)
    if (!artifact) {
      sendJson(res, 404, { error: 'Artifact not found' })
      return true
    }
    sendJson(res, 200, { artifact })
    return true
  }

  return false
}

/** Handles the shell-capable terminal endpoint under bridge limits and permissions. */
export async function handleTerminalRoute(
  req: BridgeRequest,
  res: BridgeResponse,
  baseDir: string,
  requestUrl: URL,
  pathname: string,
  securityContext?: BridgeSecurityContext,
): Promise<boolean> {
  if (pathname === '/api/local/terminal/execute' && req.method === 'POST') {
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
      const result = await runCommand(command, cwd, baseDir)
      sendJson(res, 200, result)
    } finally {
      permit.release()
    }
    return true
  }

  return false
}

/** Handles launcher discovery, managed development sessions, semantic search, approvals, and execution. */
export async function handleLauncherRoutes(
  req: BridgeRequest,
  res: BridgeResponse,
  baseDir: string,
  requestUrl: URL,
  pathname: string,
  securityContext?: BridgeSecurityContext,
): Promise<boolean> {
  if (pathname === '/api/local/launcher/discover' && req.method === 'POST') {
    const body = await readJsonBody(req)
    const discovery = await discoverLauncherCapabilities({
      cached: body.cached,
      force: body.force === true,
    })
    sendJson(res, 200, discovery)
    return true
  }

  if (pathname === '/api/local/launcher/dev/status' && req.method === 'POST') {
    const body = await readJsonBody(req)
    const requestedCwd = String(body.cwd || '').trim()
    const cwd = requestedCwd ? await resolveDirectoryWithinRoot(requestedCwd, baseDir) : ''
    const status = await getDevEnvironmentStatus(cwd)
    sendJson(res, 200, status)
    return true
  }

  if (pathname === '/api/local/launcher/dev/start' && req.method === 'POST') {
    requireBridgePermission(securityContext, 'launcher')
    const body = await readJsonBody(req)
    const requestedCwd = String(body.cwd || '').trim()
    if (!requestedCwd) {
      sendJson(res, 400, {
        error: 'Configure an agent working directory before starting a development environment.',
      })
      return true
    }
    const cwd = await resolveDirectoryWithinRoot(requestedCwd, baseDir)
    const status = await startManagedDevEnvironment(cwd)
    sendJson(res, status.running ? 200 : 400, status)
    return true
  }

  if (pathname === '/api/local/launcher/dev/stop' && req.method === 'POST') {
    requireBridgePermission(securityContext, 'launcher')
    const status = await stopManagedDevEnvironment()
    sendJson(res, 200, status)
    return true
  }

  if (pathname === '/api/local/launcher/semantic/status' && req.method === 'POST') {
    const body = await readJsonBody(req)
    const status = await getLauncherSemanticStatus(body.buildIfMissing === true)
    sendJson(res, 200, status)
    return true
  }

  if (pathname === '/api/local/launcher/semantic/install' && req.method === 'POST') {
    const status = await installLauncherSemanticModel()
    sendJson(res, 200, status)
    return true
  }

  if (pathname === '/api/local/launcher/semantic/rebuild' && req.method === 'POST') {
    const status = await rebuildLauncherSemanticIndex()
    sendJson(res, 200, status)
    return true
  }

  if (pathname === '/api/local/launcher/semantic/cancel' && req.method === 'POST') {
    const status = await cancelLauncherSemanticIndex()
    sendJson(res, 200, status)
    return true
  }

  if (pathname === '/api/local/launcher/semantic/search' && req.method === 'POST') {
    const body = await readJsonBody(req)
    const results = await searchLauncherSemanticIndex(body.query, body.limit)
    sendJson(res, 200, { results })
    return true
  }

  if (pathname === '/api/local/launcher/clear-data' && req.method === 'POST') {
    requireBridgePermission(securityContext, 'launcher')
    const body = await readJsonBody(req)
    const request = normalizeLauncherRequest(
      {
        category: 'data_clear',
        executable: 'iris-internal',
        args: ['clear-encrypted-application-data'],
      },
      baseDir,
    )
    const approvalId = String(body.approvalId || '').trim()
    const risk = classifyLauncherRequest(request)
    if (!approvalId) {
      sendJson(res, 200, {
        approvalRequired: true,
        approvalId: createLauncherApproval(request),
        risk: risk.kind,
        reason: risk.reason,
        command: 'Clear IRIS encrypted application data',
        cwd: baseDir,
      })
      return true
    }
    if (!consumeLauncherApproval(approvalId, request)) {
      sendJson(res, 403, {
        error: 'Launcher approval is invalid, expired, or already used',
      })
      return true
    }
    await clearLauncherSemanticRuntimeCache()
    await clearFileSemanticRuntimeCache()
    clearFileThumbnailCache()
    await clearEncryptedApplicationData()
    sendJson(res, 200, {
      cleared: true,
      reloadRequired: true,
      message: 'IRIS encrypted application data cleared',
    })
    return true
  }

  if (pathname === '/api/local/launcher/run' && req.method === 'POST') {
    requireBridgePermission(securityContext, 'launcher')
    const body = await readJsonBody(req)
    const cwd = await resolveDirectoryWithinRoot(body.cwd || '.', baseDir)
    let request
    try {
      request = normalizeLauncherRequest(body, cwd)
    } catch (error) {
      sendJson(res, 400, {
        error: error instanceof Error ? error.message : 'Invalid launch request',
      })
      return true
    }

    const risk = classifyLauncherRequest(request)
    if (risk.requiresApproval) {
      const approvalId = String(body.approvalId || '').trim()
      if (!approvalId) {
        sendJson(res, 200, {
          approvalRequired: true,
          approvalId: createLauncherApproval(request),
          risk: risk.kind,
          reason: risk.reason,
          command: request.displayCommand,
          cwd: request.cwd,
        })
        return true
      }
      if (!consumeLauncherApproval(approvalId, request)) {
        sendJson(res, 403, {
          error: 'Launcher approval is invalid, expired, or already used',
        })
        return true
      }
    }

    try {
      const result = request.legacyCommand
        ? launchLegacyCommand(request.legacyCommand, request.cwd)
        : launch(String(request.executable), request.args, request.cwd)
      sendJson(res, 200, {
        ...result,
        command: request.displayCommand,
        message: request.legacyCommand ? 'Approved shell command launched' : 'Process launched',
      })
    } catch (error) {
      const candidate = error as {
        message?: unknown
        code?: unknown
        retryAfterMs?: unknown
        statusCode?: unknown
      }
      if (Number(candidate.statusCode) === 429) {
        sendJson(res, 429, {
          error: String(candidate.message || 'Launcher limit reached'),
          code: String(candidate.code || 'concurrency_limited'),
          retryAfterMs: Number(candidate.retryAfterMs) || 500,
        })
        return true
      }
      throw error
    }
    return true
  }

  return false
}

/**
 * Handles filesystem, terminal, launcher, and native-file-dialog requests received by the
 * local bridge. It delegates route families in their existing matching order.
 */
export async function handleFileRoutes(
  req: BridgeRequest,
  res: BridgeResponse,
  baseDir: string,
  requestUrl: URL,
  pathname: string,
  securityContext?: BridgeSecurityContext,
): Promise<boolean> {
  if (await handleFilesystemReadRoutes(req, res, baseDir, requestUrl, pathname, securityContext)) {
    return true
  }
  if (await handleFileIndexRoutes(req, res, baseDir, requestUrl, pathname, securityContext)) {
    return true
  }
  if (await handleFilesystemWriteRoutes(req, res, baseDir, requestUrl, pathname, securityContext)) {
    return true
  }
  if (await handleArtifactRoutes(req, res, baseDir, requestUrl, pathname, securityContext)) {
    return true
  }
  if (await handleTerminalRoute(req, res, baseDir, requestUrl, pathname, securityContext)) {
    return true
  }
  if (await handleLauncherRoutes(req, res, baseDir, requestUrl, pathname, securityContext)) {
    return true
  }
  return false
}
