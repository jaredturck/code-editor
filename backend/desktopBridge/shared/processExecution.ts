/**
 * Runs operating-system utilities used by bridge features such as search, patching,
 * clipboard access, and diagnostics. It gives those callers consistent startup, timeout,
 * output collection, and cleanup behavior without routing structured arguments through a
 * shell.
 */

import { spawn } from 'node:child_process'

export interface ProcessExecutionOptions {
  cwd?: string
  env?: NodeJS.ProcessEnv
  timeoutMs?: number
  maxBufferBytes?: number
  input?: string | Buffer
  acceptedExitCodes?: number[]
}

export interface ProcessExecutionResult {
  stdout: string
  stderr: string
  exitCode: number
}

export class ProcessExecutionError extends Error {
  stdout: string
  stderr: string
  exitCode: number

  // Initializes the instance state required by process execution error.
  constructor(message: string, result: ProcessExecutionResult) {
    super(message)
    this.name = 'ProcessExecutionError'
    this.stdout = result.stdout
    this.stderr = result.stderr
    this.exitCode = result.exitCode
  }
}

/**
 * Starts one operating-system utility, captures bounded output, enforces timeout and abort
 * behavior, and returns a normalized result. All completion paths remove listeners and
 * timers so failed or cancelled processes do not leak runtime state.
 */

export async function runProcess(
  executable: string,
  args: string[] = [],
  options: ProcessExecutionOptions = {},
): Promise<ProcessExecutionResult> {
  const timeoutMs = Math.max(1, Number(options.timeoutMs) || 30_000)
  const maxBufferBytes = Math.max(1024, Number(options.maxBufferBytes) || 1024 * 1024)
  const acceptedExitCodes = new Set(options.acceptedExitCodes || [0])

  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd: options.cwd,
      env: options.env || process.env,
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    const stdoutChunks: Buffer[] = []
    const stderrChunks: Buffer[] = []
    let stdoutBytes = 0
    let stderrBytes = 0
    let settled = false
    let killedForLimit = false

    // Settles the current operation exactly once and publishes its terminal result.
    const finish = (callback: () => void): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      callback()
    }

    // Appends bounded process output while preserving the configured byte limit.
    const appendChunk = (chunks: Buffer[], chunk: Buffer, currentBytes: number): number => {
      const remaining = maxBufferBytes - currentBytes
      if (remaining <= 0) return currentBytes
      chunks.push(chunk.length > remaining ? chunk.subarray(0, remaining) : chunk)
      return currentBytes + Math.min(chunk.length, remaining)
    }

    child.stdout.on('data', (chunk: Buffer) => {
      stdoutBytes = appendChunk(stdoutChunks, Buffer.from(chunk), stdoutBytes)
      if (stdoutBytes >= maxBufferBytes && !killedForLimit) {
        killedForLimit = true
        child.kill('SIGTERM')
      }
    })

    child.stderr.on('data', (chunk: Buffer) => {
      stderrBytes = appendChunk(stderrChunks, Buffer.from(chunk), stderrBytes)
      if (stderrBytes >= maxBufferBytes && !killedForLimit) {
        killedForLimit = true
        child.kill('SIGTERM')
      }
    })

    child.once('error', (error) => {
      finish(() => reject(error))
    })

    child.once('close', (code) => {
      const result = {
        stdout: Buffer.concat(stdoutChunks).toString('utf8'),
        stderr: Buffer.concat(stderrChunks).toString('utf8'),
        exitCode: Number.isInteger(code) ? Number(code) : 1,
      }

      finish(() => {
        if (killedForLimit) {
          reject(new ProcessExecutionError('Process output exceeded the configured limit', result))
          return
        }
        if (!acceptedExitCodes.has(result.exitCode)) {
          reject(
            new ProcessExecutionError(
              result.stderr.trim() || `${executable} exited with code ${result.exitCode}`,
              result,
            ),
          )
          return
        }
        resolve(result)
      })
    })

    const timer = setTimeout(() => {
      child.kill('SIGTERM')
      const result = {
        stdout: Buffer.concat(stdoutChunks).toString('utf8'),
        stderr: Buffer.concat(stderrChunks).toString('utf8'),
        exitCode: 124,
      }
      finish(() => reject(new ProcessExecutionError(`${executable} timed out`, result)))
    }, timeoutMs)

    if (options.input !== undefined) child.stdin.end(options.input)
    else child.stdin.end()
  })
}

// Determines whether the command exists for bridge-side policy enforcement.
export async function commandExists(executable: string): Promise<boolean> {
  try {
    await runProcess('which', [executable], {
      timeoutMs: 2000,
      maxBufferBytes: 16 * 1024,
    })
    return true
  } catch {
    return false
  }
}
