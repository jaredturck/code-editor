/**
 * Resolves bridge filesystem requests against an explicit working root and verifies the
 * canonical path before use. Existing symlinks may point elsewhere inside the root, but a
 * symlink, `..` segment, or absolute path cannot be used to escape that root.
 */

import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

export class FilesystemBoundaryError extends Error {
  statusCode = 403
  code = 'filesystem_boundary_violation'

  // Creates a filesystem boundary error with a stable code for route-level handling.
  constructor(message: string) {
    super(message)
    this.name = 'FilesystemBoundaryError'
  }
}

// Expands a leading home-directory marker before filesystem boundary checks are applied.
export function expandHomePath(inputPath: unknown): string | null {
  const value = String(inputPath ?? '').trim()
  if (!value) return null
  if (value === '~') return os.homedir()
  if (value.startsWith('~/') || value.startsWith('~\\')) {
    return path.join(os.homedir(), value.slice(2))
  }
  return value
}

// Determines whether a candidate path remains inside the canonical configured root.
export function pathIsInside(rootPath: string, candidatePath: string): boolean {
  const relative = path.relative(rootPath, candidatePath)
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
}

// Resolves a requested path against the configured working root without trusting caller
// normalization.
function requestedAbsolutePath(inputPath: unknown, rootPath: string): string {
  const expanded = expandHomePath(inputPath)
  if (!expanded) return path.resolve(rootPath)
  return path.resolve(path.isAbsolute(expanded) ? expanded : path.join(rootPath, expanded))
}

// Walks upward to find the nearest existing ancestor of a path that may not exist yet.
async function nearestExistingAncestor(targetPath: string): Promise<string> {
  let current = path.resolve(targetPath)
  while (true) {
    try {
      await fs.lstat(current)
      return current
    } catch (error) {
      const code = (error as NodeJS.ErrnoException)?.code
      if (code !== 'ENOENT') throw error
      const parent = path.dirname(current)
      if (parent === current) throw error
      current = parent
    }
  }
}

// Resolves the configured filesystem root to the canonical path used by all boundary checks.
async function canonicalRoot(rootPath: string): Promise<string> {
  const absolute = path.resolve(rootPath)
  const canonical = await fs.realpath(absolute)
  const stats = await fs.stat(canonical)
  if (!stats.isDirectory()) throw new Error(`Working root is not a directory: ${absolute}`)
  return canonical
}

// Rejects paths that escape the configured root before any filesystem operation is attempted.
function assertLexicallyInside(rootPath: string, targetPath: string): void {
  if (!pathIsInside(rootPath, targetPath)) {
    throw new FilesystemBoundaryError(`Path is outside the allowed working root: ${targetPath}`)
  }
}

/**
 * Resolves a path that must already exist. Both the requested spelling and the final
 * realpath must remain within the working root, which catches traversal and symlink exits.
 */
export async function resolveExistingPathWithinRoot(inputPath: unknown, rootPath: string): Promise<string> {
  const rootAbsolute = path.resolve(rootPath)
  const requested = requestedAbsolutePath(inputPath, rootAbsolute)
  assertLexicallyInside(rootAbsolute, requested)

  const [rootCanonical, targetCanonical] = await Promise.all([canonicalRoot(rootAbsolute), fs.realpath(requested)])
  if (!pathIsInside(rootCanonical, targetCanonical)) {
    throw new FilesystemBoundaryError(`Path resolves outside the allowed working root: ${requested}`)
  }
  return targetCanonical
}

/**
 * Resolves a file or directory that may not exist yet. The nearest existing ancestor is
 * canonicalized first so writes cannot cross the root through a symlinked parent directory.
 */
export async function resolveWritablePathWithinRoot(inputPath: unknown, rootPath: string): Promise<string> {
  const rootAbsolute = path.resolve(rootPath)
  const requested = requestedAbsolutePath(inputPath, rootAbsolute)
  assertLexicallyInside(rootAbsolute, requested)

  const rootCanonical = await canonicalRoot(rootAbsolute)
  const ancestor = await nearestExistingAncestor(requested)
  const ancestorCanonical = await fs.realpath(ancestor)
  if (!pathIsInside(rootCanonical, ancestorCanonical)) {
    throw new FilesystemBoundaryError(`Path resolves outside the allowed working root: ${requested}`)
  }

  try {
    const targetCanonical = await fs.realpath(requested)
    if (!pathIsInside(rootCanonical, targetCanonical)) {
      throw new FilesystemBoundaryError(`Path resolves outside the allowed working root: ${requested}`)
    }
    return targetCanonical
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') throw error
  }

  const relativeTail = path.relative(ancestor, requested)
  const rebuilt = path.resolve(ancestorCanonical, relativeTail)
  if (!pathIsInside(rootCanonical, rebuilt)) {
    throw new FilesystemBoundaryError(`Path resolves outside the allowed working root: ${requested}`)
  }
  return rebuilt
}

/** Resolves a directory and rejects files so callers can safely use it as a working root. */
export async function resolveDirectoryWithinRoot(inputPath: unknown, rootPath: string): Promise<string> {
  const resolved = await resolveExistingPathWithinRoot(inputPath, rootPath)
  const stats = await fs.stat(resolved)
  if (!stats.isDirectory()) throw new Error(`Working path is not a directory: ${resolved}`)
  return resolved
}

/**
 * Creates an IRIS-owned storage directory only when every path segment below the user's
 * home is a real directory. Rejecting symlinked storage roots prevents indexes or secrets
 * from being redirected to an attacker-selected location.
 */
export async function ensureInternalStorageDirectory(storageRoot: string): Promise<string> {
  const homeAbsolute = path.resolve(os.homedir())
  const rootAbsolute = path.resolve(storageRoot)
  assertLexicallyInside(homeAbsolute, rootAbsolute)

  // Create one path segment at a time only after confirming its parent is a real
  // directory. A recursive mkdir would follow an existing symlink before this module had
  // a chance to reject it and could therefore create files outside IRIS's storage tree.
  const relativeSegments = path.relative(homeAbsolute, rootAbsolute).split(path.sep).filter(Boolean)
  let current = homeAbsolute
  for (const segment of relativeSegments) {
    current = path.join(current, segment)
    let stats
    try {
      stats = await fs.lstat(current)
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') throw error
      await fs.mkdir(current, { mode: 0o700 })
      stats = await fs.lstat(current)
    }
    if (stats.isSymbolicLink()) {
      throw new FilesystemBoundaryError(`IRIS storage directory must not be a symlink: ${current}`)
    }
    if (!stats.isDirectory()) throw new Error(`IRIS storage path is not a directory: ${current}`)
  }

  const [homeCanonical, rootCanonical] = await Promise.all([fs.realpath(homeAbsolute), fs.realpath(rootAbsolute)])
  if (!pathIsInside(homeCanonical, rootCanonical)) {
    throw new FilesystemBoundaryError(`IRIS storage resolves outside the user's home: ${rootAbsolute}`)
  }
  return rootCanonical
}

/**
 * Verifies a path owned by IRIS's internal storage. This uses the same canonical checks
 * as user-facing filesystem routes while allowing callers to provide an already-built path.
 */
export async function assertInternalStoragePath(
  storageRoot: string,
  targetPath: string,
  options: { writable?: boolean } = {},
): Promise<string> {
  const relative = path.relative(path.resolve(storageRoot), path.resolve(targetPath))
  return options.writable
    ? resolveWritablePathWithinRoot(relative || '.', storageRoot)
    : resolveExistingPathWithinRoot(relative || '.', storageRoot)
}

async function canonicalRoots(rootPaths: string[]): Promise<string[]> {
  const roots = await Promise.all(rootPaths.map((rootPath) => canonicalRoot(rootPath)))
  return [...new Set(roots)]
}

function requestedAbsolutePathForRoots(inputPath: unknown, fallbackRoot: string): string {
  const expanded = expandHomePath(inputPath)
  if (!expanded) return path.resolve(fallbackRoot)
  return path.resolve(path.isAbsolute(expanded) ? expanded : path.join(fallbackRoot, expanded))
}

function matchingRoot(rootPaths: string[], targetPath: string): string | null {
  return rootPaths.find((rootPath) => pathIsInside(rootPath, targetPath)) || null
}

/**
 * Resolves an existing path against one of several explicit roots. Relative paths continue to
 * resolve against the fallback root so agent and compatibility callers retain their old behavior.
 */
export async function resolveExistingPathWithinRoots(
  inputPath: unknown,
  rootPaths: string[],
  fallbackRoot: string,
): Promise<string> {
  const absoluteRoots = [...new Set(rootPaths.map((rootPath) => path.resolve(rootPath)))]
  const requested = requestedAbsolutePathForRoots(inputPath, fallbackRoot)
  if (!matchingRoot(absoluteRoots, requested)) {
    throw new FilesystemBoundaryError(`Path is outside the allowed File Manager locations: ${requested}`)
  }
  const [roots, targetCanonical] = await Promise.all([canonicalRoots(absoluteRoots), fs.realpath(requested)])
  if (!matchingRoot(roots, targetCanonical)) {
    throw new FilesystemBoundaryError(`Path resolves outside the allowed File Manager locations: ${requested}`)
  }
  return targetCanonical
}

/** Resolves a directory against one of several explicit File Manager roots. */
export async function resolveDirectoryWithinRoots(
  inputPath: unknown,
  rootPaths: string[],
  fallbackRoot: string,
): Promise<string> {
  const resolved = await resolveExistingPathWithinRoots(inputPath, rootPaths, fallbackRoot)
  const stats = await fs.stat(resolved)
  if (!stats.isDirectory()) throw new Error(`File Manager path is not a directory: ${resolved}`)
  return resolved
}

/** Resolves a writable target against one of several explicit File Manager roots. */
export async function resolveWritablePathWithinRoots(
  inputPath: unknown,
  rootPaths: string[],
  fallbackRoot: string,
): Promise<string> {
  const absoluteRoots = [...new Set(rootPaths.map((rootPath) => path.resolve(rootPath)))]
  const requested = requestedAbsolutePathForRoots(inputPath, fallbackRoot)
  const lexicalRoot = matchingRoot(absoluteRoots, requested)
  if (!lexicalRoot) {
    throw new FilesystemBoundaryError(`Path is outside the allowed File Manager locations: ${requested}`)
  }
  const roots = await canonicalRoots(absoluteRoots)
  const ancestor = await nearestExistingAncestor(requested)
  const ancestorCanonical = await fs.realpath(ancestor)
  const canonicalMatch = matchingRoot(roots, ancestorCanonical)
  if (!canonicalMatch) {
    throw new FilesystemBoundaryError(`Path resolves outside the allowed File Manager locations: ${requested}`)
  }
  try {
    const targetCanonical = await fs.realpath(requested)
    if (!matchingRoot(roots, targetCanonical)) {
      throw new FilesystemBoundaryError(`Path resolves outside the allowed File Manager locations: ${requested}`)
    }
    return targetCanonical
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') throw error
  }
  const relativeTail = path.relative(ancestor, requested)
  const rebuilt = path.resolve(ancestorCanonical, relativeTail)
  if (!pathIsInside(canonicalMatch, rebuilt)) {
    throw new FilesystemBoundaryError(`Path resolves outside the allowed File Manager locations: ${requested}`)
  }
  return rebuilt
}
