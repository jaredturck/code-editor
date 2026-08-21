// @ts-nocheck
/**
 * Provides advanced local utilities such as ripgrep, find, fd, locate, diff, patch, web
 * fetch, environment inspection, clipboard access, and fixed maintenance scripts.
 * Structured tools execute programs directly with argument arrays so search text and paths
 * remain data.
 */

import type { BridgeRequest, BridgeResponse } from '../types.js';
import type { BridgeSecurityContext } from '../shared/bridgeAuthorization.js';
import { requireBridgePermission } from '../shared/bridgeAuthorization.js';
import {
  DEFAULT_WEB_FETCH_TIMEOUT_MS,
  POWER_TOOL_RG_MAX_RESULTS,
  POWER_TOOL_STAT_BATCH_MAX,
  commandExists,
  runProcess,
  extractArticleFromHtml,
  fetchHtmlWithTimeout,
  fs,
  path,
  readJsonBody,
  sendJson,
} from '../services/powerService.js';
import { openNativeFileDialog } from '../services/nativeFileDialogService.js';
import {
  resolveDirectoryWithinRoot,
  resolveExistingPathWithinRoot,
  resolveWritablePathWithinRoot,
} from '../shared/filesystemBoundary.js';
import { acquireOperation, operationLimitPayload } from '../shared/operationLimiter.js';
import { buildUnifiedDiff } from '../shared/unifiedDiff.js';

/** Handles structured content search, metadata inspection, and filename discovery routes. */
export async function handleStructuredSearchRoutes(
  req: BridgeRequest,
  res: BridgeResponse,
  baseDir: string,
  requestUrl: URL,
  pathname: string,
  securityContext?: BridgeSecurityContext,
): Promise<boolean> {
  // ── Power Tools ────────────────────────────────────────────────────────────────
  // search.ripgrep, search.find, files.stat — structured alternatives to raw terminal.exec
  // POST /api/local/power/ripgrep — content search across files
  //
  // Modes (mode):
  //   'content' (default) — line matches grouped by file, with optional surrounding context.
  //   'files'             — just the list of files that contain a match (fast, token-cheap).
  //   'count'             — per-file match counts.
  // Scanning power (off by default to respect .gitignore / hidden conventions):
  //   hidden        → include dotfiles/dot-dirs (rg --hidden)
  //   searchIgnored → also scan .gitignore'd / ignored files (rg --no-ignore)
  //   wordBoundary  → whole-word matches only (rg -w)
  //   multiline     → let the pattern span lines (rg -U)
  // Targeting: `type` (rg --type, e.g. "ts"), `globs` (array of include/exclude globs), `fileGlob`.
  if (pathname === '/api/local/power/ripgrep' && req.method === 'POST') {
    requireBridgePermission(securityContext, 'fileRead');
    const body = await readJsonBody(req);
    const pattern = String(body.pattern || '').trim();
    if (!pattern) {
      sendJson(res, 400, { error: 'pattern is required' });
      return true;
    }
    const searchPath = await resolveDirectoryWithinRoot(body.path || '.', baseDir);
    const mode = ['content', 'files', 'count'].includes(String(body.mode || '').toLowerCase())
      ? String(body.mode).toLowerCase()
      : 'content';
    // The result cap can now be raised well past the historic default for deeper sweeps, while a
    // request that omits it still gets the conservative default so token budgets stay predictable.
    const RG_RESULT_CEILING = 500;
    const maxResults = Math.min(
      RG_RESULT_CEILING,
      Math.max(
        1,
        Number.isFinite(Number(body.maxResults))
          ? Number(body.maxResults)
          : POWER_TOOL_RG_MAX_RESULTS,
      ),
    );
    const contextLines = Math.max(0, Math.min(10, Number(body.contextLines) || 2));
    const ignoreCase = body.ignoreCase !== false;
    const fixedStrings = body.fixedStrings === true;
    const wordBoundary = body.wordBoundary === true;
    const multiline = body.multiline === true;
    const hidden = body.hidden === true;
    const searchIgnored = body.searchIgnored === true || body.noIgnore === true;
    const fileGlob = body.fileGlob ? String(body.fileGlob).trim() : '';
    const typeFilter = body.type ? String(body.type).trim() : '';
    const globList = Array.isArray(body.globs)
      ? body.globs
          .map((g) => String(g))
          .filter(Boolean)
          .slice(0, 12)
      : [];
    const usedFallback = !(await commandExists('rg'));

    const commonRgFlags = [
      ...(ignoreCase ? ['-i'] : []),
      ...(fixedStrings ? ['-F'] : []),
      ...(wordBoundary ? ['-w'] : []),
      ...(multiline ? ['-U'] : []),
      ...(hidden ? ['--hidden'] : []),
      ...(searchIgnored ? ['--no-ignore'] : []),
      ...(typeFilter ? ['--type', typeFilter] : []),
      ...(fileGlob ? ['--glob', fileGlob] : []),
      ...globList.flatMap((g) => ['--glob', g]),
    ];

    try {
      let executable: string;
      let args: string[];
      if (mode === 'files') {
        executable = usedFallback ? 'grep' : 'rg';
        args = usedFallback
          ? [
              '-rl',
              ...(ignoreCase ? ['-i'] : []),
              ...(fixedStrings ? ['-F'] : []),
              '--',
              pattern,
              searchPath,
            ]
          : ['--files-with-matches', ...commonRgFlags, '--', pattern, searchPath];
      } else if (mode === 'count') {
        executable = usedFallback ? 'grep' : 'rg';
        args = usedFallback
          ? [
              '-rc',
              ...(ignoreCase ? ['-i'] : []),
              ...(fixedStrings ? ['-F'] : []),
              '--',
              pattern,
              searchPath,
            ]
          : ['--count-matches', ...commonRgFlags, '--', pattern, searchPath];
      } else {
        executable = usedFallback ? 'grep' : 'rg';
        args = usedFallback
          ? [
              '-rn',
              ...(ignoreCase ? ['-i'] : []),
              ...(fixedStrings ? ['-F'] : []),
              ...(wordBoundary ? ['-w'] : []),
              ...(contextLines > 0 ? ['-C', String(contextLines)] : []),
              '--',
              pattern,
              searchPath,
            ]
          : [
              '--json',
              ...commonRgFlags,
              ...(contextLines > 0 ? ['-C', String(contextLines)] : []),
              '--max-count',
              String(maxResults),
              '--',
              pattern,
              searchPath,
            ];
      }

      const { stdout } = await runProcess(executable, args, {
        cwd: baseDir,
        timeoutMs: 30_000,
        maxBufferBytes: 4 * 1024 * 1024,
        acceptedExitCodes: [0, 1],
      });

      if (mode === 'files') {
        const files = stdout.trim().split('\n').filter(Boolean).slice(0, maxResults);
        sendJson(res, 200, {
          mode,
          files,
          totalFiles: files.length,
          usedFallback,
          command: usedFallback ? 'grep' : 'rg',
        });
        return true;
      }

      if (mode === 'count') {
        // rg --count-matches and grep -rc both emit `path:count` lines.
        const counts = stdout
          .trim()
          .split('\n')
          .filter(Boolean)
          .map((line) => {
            const sep = line.lastIndexOf(':');
            const file = sep >= 0 ? line.slice(0, sep) : line;
            const count = sep >= 0 ? Number(line.slice(sep + 1)) || 0 : 0;
            return { file, count };
          })
          .filter((entry) => entry.count > 0)
          .sort((a, b) => b.count - a.count)
          .slice(0, maxResults);
        const totalMatches = counts.reduce((sum, entry) => sum + entry.count, 0);
        sendJson(res, 200, {
          mode,
          counts,
          totalMatches,
          totalFiles: counts.length,
          usedFallback,
          command: usedFallback ? 'grep' : 'rg',
        });
        return true;
      }

      // content mode
      const matches = [];
      if (!usedFallback) {
        for (const line of stdout.split('\n').filter(Boolean)) {
          try {
            const parsed = JSON.parse(line);
            if (parsed.type === 'match') {
              matches.push({
                file: String(parsed.data?.path?.text || ''),
                line: Number(parsed.data?.line_number || 0),
                content: String(parsed.data?.lines?.text || '').replace(/\n$/, ''),
              });
            }
          } catch {
            // Skip malformed rg JSON lines.
          }
        }
      } else {
        for (const line of stdout.split('\n').filter(Boolean)) {
          const match = line.match(/^([^:]+):(\d+):(.*)/);
          if (match)
            matches.push({
              file: match[1],
              line: Number(match[2]),
              content: match[3],
            });
        }
      }
      const limited = matches.slice(0, maxResults);
      // Group by file so the model reads one file header + its hits instead of a flat repeat of
      // the path on every line — clearer and noticeably cheaper in tokens on dense matches.
      const grouped: Record<string, { line: number; content: string }[]> = {};
      for (const match of limited) {
        (grouped[match.file] ||= []).push({ line: match.line, content: match.content });
      }
      const byFile = Object.entries(grouped).map(([file, hits]) => ({ file, hits }));
      sendJson(res, 200, {
        mode,
        matches: limited,
        byFile,
        totalMatches: matches.length,
        truncated: matches.length > limited.length,
        usedFallback,
        command: usedFallback ? 'grep' : 'rg',
      });
    } catch (error) {
      sendJson(res, 200, {
        mode,
        matches: [],
        totalMatches: 0,
        error: String(error?.message || 'Search failed'),
        usedFallback,
      });
    }
    return true;
  }

  // POST /api/local/power/stat — batch file metadata without reading content
  if (pathname === '/api/local/power/stat' && req.method === 'POST') {
    requireBridgePermission(securityContext, 'fileRead');
    const body = await readJsonBody(req);
    const rawPaths = Array.isArray(body.path) ? body.path : [body.path];
    const targetPaths = await Promise.all(
      rawPaths
        .filter(Boolean)
        .slice(0, POWER_TOOL_STAT_BATCH_MAX)
        .map((p) => resolveWritablePathWithinRoot(String(p), baseDir)),
    );
    const files = await Promise.all(
      targetPaths.map(async (targetPath) => {
        try {
          const stat = await fs.stat(targetPath);
          let lines = 0;
          if (stat.isFile() && stat.size < 2 * 1024 * 1024) {
            try {
              const text = await fs.readFile(targetPath, 'utf8');
              lines = text.split('\n').length;
            } catch {
              /* binary or unreadable — leave lines=0 */
            }
          }
          return {
            path: targetPath,
            exists: true,
            sizeKb: Math.round((stat.size / 1024) * 10) / 10,
            lines,
            modifiedAt: stat.mtime.toISOString(),
            isDir: stat.isDirectory(),
            isSymlink: stat.isSymbolicLink(),
            permissions: (stat.mode & 0o777).toString(8),
          };
        } catch {
          return { path: targetPath, exists: false };
        }
      }),
    );
    sendJson(res, 200, { files });
    return true;
  }

  // POST /api/local/power/find — structured find wrapper
  if (pathname === '/api/local/power/find' && req.method === 'POST') {
    requireBridgePermission(securityContext, 'fileRead');
    const body = await readJsonBody(req);
    const targetPath = await resolveDirectoryWithinRoot(String(body.path || '.'), baseDir);
    const args = [targetPath];
    if (body.type) args.push('-type', String(body.type).charAt(0));
    if (body.maxDepth) args.push('-maxdepth', String(Math.min(10, Number(body.maxDepth))));
    if (body.name) args.push('-name', String(body.name));
    if (body.newerThan) args.push('-newer', String(body.newerThan));
    if (body.minSizeKb) args.push('-size', `+${Math.round(Number(body.minSizeKb))}k`);
    if (body.maxSizeKb) args.push('-size', `-${Math.round(Number(body.maxSizeKb))}k`);
    if (Array.isArray(body.exclude)) {
      for (const exclusion of body.exclude.slice(0, 5)) {
        args.push('!', '-name', String(exclusion));
      }
    }
    const maxResults = Number.isFinite(Number(body.maxResults)) ? Number(body.maxResults) : 40;
    try {
      const { stdout } = await runProcess('find', args, {
        cwd: baseDir,
        timeoutMs: 30_000,
        maxBufferBytes: 1024 * 1024,
      });
      const results = stdout
        .trim()
        .split('\n')
        .filter(Boolean)
        .slice(0, maxResults)
        .map((resultPath) => ({ path: resultPath }));
      sendJson(res, 200, { results, total: results.length, command: 'find' });
    } catch (error) {
      sendJson(res, 200, { results: [], total: 0, error: error.message });
    }
    return true;
  }

  // POST /api/local/power/fd — fd-find fast search
  if (pathname === '/api/local/power/fd' && req.method === 'POST') {
    requireBridgePermission(securityContext, 'fileRead');
    const body = await readJsonBody(req);
    const targetPath = await resolveDirectoryWithinRoot(String(body.path || '.'), baseDir);
    const maxResults = Number.isFinite(Number(body.maxResults)) ? Number(body.maxResults) : 40;
    const fdExecutable = (await commandExists('fd'))
      ? 'fd'
      : (await commandExists('fdfind'))
        ? 'fdfind'
        : '';
    try {
      let executable = fdExecutable;
      let args;
      if (fdExecutable) {
        args = [];
        if (body.pattern) args.push(String(body.pattern));
        if (body.extension) args.push('--extension', String(body.extension));
        if (body.type) args.push('--type', String(body.type));
        if (body.hidden) args.push('--hidden');
        if (body.maxDepth) args.push('--max-depth', String(Math.min(10, Number(body.maxDepth))));
        if (Array.isArray(body.exclude)) {
          for (const exclusion of body.exclude.slice(0, 5))
            args.push('--exclude', String(exclusion));
        }
        args.push(targetPath);
      } else {
        executable = 'find';
        args = [targetPath];
        if (body.maxDepth) args.push('-maxdepth', String(Math.min(10, Number(body.maxDepth))));
        if (body.type) args.push('-type', String(body.type).charAt(0));
        if (body.pattern) args.push('-name', `*${String(body.pattern)}*`);
      }
      const { stdout } = await runProcess(executable, args, {
        cwd: baseDir,
        timeoutMs: 20_000,
        maxBufferBytes: 1024 * 1024,
      });
      const results = stdout
        .trim()
        .split('\n')
        .filter(Boolean)
        .slice(0, maxResults)
        .map((resultPath) => ({ path: resultPath }));
      sendJson(res, 200, {
        results,
        total: results.length,
        tool: fdExecutable || 'find-fallback',
      });
    } catch (error) {
      sendJson(res, 200, {
        results: [],
        total: 0,
        error: error.message,
        tool: fdExecutable || 'find-fallback',
      });
    }
    return true;
  }

  // POST /api/local/power/locate — system locate database
  if (pathname === '/api/local/power/locate' && req.method === 'POST') {
    requireBridgePermission(securityContext, 'fileRead');
    const body = await readJsonBody(req);
    const pattern = String(body.pattern || '').trim();
    if (!pattern) {
      sendJson(res, 400, { error: 'pattern required' });
      return true;
    }
    const limit = Number.isFinite(Number(body.limit)) ? Math.min(100, Number(body.limit)) : 20;
    try {
      const stats = await runProcess('locate', ['--statistics'], {
        timeoutMs: 3000,
        maxBufferBytes: 128 * 1024,
      }).catch(() => ({ stdout: '', stderr: '', exitCode: 1 }));
      const databaseModified =
        stats.stdout.split('\n').find((line) => /Database modified/i.test(line)) || '';
      const { stdout } = await runProcess(
        'locate',
        [...(body.caseSensitive ? [] : ['-i']), '--', pattern],
        {
          timeoutMs: 10_000,
          maxBufferBytes: 1024 * 1024,
          acceptedExitCodes: [0, 1],
        },
      );
      const paths = stdout.trim().split('\n').filter(Boolean).slice(0, limit);
      sendJson(res, 200, { paths, total: paths.length, databaseModified });
    } catch (error) {
      sendJson(res, 200, {
        paths: [],
        total: 0,
        error: `locate not available: ${error.message}`,
      });
    }
    return true;
  }

  return false;
}

/** Handles diff generation and validated patch application routes. */
export async function handleFileChangePreviewRoutes(
  req: BridgeRequest,
  res: BridgeResponse,
  baseDir: string,
  requestUrl: URL,
  pathname: string,
  securityContext?: BridgeSecurityContext,
): Promise<boolean> {
  // POST /api/local/power/diff — unified diff
  if (pathname === '/api/local/power/diff' && req.method === 'POST') {
    requireBridgePermission(securityContext, 'fileRead');
    const body = await readJsonBody(req);
    const targetPath = await resolveWritablePathWithinRoot(String(body.path || ''), baseDir);
    const newContent = String(body.newContent || '');
    const contextLines = Number.isFinite(Number(body.contextLines)) ? Number(body.contextLines) : 3;
    try {
      const existing = await fs.readFile(targetPath, 'utf8').catch(() => '');
      // Real LCS-based unified diff: a single insertion no longer mislabels every following line
      // as changed, so the preview reflects the minimal edit.
      const result = buildUnifiedDiff(existing, newContent, {
        contextLines,
        fromLabel: targetPath,
        toLabel: `${targetPath} (proposed)`,
      });
      sendJson(res, 200, {
        diff: result.diff,
        added: result.added,
        removed: result.removed,
        hunks: result.hunks,
        unchanged: result.unchanged,
        linesChanged: result.added + result.removed,
        path: targetPath,
      });
    } catch (err) {
      sendJson(res, 500, { error: err.message });
    }
    return true;
  }

  // POST /api/local/power/patch — apply patch
  if (pathname === '/api/local/power/patch' && req.method === 'POST') {
    requireBridgePermission(securityContext, 'fileWrite');
    const body = await readJsonBody(req);
    const targetPath = await resolveExistingPathWithinRoot(String(body.path || ''), baseDir);
    const patchText = String(body.patch || '');
    const dryRun = Boolean(body.dryRun);
    if (!patchText) {
      sendJson(res, 400, { error: 'patch required' });
      return true;
    }
    try {
      const { stdout, stderr } = await runProcess(
        'patch',
        [...(dryRun ? ['--dry-run'] : []), targetPath],
        {
          timeoutMs: 15_000,
          maxBufferBytes: 1024 * 1024,
          input: patchText,
        },
      );
      sendJson(res, 200, {
        applied: !dryRun,
        dryRun,
        stdout,
        stderr,
        path: targetPath,
      });
    } catch (error) {
      sendJson(res, 200, { applied: false, error: error.message });
    }
    return true;
  }

  return false;
}

/** Handles bounded web extraction and host environment inspection routes. */
export async function handleWebAndEnvironmentRoutes(
  req: BridgeRequest,
  res: BridgeResponse,
  baseDir: string,
  requestUrl: URL,
  pathname: string,
  securityContext?: BridgeSecurityContext,
): Promise<boolean> {
  // POST /api/local/power/webfetch — direct URL fetch with Readability
  if (pathname === '/api/local/power/webfetch' && req.method === 'POST') {
    const body = await readJsonBody(req);
    const url = String(body.url || '').trim();
    if (!url || !/^https?:\/\//.test(url)) {
      sendJson(res, 400, { error: 'valid https url required' });
      return true;
    }
    const maxChars = Number.isFinite(Number(body.maxChars))
      ? Math.max(200, Number(body.maxChars))
      : 20000;
    const permit = acquireOperation('web');
    if (!permit.allowed) {
      sendJson(res, 429, operationLimitPayload(permit));
      return true;
    }
    try {
      const fetched = await fetchHtmlWithTimeout(url, DEFAULT_WEB_FETCH_TIMEOUT_MS);
      const article = extractArticleFromHtml(fetched.text, fetched.url || url);
      const content = String(article.text || '')
        .replace(/[ \t]+/g, ' ')
        .trim()
        .slice(0, maxChars);
      const note = article.jsRendered
        ? content
          ? 'JavaScript-rendered page — content recovered from its metadata/structured data (the full text loads client-side).'
          : "JavaScript-rendered page with no static content; only metadata was available. Try the site's API or a more specific URL."
        : '';
      sendJson(res, 200, {
        content,
        title: article.title || '',
        url: fetched.url || url,
        length: content.length,
        httpStatus: fetched.status,
        jsRendered: Boolean(article.jsRendered),
        ...(note ? { note } : {}),
      });
    } catch (err) {
      sendJson(res, 200, {
        content: '',
        title: '',
        url,
        length: 0,
        jsRendered: false,
        error: String(err?.message || 'fetch failed'),
      });
    } finally {
      permit.release();
    }
    return true;
  }

  // POST /api/local/power/env — system environment snapshot
  if (pathname === '/api/local/power/env' && req.method === 'POST') {
    // Exposes environment variables, PATH, and the process/port list — gate behind the
    // read capability so a token-bearing caller cannot enumerate the host without it.
    requireBridgePermission(securityContext, 'fileRead');
    const body = await readJsonBody(req);
    const include = Array.isArray(body.include)
      ? body.include.map(String)
      : ['processes', 'ports', 'tools', 'env'];
    const result = {};
    if (include.includes('processes')) {
      try {
        const args =
          process.platform === 'darwin'
            ? ['-Aco', 'pid,pcpu,pmem,comm']
            : ['aux', '--no-header', '--sort=-%mem'];
        const { stdout } = await runProcess('ps', args, {
          timeoutMs: 5000,
          maxBufferBytes: 2 * 1024 * 1024,
        });
        result.processes = stdout
          .trim()
          .split('\n')
          .map((line) => line.trim())
          .filter(Boolean)
          .slice(0, 15);
      } catch {
        result.processes = [];
      }
    }
    if (include.includes('ports')) {
      try {
        const portResult = (await commandExists('ss'))
          ? await runProcess('ss', ['-tlnp'], {
              timeoutMs: 5000,
              maxBufferBytes: 512 * 1024,
            })
          : await runProcess('netstat', ['-tlnp'], {
              timeoutMs: 5000,
              maxBufferBytes: 512 * 1024,
            });
        result.ports = portResult.stdout.trim().split('\n').filter(Boolean).slice(0, 20);
      } catch {
        result.ports = [];
      }
    }
    if (include.includes('tools')) {
      const toolList = [
        'node',
        'npm',
        'git',
        'rg',
        'fd',
        'locate',
        'python3',
        'pip3',
        'docker',
        'cargo',
        'go',
      ];
      const checks = await Promise.all(
        toolList.map(async (tool) => {
          try {
            const { stdout } = await runProcess('which', [tool], {
              timeoutMs: 2000,
              maxBufferBytes: 16 * 1024,
            });
            return [tool, stdout.trim()];
          } catch {
            return [tool, null];
          }
        }),
      );
      result.tools = Object.fromEntries(checks.filter(([, toolPath]) => toolPath));
    }
    if (include.includes('env')) {
      const safeKeys = ['NODE_ENV', 'PATH', 'HOME', 'USER', 'SHELL', 'TERM', 'LANG', 'PWD'];
      result.env = Object.fromEntries(
        safeKeys.map((key) => [key, process.env[key] || '']).filter(([, value]) => value),
      );
    }
    sendJson(res, 200, result);
    return true;
  }

  return false;
}

/** Handles clipboard reads and writes through the available desktop command-line backend. */
export async function handleClipboardRoutes(
  req: BridgeRequest,
  res: BridgeResponse,
  baseDir: string,
  requestUrl: URL,
  pathname: string,
  securityContext?: BridgeSecurityContext,
): Promise<boolean> {
  // GET /api/local/power/clipboard/read
  if (pathname === '/api/local/power/clipboard/read' && req.method === 'GET') {
    // The clipboard may hold passwords or other secrets the user copied. Treat reading it
    // as a sensitive read operation rather than an always-available capability.
    requireBridgePermission(securityContext, 'fileRead');
    const candidates = [
      ['xclip', ['-selection', 'clipboard', '-o']],
      ['xsel', ['--clipboard', '--output']],
      ['pbpaste', []],
    ];
    let lastError;
    for (const [executable, args] of candidates) {
      try {
        const { stdout } = await runProcess(executable, args, {
          timeoutMs: 5000,
          maxBufferBytes: 1024 * 1024,
        });
        sendJson(res, 200, { content: stdout, type: 'text' });
        return true;
      } catch (error) {
        lastError = error;
      }
    }
    sendJson(res, 200, {
      content: '',
      type: 'text',
      error: `clipboard not available: ${lastError?.message || 'no clipboard tool found'}`,
    });
    return true;
  }

  // POST /api/local/power/clipboard/write
  if (pathname === '/api/local/power/clipboard/write' && req.method === 'POST') {
    // Writing the clipboard mutates host state the user may paste elsewhere — gate it
    // behind the write capability.
    requireBridgePermission(securityContext, 'fileWrite');
    const body = await readJsonBody(req);
    const content = String(body.content || '');
    const candidates = [
      ['xclip', ['-selection', 'clipboard']],
      ['xsel', ['--clipboard', '--input']],
      ['pbcopy', []],
    ];
    let lastError;
    for (const [executable, args] of candidates) {
      try {
        await runProcess(executable, args, {
          timeoutMs: 5000,
          maxBufferBytes: 128 * 1024,
          input: content,
        });
        sendJson(res, 200, { ok: true });
        return true;
      } catch (error) {
        lastError = error;
      }
    }
    sendJson(res, 200, {
      ok: false,
      error: lastError?.message || 'clipboard not available',
    });
    return true;
  }

  return false;
}

/** Handles fixed maintenance scripts and the native file-dialog route. */
export async function handleScriptAndDialogRoutes(
  req: BridgeRequest,
  res: BridgeResponse,
  baseDir: string,
  requestUrl: URL,
  pathname: string,
  securityContext?: BridgeSecurityContext,
): Promise<boolean> {
  // POST /api/local/power/script — run a named built-in orbit script
  if (pathname === '/api/local/power/script' && req.method === 'POST') {
    requireBridgePermission(securityContext, 'terminal');
    const body = await readJsonBody(req);
    const scriptName = String(body.script || '').trim();
    const allowedScripts = new Set([
      'orbit-explore-project',
      'orbit-explore-git',
      'orbit-audit-secrets',
      'orbit-audit-size',
      'orbit-find-config',
      'orbit-find-todos',
      'orbit-snapshot-workspace',
      'orbit-explore-deps',
    ]);
    if (!allowedScripts.has(scriptName)) {
      sendJson(res, 400, { error: `Unknown script: ${scriptName}` });
      return true;
    }
    const scriptPath = path.join(
      path.dirname(new URL(import.meta.url).pathname),
      '..',
      'scripts',
      `${scriptName}.sh`,
    );
    const cwd = await resolveDirectoryWithinRoot(body.cwd || '.', baseDir);
    const scriptArgs =
      body.args && typeof body.args === 'object'
        ? Object.values(body.args).map(String).slice(0, 50)
        : [];
    try {
      const startMs = Date.now();
      const { stdout, stderr } = await runProcess('bash', [scriptPath, ...scriptArgs], {
        cwd,
        timeoutMs: 30_000,
        maxBufferBytes: 512 * 1024,
      });
      const executionMs = Date.now() - startMs;
      let parsed;
      try {
        parsed = JSON.parse(stdout.trim());
      } catch {
        parsed = {
          script: scriptName,
          success: true,
          summary: stdout.slice(0, 200),
          data: { raw: stdout },
        };
      }
      sendJson(res, 200, { ...parsed, executionMs });
    } catch (err) {
      sendJson(res, 200, {
        script: scriptName,
        success: false,
        summary: `Script failed: ${err.message}`,
        data: { stderr: err.stderr || err.message },
        executionMs: 0,
      });
    }
    return true;
  }

  // POST /api/local/system/open-file-dialog — Electron or fallback file picker
  if (pathname === '/api/local/system/open-file-dialog' && req.method === 'POST') {
    const body = await readJsonBody(req);
    const result = await openNativeFileDialog({
      multiple: Boolean(body.multiple !== false),
      accept: Array.isArray(body.accept) ? body.accept : ['*'],
    });
    sendJson(res, 200, result);
    return true;
  }

  return false;
}

/**
 * Handles structured power-tool requests from the local bridge. Route families remain ordered
 * exactly as before while each subsystem can now be reviewed and tested independently.
 */
export async function handlePowerRoutes(
  req: BridgeRequest,
  res: BridgeResponse,
  baseDir: string,
  requestUrl: URL,
  pathname: string,
  securityContext?: BridgeSecurityContext,
): Promise<boolean> {
  if (await handleStructuredSearchRoutes(req, res, baseDir, requestUrl, pathname, securityContext))
    return true;
  if (await handleFileChangePreviewRoutes(req, res, baseDir, requestUrl, pathname, securityContext))
    return true;
  if (await handleWebAndEnvironmentRoutes(req, res, baseDir, requestUrl, pathname, securityContext))
    return true;
  if (await handleClipboardRoutes(req, res, baseDir, requestUrl, pathname, securityContext))
    return true;
  if (await handleScriptAndDialogRoutes(req, res, baseDir, requestUrl, pathname, securityContext))
    return true;

  return false;
}
