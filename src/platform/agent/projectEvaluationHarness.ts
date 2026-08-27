import { executeTerminalCommand } from '@/platform/desktopBridge'
import { inspectBrowserRuntime } from '@/platform/browserInspectionBridge'
import { formatWorkspaceDiagnostics, getWorkspaceDiagnosticsSnapshot } from '@/platform/agent/workspaceDiagnosticsState'
import {
  ensureManagedDevServer,
  managedProjectRuntimeEvidence,
} from '@/platform/agent/projectProcessManager'
import { mutateProjectLedger, type ProjectLedger } from '@/platform/agent/projectLedger'

const UI_PROJECT_PATTERN = /\b(web|website|webpage|frontend|front-end|react|vue|svelte|next|vite|html|css|ui|dashboard|browser|responsive)\b/i
const COMMAND_TIMEOUT_MS = 8 * 60_000

function outputText(result: any) {
  return String(result?.stdout || result?.output || result?.text || '').trim()
}

function errorText(result: any) {
  return String(result?.stderr || result?.error || '').trim()
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs = COMMAND_TIMEOUT_MS): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Verification timed out after ${Math.round(timeoutMs / 1000)}s.`)), timeoutMs)
  })
  try {
    return await Promise.race([promise, timeout])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

async function runCommand(cwd: string, command: string) {
  try {
    const result = await withTimeout(executeTerminalCommand(command, cwd))
    return {
      command,
      ok: Number((result as any)?.exitCode ?? (result as any)?.code ?? 0) === 0,
      exitCode: Number((result as any)?.exitCode ?? (result as any)?.code ?? 0),
      stdout: outputText(result).slice(-12_000),
      stderr: errorText(result).slice(-8_000),
    }
  } catch (error) {
    return {
      command,
      ok: false,
      exitCode: -1,
      stdout: '',
      stderr: error instanceof Error ? error.message : String(error),
    }
  }
}

async function packageScripts(cwd: string) {
  const read = await runCommand(cwd, "node -e \"const p=require('./package.json');console.log(JSON.stringify(p.scripts||{}))\"")
  if (!read.ok || !read.stdout) return {} as Record<string, string>
  try {
    const parsed = JSON.parse(read.stdout)
    return parsed && typeof parsed === 'object' ? parsed as Record<string, string> : {}
  } catch {
    return {}
  }
}

async function inferredVerification(cwd: string) {
  const scripts = await packageScripts(cwd)
  const selected: string[] = []
  for (const name of ['typecheck', 'check', 'lint', 'test', 'build']) {
    if (scripts[name] && selected.length < 3) selected.push(`npm run ${name}`)
  }
  if (!selected.length) {
    const python = await runCommand(cwd, "test -f pyproject.toml -o -f pytest.ini -o -d tests")
    if (python.ok) selected.push('python -m pytest -q')
  }
  const results = []
  for (const command of selected) results.push(await runCommand(cwd, command))
  return results
}

function verificationKind(command: string) {
  const value = command.toLowerCase()
  if (/typecheck|tsc\b|mypy|pyright/.test(value)) return 'typecheck'
  if (/\blint\b|eslint|oxlint|ruff/.test(value)) return 'lint'
  if (/\btest\b|vitest|jest|pytest|cargo test|go test/.test(value)) return 'test'
  if (/\bbuild\b|vite build|next build|cargo build/.test(value)) return 'build'
  return 'verification'
}

function persistVerification(chatId: string, ledger: ProjectLedger, verification: any[]) {
  if (!verification.length) return
  mutateProjectLedger(chatId, ledger.goal, (draft) => {
    const bySignature = new Map(
      draft.verification.map((record) => [`${record.generation}:${record.command}`, record]),
    )
    for (const result of verification) {
      const command = String(result?.command || '').trim()
      if (!command) continue
      const summary = [String(result?.stdout || '').trim(), String(result?.stderr || '').trim()]
        .filter(Boolean)
        .join('\n')
        .slice(-6000)
      const record = {
        id: `verify-${ledger.generation}-${Math.random().toString(36).slice(2, 9)}`,
        generation: ledger.generation,
        kind: verificationKind(command),
        command,
        ok: result?.ok === true,
        summary: summary || `Exit code ${Number(result?.exitCode ?? -1)}`,
        files: [],
        createdAt: Date.now(),
      }
      bySignature.set(`${ledger.generation}:${command}`, record)
    }
    draft.verification = [...bySignature.values()].slice(-300)
  })
}

async function gitEvidence(cwd: string) {
  const [status, diffStat, diff] = await Promise.all([
    runCommand(cwd, 'git status --porcelain=v1'),
    runCommand(cwd, 'git diff --stat'),
    runCommand(cwd, 'git diff --no-ext-diff --unified=3'),
  ])
  return {
    status: status.stdout.slice(0, 12_000),
    diffStat: diffStat.stdout.slice(0, 12_000),
    diff: diff.stdout.slice(0, 40_000),
  }
}

async function diagnosticsEvidence(cwd: string) {
  try {
    const snapshot = await getWorkspaceDiagnosticsSnapshot(cwd)
    return {
      available: true,
      counts: snapshot.counts,
      complete: snapshot.complete,
      report: formatWorkspaceDiagnostics(snapshot).slice(0, 30_000),
    }
  } catch (error) {
    return {
      available: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

async function browserEvidence(chatId: string, ledger: ProjectLedger, settings: Record<string, any>) {
  const cwd = String(settings.agent_working_dir || '').trim()
  if (!cwd || !UI_PROJECT_PATTERN.test(`${ledger.goal}\n${ledger.architectureSummary}`)) {
    return { applicable: false, managed: managedProjectRuntimeEvidence(chatId) }
  }
  try {
    const runtime = await ensureManagedDevServer(chatId, ledger.goal, cwd)
    const url = String(runtime.url || (runtime.process.port ? `http://127.0.0.1:${runtime.process.port}` : '')).trim()
    if (!url) {
      return {
        applicable: true,
        managed: managedProjectRuntimeEvidence(chatId),
        error: 'Managed dev server has no inspectable URL.',
      }
    }
    const inspection = await inspectBrowserRuntime(url, {
      settle_ms: 800,
      timeout_ms: 45_000,
      max_text_chars: 20_000,
    })
    return { applicable: true, url, managed: managedProjectRuntimeEvidence(chatId), inspection }
  } catch (error) {
    return {
      applicable: true,
      managed: managedProjectRuntimeEvidence(chatId),
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

/** Gather and persist fresh evaluator evidence independently of executor claims. */
export async function collectProjectEvaluationEvidence(
  chatId: string,
  ledger: ProjectLedger,
  settings: Record<string, any>,
  supplied: Record<string, unknown> = {},
) {
  const cwd = String(settings.agent_working_dir || '').trim()
  if (!cwd) return { supplied, error: 'No project workspace is open.' }

  const [git, diagnostics, verification, browser] = await Promise.all([
    gitEvidence(cwd),
    diagnosticsEvidence(cwd),
    inferredVerification(cwd),
    browserEvidence(chatId, ledger, settings),
  ])

  persistVerification(chatId, ledger, verification)

  return {
    supplied,
    collectedAt: Date.now(),
    generation: ledger.generation,
    git,
    diagnostics,
    verification,
    runtime: browser,
  }
}
