/** Defines stable contracts shared by benchmark suites, persistence, and report exports. */

export type BenchmarkStatus = 'passed' | 'skipped' | 'failed';

export interface BenchmarkEnvironment {
  runId: number;
  runKey: string;
  startedAt: string;
  databasePath: string;
  databaseKey: Buffer;
  fixtureRoot: string;
}

export interface BenchmarkSkip {
  skip: true;
  reason: string;
}

export interface BenchmarkDefinition<Context = undefined> {
  id: string;
  suite: string;
  name: string;
  description: string;
  variantKey?: string;
  parameters?: Record<string, unknown>;
  tags?: string[];
  iterations?: number;
  warmupIterations?: number;
  operationsPerIteration?: number;
  bytesPerOperation?: number;
  setup?: (
    environment: BenchmarkEnvironment,
  ) => Promise<Context | BenchmarkSkip> | Context | BenchmarkSkip;
  run: (context: Context, iteration: number) => Promise<unknown> | unknown;
  teardown?: (context: Context) => Promise<void> | void;
}

export interface BenchmarkStatistics {
  count: number;
  totalMs: number;
  meanMs: number;
  medianMs: number;
  minMs: number;
  maxMs: number;
  p90Ms: number;
  p95Ms: number;
  p99Ms: number;
  standardDeviationMs: number;
}

export interface BenchmarkResult {
  id: string;
  suite: string;
  name: string;
  description: string;
  variantKey: string;
  parameters: Record<string, unknown>;
  tags: string[];
  status: BenchmarkStatus;
  skipReason?: string;
  error?: string;
  iterations: number;
  warmupIterations: number;
  operationsPerIteration: number;
  bytesPerOperation?: number;
  samplesMs: number[];
  statistics?: BenchmarkStatistics;
  operationsPerSecond?: number;
  mebibytesPerSecond?: number;
  cpuUserMs?: number;
  cpuSystemMs?: number;
  peakRssBytes?: number;
  peakHeapUsedBytes?: number;
  peakExternalBytes?: number;
  peakArrayBuffersBytes?: number;
  elapsedMs: number;
}

export interface BenchmarkSystemInfo {
  generatedAt: string;
  platform: string;
  release: string;
  architecture: string;
  hostname: string;
  cpuModel: string;
  logicalCpuCount: number;
  totalMemoryBytes: number;
  nodeVersion: string;
  v8Version: string;
  electronVersion: string;
  sqliteVersion: string;
  sharpVersion: string;
  ffmpegVersion: string;
  ollamaVersion: string;
  commit: string;
  branch: string;
  gpuSummary: string;
  command: string;
}

export interface BenchmarkModelInfo {
  modelRole: string;
  runtime: string;
  modelId: string;
  modelPath?: string;
  backend?: string;
  device?: string;
  deviceIndex?: number;
  dtype?: string;
  installedBeforeRun: boolean;
  downloadedDuringRun: boolean;
  downloadDurationMs?: number;
  coldLoadDurationMs?: number;
  available: boolean;
  errorMessage?: string;
  details?: Record<string, unknown>;
}

export interface BenchmarkReport {
  schemaVersion: 2;
  runId: number;
  runKey: string;
  startedAt: string;
  finishedAt: string;
  elapsedMs: number;
  system: BenchmarkSystemInfo;
  models: BenchmarkModelInfo[];
  results: BenchmarkResult[];
  remoteNetworkAttemptsBlocked: number;
}

export interface HistoricalBenchmarkResult {
  caseId: string;
  variantKey: string;
  medianMs: number | null;
  p95Ms: number | null;
  operationsPerSecond: number | null;
}
