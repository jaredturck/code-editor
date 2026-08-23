/** Writes one AI-readable Markdown report and one normalized CSV export for the latest run. */

import fs from 'node:fs/promises'
import path from 'node:path'
import type { BenchmarkReport, BenchmarkResult, HistoricalBenchmarkResult } from './types.js'

/** Formats durations across microsecond, millisecond, and second scales. */
function formatMs(milliseconds: number | undefined | null): string {
  if (!Number.isFinite(milliseconds)) return '—'
  const value = Number(milliseconds)
  if (value < 0.01) return `${(value * 1000).toFixed(2)} μs`
  if (value < 1) return `${(value * 1000).toFixed(1)} μs`
  if (value < 1000) return `${value.toFixed(2)} ms`
  return `${(value / 1000).toFixed(2)} s`
}

/** Formats byte counts using binary units suitable for memory and model reports. */
function formatBytes(bytes: number | undefined | null): string {
  if (!Number.isFinite(bytes)) return '—'
  const value = Number(bytes)
  if (value >= 1024 ** 3) return `${(value / 1024 ** 3).toFixed(2)} GiB`
  if (value >= 1024 ** 2) return `${(value / 1024 ** 2).toFixed(2)} MiB`
  if (value >= 1024) return `${(value / 1024).toFixed(2)} KiB`
  return `${value.toFixed(0)} B`
}

/** Escapes Markdown table delimiters and line breaks without hiding benchmark errors. */
function markdownCell(value: unknown): string {
  return String(value ?? '')
    .replace(/\|/g, '\\|')
    .replace(/[\r\n]+/g, ' ')
    .trim()
}

/** Describes the change from the immediately preceding completed benchmark run. */
function comparisonText(result: BenchmarkResult, previous: Map<string, HistoricalBenchmarkResult>): string {
  if (result.status !== 'passed' || !result.statistics) return '—'
  const earlier = previous.get(`${result.id}\u0000${result.variantKey}`)
  if (!earlier?.medianMs || !result.statistics.medianMs) return 'new'
  const change = ((result.statistics.medianMs - earlier.medianMs) / earlier.medianMs) * 100
  if (Math.abs(change) < 0.1) return 'unchanged'
  return `${change > 0 ? '+' : ''}${change.toFixed(1)}% median`
}

/** Renders one concise suite table while retaining failure reasons and historical comparison. */
function suiteTable(results: BenchmarkResult[], previous: Map<string, HistoricalBenchmarkResult>): string {
  const rows = results.map((result) => {
    const detail = result.error || result.skipReason || ''
    return `| ${markdownCell(result.name)} | ${markdownCell(result.variantKey)} | ${result.status} | ${formatMs(result.statistics?.medianMs)} | ${formatMs(result.statistics?.p95Ms)} | ${result.operationsPerSecond?.toFixed(2) || '—'} | ${formatBytes(result.peakRssBytes)} | ${comparisonText(result, previous)} | ${markdownCell(detail)} |`
  })
  return [
    '| Benchmark | Variant | Status | Median | p95 | Ops/s | Peak RSS | Previous run | Notes |',
    '|---|---|---:|---:|---:|---:|---:|---:|---|',
    ...rows,
  ].join('\n')
}

/** Builds the single Markdown artifact intended for human and AI performance analysis. */
function renderMarkdown(report: BenchmarkReport, previous: Map<string, HistoricalBenchmarkResult>): string {
  const passed = report.results.filter((result) => result.status === 'passed').length
  const skipped = report.results.filter((result) => result.status === 'skipped').length
  const failed = report.results.filter((result) => result.status === 'failed').length
  const slowest = report.results
    .filter((result) => result.status === 'passed' && result.statistics)
    .sort((left, right) => Number(right.statistics?.medianMs || 0) - Number(left.statistics?.medianMs || 0))
    .slice(0, 20)
  const suites = [...new Set(report.results.map((result) => result.suite))]
  const failures = report.results.filter((result) => result.status !== 'passed')

  const sections = suites.map((suite) => {
    const results = report.results.filter((result) => result.suite === suite)
    return `## ${suite}\n\n${suiteTable(results, previous)}`
  })

  return `# IRIS Benchmark Report

This file is overwritten by every \`npm run benchmark\` execution. Historical results and raw samples remain in \`~/.iris-ai/iris-benchmark.sqlite3\`.

## Run summary

| Field | Value |
|---|---|
| Run ID | ${report.runId} |
| Run key | ${report.runKey} |
| Started | ${report.startedAt} |
| Finished | ${report.finishedAt} |
| Total duration | ${formatMs(report.elapsedMs)} |
| Passed | ${passed} |
| Failed | ${failed} |
| Skipped | ${skipped} |
| Blocked remote requests | ${report.remoteNetworkAttemptsBlocked} |

## Environment

| Field | Value |
|---|---|
| Platform | ${markdownCell(`${report.system.platform} ${report.system.release} ${report.system.architecture}`)} |
| Host | ${markdownCell(report.system.hostname)} |
| CPU | ${markdownCell(report.system.cpuModel)} |
| Logical CPUs | ${report.system.logicalCpuCount} |
| RAM | ${formatBytes(report.system.totalMemoryBytes)} |
| GPU | ${markdownCell(report.system.gpuSummary || 'not reported')} |
| Node | ${markdownCell(report.system.nodeVersion)} |
| Electron | ${markdownCell(report.system.electronVersion || 'not active in Node benchmark phase')} |
| SQLite | ${markdownCell(report.system.sqliteVersion)} |
| Sharp | ${markdownCell(report.system.sharpVersion)} |
| FFmpeg | ${markdownCell(report.system.ffmpegVersion)} |
| Ollama | ${markdownCell(report.system.ollamaVersion)} |
| Commit | ${markdownCell(report.system.commit || 'archive without Git metadata')} |
| Branch | ${markdownCell(report.system.branch || 'archive without Git metadata')} |

## Local model setup

| Role | Model | Runtime | Backend/device | Installed before | Downloaded | Setup/load | Status | Details |
|---|---|---|---|---:|---:|---:|---:|---|
${report.models
  .map(
    (model) =>
      `| ${markdownCell(model.modelRole)} | ${markdownCell(model.modelId)} | ${markdownCell(model.runtime)} | ${markdownCell([model.backend, model.device, model.dtype].filter(Boolean).join(' / '))} | ${model.installedBeforeRun ? 'yes' : 'no'} | ${model.downloadedDuringRun ? 'yes' : 'no'} | ${formatMs(model.downloadDurationMs ?? model.coldLoadDurationMs)} | ${model.available ? 'available' : 'failed'} | ${markdownCell(model.errorMessage || JSON.stringify(model.details || {}))} |`,
  )
  .join('\n')}

## Slowest measured operations

| Rank | Benchmark | Suite | Variant | Median | p95 | Throughput | Previous run |
|---:|---|---|---|---:|---:|---:|---:|
${slowest
  .map(
    (result, index) =>
      `| ${index + 1} | ${markdownCell(result.name)} | ${markdownCell(result.suite)} | ${markdownCell(result.variantKey)} | ${formatMs(result.statistics?.medianMs)} | ${formatMs(result.statistics?.p95Ms)} | ${result.operationsPerSecond?.toFixed(2) || '—'} ops/s | ${comparisonText(result, previous)} |`,
  )
  .join('\n')}

${sections.join('\n\n')}

## Incomplete or failed measurements

${
  failures.length
    ? failures
        .map(
          (result) =>
            `- **${markdownCell(result.id)}**: ${markdownCell(result.error || result.skipReason || result.status)}`,
        )
        .join('\n')
    : 'All benchmark cases completed successfully.'
}

## Output contract

- This Markdown report and \`results.csv\` are exports of the latest completed run.
- Historical runs, environments, model details, aggregate results, and samples remain queryable in the benchmark database.
- Production-style benchmark rows are removed after the run; the database file, schema, fixtures, model cache, and retained benchmark history remain.
- Remote provider APIs are blocked. Real model measurements use only local CLIP and loopback Ollama.
`
}

/** Escapes one CSV cell using RFC 4180-compatible quoting. */
function csvCell(value: unknown): string {
  const text = value == null ? '' : String(value)
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

/** Converts the latest database view into one flat CSV export. */
function renderCsv(rows: Record<string, unknown>[]): string {
  if (!rows.length) return ''
  const headers = Object.keys(rows[0])
  return [
    headers.map(csvCell).join(','),
    ...rows.map((row) => headers.map((header) => csvCell(row[header])).join(',')),
  ].join('\n')
}

/** Overwrites the two public benchmark artifacts and leaves historical storage to SQLite. */
export async function writeBenchmarkReport(options: {
  report: BenchmarkReport
  previous: Map<string, HistoricalBenchmarkResult>
  latestRows: Record<string, unknown>[]
  outputRoot?: string
}): Promise<{ markdownPath: string; csvPath: string }> {
  const outputRoot = path.resolve(options.outputRoot || 'benchmark-results')
  await fs.mkdir(outputRoot, { recursive: true })
  const markdownPath = path.join(outputRoot, 'report.md')
  const csvPath = path.join(outputRoot, 'results.csv')
  await Promise.all([
    fs.writeFile(markdownPath, `${renderMarkdown(options.report, options.previous).trim()}\n`, 'utf8'),
    fs.writeFile(csvPath, `${renderCsv(options.latestRows)}\n`, 'utf8'),
  ])
  return { markdownPath, csvPath }
}
