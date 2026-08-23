/** Covers the context-free hidden and generated-directory exclusions shared by browsing and indexing. */

import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  isExcludedDirectoryName,
  pathContainsExcludedDirectory,
} from '../../server/desktopBridge/shared/fileExclusions'

describe('file exclusions', () => {
  it.each([
    '.git',
    '.cache',
    'node_modules',
    'venv',
    '.venv',
    'ENV',
    'site-packages',
    '__pycache__',
    'dist',
    'build',
    'target',
    'vendor',
    'DerivedData',
    'Library',
    'Intermediate',
    'coverage',
    'bazel-project',
    'cmake-build-debug',
    'package.egg-info',
    'package.dist-info',
  ])('excludes %s wherever it appears', (name) => {
    expect(isExcludedDirectoryName(name)).toBe(true)
  })

  it.each(['Documents', 'Pictures', 'Projects', 'source', 'holiday-builds'])('keeps ordinary directory %s', (name) => {
    expect(isExcludedDirectoryName(name)).toBe(false)
  })

  it('detects excluded segments beneath a filesystem root', () => {
    const root = path.join(path.sep, 'home', 'user')
    expect(
      pathContainsExcludedDirectory(root, path.join(root, 'Projects', 'app', 'node_modules', 'library', 'index.js')),
    ).toBe(true)
    expect(pathContainsExcludedDirectory(root, path.join(root, 'Documents', 'notes.txt'))).toBe(false)
  })
})
