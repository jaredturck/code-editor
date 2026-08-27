import { exec } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import { resolveDirectoryWithinRoot } from '../shared/filesystemBoundary.js'

const exec_async = promisify(exec)
const MAX_COMMAND_OUTPUT_SIZE = 50 * 1024
export const TERMINAL_COMMAND_TIMEOUT_MS = 90_000

function trim_output(value: unknown) {
  const text = String(value || '')
  return text.length > MAX_COMMAND_OUTPUT_SIZE ? text.slice(0, MAX_COMMAND_OUTPUT_SIZE) : text
}

function parse_cd_command(command: string) {
  const match = /^cd(?:\s+(.+))?$/.exec(command.trim())
  if (!match) return null
  const rest = String(match[1] || '').trim()
  if (!rest) return ''
  if (/[\r\n;&|`$()<>]/.test(rest)) return null
  if ((rest.startsWith('"') && rest.endsWith('"')) || (rest.startsWith("'") && rest.endsWith("'"))) {
    return rest.slice(1, -1)
  }
  if (/\s/.test(rest)) return null
  return rest
}

export async function runCommand(command: string, cwd: string, root_dir = cwd) {
  const cd_target = parse_cd_command(command)
  if (cd_target !== null) {
    try {
      const requested = cd_target
        ? path.isAbsolute(cd_target)
          ? cd_target
          : path.join(cwd, cd_target)
        : root_dir
      const next_cwd = await resolveDirectoryWithinRoot(requested, root_dir)
      const stats = await fs.stat(next_cwd)
      if (!stats.isDirectory()) {
        return {
          stdout: '',
          stderr: `cd: not a directory: ${next_cwd}`,
          exitCode: 1,
          cwd,
        }
      }

      return {
        stdout: '',
        stderr: '',
        exitCode: 0,
        cwd: next_cwd,
      }
    } catch (error) {
      return {
        stdout: '',
        stderr: `cd: ${error instanceof Error ? error.message : 'failed to change directory'}`,
        exitCode: 1,
        cwd,
      }
    }
  }

  try {
    const { stdout, stderr } = await exec_async(command, {
      cwd,
      timeout: TERMINAL_COMMAND_TIMEOUT_MS,
      maxBuffer: 1024 * 1024,
      env: process.env,
    })

    return {
      stdout: trim_output(stdout),
      stderr: trim_output(stderr),
      exitCode: 0,
      cwd,
    }
  } catch (error) {
    const failure = error as {
      stdout?: unknown
      stderr?: unknown
      message?: unknown
      code?: unknown
    }
    return {
      stdout: trim_output(failure.stdout),
      stderr: trim_output(failure.stderr || failure.message),
      exitCode: typeof failure.code === 'number' ? failure.code : 1,
      cwd,
    }
  }
}
