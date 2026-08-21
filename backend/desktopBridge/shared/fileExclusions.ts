/**
 * Central hard exclusions for IRIS's file browser and semantic filesystem index.
 * Matching is intentionally context-free: excluded directory names are skipped wherever
 * they appear, without project detection or ancestor inspection.
 */

import path from 'node:path';

const EXCLUDED_DIRECTORY_NAMES = new Set(
  [
    'node_modules',
    'bower_components',
    'jspm_packages',
    'dist',
    'build',
    'out',
    'out-tsc',
    'storybook-static',
    'venv',
    'virtualenv',
    'env',
    '__pycache__',
    'site-packages',
    'htmlcov',
    'target',
    'classes',
    'generated',
    'generated-sources',
    'generated-test-sources',
    'bin',
    'obj',
    'debug',
    'debugpublic',
    'release',
    'releases',
    'artifacts',
    'testresults',
    'codecoverage',
    'cmakefiles',
    '_deps',
    'bazel-bin',
    'bazel-out',
    'bazel-testlogs',
    'vendor',
    'vendor-bundle',
    'vendor-cache',
    'pods',
    'deriveddata',
    'deriveddatacache',
    'xcuserdata',
    'captures',
    'library',
    'temp',
    'logs',
    'builds',
    'binaries',
    'intermediate',
    'saved',
    'coverage',
    'test-results',
    'test-output',
    'reports',
    'cache',
    'caches',
    'tmp',
  ].map((name) => name.toLowerCase()),
);

const EXCLUDED_DIRECTORY_PREFIXES = ['bazel-', 'cmake-build-'];
const EXCLUDED_DIRECTORY_SUFFIXES = ['.egg-info', '.dist-info'];

/** Returns true when one directory name must never be browsed or semantically indexed. */
export function isExcludedDirectoryName(name: string): boolean {
  const normalized = String(name || '')
    .trim()
    .toLowerCase();
  if (!normalized) return false;
  if (normalized.startsWith('.')) return true;
  if (EXCLUDED_DIRECTORY_NAMES.has(normalized)) return true;
  if (EXCLUDED_DIRECTORY_PREFIXES.some((prefix) => normalized.startsWith(prefix))) {
    return true;
  }
  return EXCLUDED_DIRECTORY_SUFFIXES.some((suffix) => normalized.endsWith(suffix));
}

/** Returns true when a descendant path contains any excluded directory segment. */
export function pathContainsExcludedDirectory(
  rootPath: string,
  targetPath: string,
  targetIsDirectory = false,
): boolean {
  const relativePath = path.relative(rootPath, targetPath);
  if (!relativePath || relativePath === '.') return false;
  if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    return false;
  }
  const segments = relativePath.split(path.sep).filter(Boolean);
  const directorySegments = targetIsDirectory ? segments : segments.slice(0, -1);
  return directorySegments.some(isExcludedDirectoryName);
}
