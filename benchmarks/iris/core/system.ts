/** Captures machine and runtime metadata required to compare benchmark history honestly. */

import { execFile } from 'node:child_process'
import { createRequire } from 'node:module'
import os from 'node:os'
import { promisify } from 'node:util'
import type { BenchmarkSystemInfo } from './types.js'

const execFileAsync = promisify(execFile)
const require = createRequire(import.meta.url)

/** Executes a metadata command without allowing an absent optional tool to abort the run. */
async function optionalCommand(command: string, args: string[]): Promise<string> {
  try {
    const result = await execFileAsync(command, args, {
      timeout: 5000,
      maxBuffer: 512 * 1024,
    })
    return String(result.stdout || result.stderr || '').trim()
  } catch {
    return ''
  }
}

/** Reads one installed package version without importing its runtime implementation. */
function packageVersion(packageName: string): string {
  try {
    return String((require(`${packageName}/package.json`) as { version?: string }).version || '')
  } catch {
    return ''
  }
}

/** Reads source revision, hardware, native-tool, and package details for the retained run. */
export async function readBenchmarkSystemInfo(): Promise<BenchmarkSystemInfo> {
  const cpu = os.cpus()[0]
  const [commit, branch, gpuSummary, ffmpegVersion, ollamaVersion] = await Promise.all([
    optionalCommand('git', ['rev-parse', '--short=12', 'HEAD']),
    optionalCommand('git', ['branch', '--show-current']),
    optionalCommand('nvidia-smi', [
      '--query-gpu=index,name,memory.total,driver_version',
      '--format=csv,noheader,nounits',
    ]),
    optionalCommand('ffmpeg', ['-version']),
    optionalCommand('ollama', ['--version']),
  ])
  return {
    generatedAt: new Date().toISOString(),
    platform: process.platform,
    release: os.release(),
    architecture: process.arch,
    hostname: os.hostname(),
    cpuModel: cpu?.model || 'unknown',
    logicalCpuCount: os.cpus().length,
    totalMemoryBytes: os.totalmem(),
    nodeVersion: process.version,
    v8Version: process.versions.v8 || '',
    electronVersion: process.versions.electron || '',
    sqliteVersion: packageVersion('sqlite3'),
    sharpVersion: packageVersion('sharp'),
    ffmpegVersion: ffmpegVersion.split('\n')[0] || '',
    ollamaVersion: ollamaVersion.split('\n')[0] || '',
    commit,
    branch,
    gpuSummary,
    command: process.argv.join(' '),
  }
}
