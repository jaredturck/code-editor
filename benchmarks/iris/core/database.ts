/** Persists benchmark history beside IRIS's production database without mixing application data. */

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import type { Database as SqliteDatabase } from 'sqlite3';
import {
  closeEncryptedDatabase,
  initializeEncryptedDatabase,
} from '../../../backend/desktopBridge/storage/encryptedDatabase.js';
import type {
  BenchmarkDefinition,
  BenchmarkModelInfo,
  BenchmarkResult,
  BenchmarkSystemInfo,
  HistoricalBenchmarkResult,
} from './types.js';

const require = createRequire(import.meta.url);

interface SqliteRuntime {
  Database: new (filename: string) => SqliteDatabase;
  verbose: () => SqliteRuntime;
}

interface RunResult {
  lastID: number;
  changes: number;
}

interface KeyRow {
  value: string;
}

const BENCHMARK_SCHEMA_VERSION = '2';
const BENCHMARK_DATABASE_FILENAME = 'iris-benchmark.sqlite3';

/** Returns the persistent benchmark database path in IRIS's normal application directory. */
export function benchmarkDatabasePath(): string {
  return path.join(os.homedir(), '.iris-ai', BENCHMARK_DATABASE_FILENAME);
}

/** Returns the persistent fixture directory reused by successive benchmark runs. */
export function benchmarkFixtureRoot(): string {
  return path.join(os.homedir(), '.iris-ai', 'benchmark-fixtures');
}

/** Wraps the callback-based sqlite3 package for benchmark history and export queries. */
class BenchmarkSqlite {
  readonly db: SqliteDatabase;

  /** Opens the raw sqlite3 connection used for benchmark history and export queries. */
  constructor(databasePath: string) {
    const sqlite = (require('sqlite3') as SqliteRuntime).verbose();
    this.db = new sqlite.Database(databasePath);
  }

  /** Executes one mutating SQL statement and returns its row-change metadata. */
  run(sql: string, params: unknown[] = []): Promise<RunResult> {
    return new Promise((resolve, reject) => {
      this.db.run(sql, params, function onRun(error) {
        if (error) reject(error);
        else resolve({ lastID: this.lastID, changes: this.changes });
      });
    });
  }

  /** Reads at most one typed row from the benchmark database. */
  get<T>(sql: string, params: unknown[] = []): Promise<T | undefined> {
    return new Promise((resolve, reject) => {
      this.db.get(sql, params, (error, row) => {
        if (error) reject(error);
        else resolve(row as T | undefined);
      });
    });
  }

  /** Reads all matching typed rows from the benchmark database. */
  all<T>(sql: string, params: unknown[] = []): Promise<T[]> {
    return new Promise((resolve, reject) => {
      this.db.all(sql, params, (error, rows) => {
        if (error) reject(error);
        else resolve((rows || []) as T[]);
      });
    });
  }

  /** Executes a schema, transaction, or multi-statement SQL script. */
  exec(sql: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.db.exec(sql, (error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  }

  /** Closes the raw benchmark-history connection after all writes are complete. */
  close(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.db.close((error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  }
}

const BENCHMARK_SCHEMA_SQL = `
  PRAGMA foreign_keys = ON;
  PRAGMA journal_mode = WAL;
  PRAGMA synchronous = FULL;
  PRAGMA busy_timeout = 5000;

  CREATE TABLE IF NOT EXISTS benchmark_schema_meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS benchmark_runs (
    run_id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_key TEXT NOT NULL UNIQUE,
    started_at TEXT NOT NULL,
    finished_at TEXT,
    status TEXT NOT NULL CHECK(status IN (
      'running', 'completed', 'completed_with_failures', 'failed', 'cancelled'
    )),
    app_version TEXT,
    git_commit TEXT,
    git_branch TEXT,
    benchmark_version TEXT,
    total_duration_ms REAL,
    total_cases INTEGER NOT NULL DEFAULT 0,
    passed_cases INTEGER NOT NULL DEFAULT 0,
    failed_cases INTEGER NOT NULL DEFAULT 0,
    skipped_cases INTEGER NOT NULL DEFAULT 0,
    models_downloaded INTEGER NOT NULL DEFAULT 0,
    remote_network_attempts_blocked INTEGER NOT NULL DEFAULT 0,
    cleanup_status TEXT NOT NULL DEFAULT 'not_started' CHECK(cleanup_status IN (
      'not_started', 'running', 'completed', 'failed'
    )),
    summary TEXT,
    failure_summary TEXT
  );

  CREATE TABLE IF NOT EXISTS benchmark_command_log (
    command_log_id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id INTEGER NOT NULL UNIQUE,
    command TEXT NOT NULL,
    working_directory TEXT NOT NULL,
    invoked_at TEXT NOT NULL,
    completed_at TEXT,
    process_id INTEGER,
    exit_code INTEGER,
    result TEXT NOT NULL CHECK(result IN ('running', 'success', 'partial', 'failed', 'cancelled')),
    duration_ms REAL,
    passed_cases INTEGER NOT NULL DEFAULT 0,
    failed_cases INTEGER NOT NULL DEFAULT 0,
    skipped_cases INTEGER NOT NULL DEFAULT 0,
    result_summary TEXT,
    error_summary TEXT,
    FOREIGN KEY(run_id) REFERENCES benchmark_runs(run_id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS benchmark_environments (
    run_id INTEGER PRIMARY KEY,
    hostname TEXT,
    operating_system TEXT,
    kernel_version TEXT,
    architecture TEXT,
    cpu_model TEXT,
    physical_cores INTEGER,
    logical_cores INTEGER,
    total_memory_bytes INTEGER,
    gpu_devices_json TEXT,
    storage_devices_json TEXT,
    node_version TEXT,
    electron_version TEXT,
    sqlite_version TEXT,
    sharp_version TEXT,
    ffmpeg_version TEXT,
    ollama_version TEXT,
    environment_json TEXT,
    FOREIGN KEY(run_id) REFERENCES benchmark_runs(run_id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS benchmark_cases (
    case_id TEXT PRIMARY KEY,
    suite TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT NOT NULL,
    category TEXT NOT NULL,
    benchmark_version INTEGER NOT NULL DEFAULT 1,
    primary_metric TEXT NOT NULL,
    default_unit TEXT NOT NULL,
    uses_local_model INTEGER NOT NULL DEFAULT 0,
    uses_database INTEGER NOT NULL DEFAULT 0,
    uses_filesystem INTEGER NOT NULL DEFAULT 0,
    enabled INTEGER NOT NULL DEFAULT 1,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS benchmark_results (
    result_id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id INTEGER NOT NULL,
    case_id TEXT NOT NULL,
    variant_key TEXT NOT NULL DEFAULT 'default',
    parameters_json TEXT,
    status TEXT NOT NULL CHECK(status IN ('passed', 'failed', 'skipped')),
    warmup_iterations INTEGER NOT NULL DEFAULT 0,
    measured_iterations INTEGER NOT NULL DEFAULT 0,
    sample_count INTEGER NOT NULL DEFAULT 0,
    total_duration_ms REAL,
    minimum_ms REAL,
    maximum_ms REAL,
    mean_ms REAL,
    median_ms REAL,
    p90_ms REAL,
    p95_ms REAL,
    p99_ms REAL,
    standard_deviation_ms REAL,
    throughput_value REAL,
    throughput_unit TEXT,
    items_processed INTEGER,
    bytes_processed INTEGER,
    peak_rss_bytes INTEGER,
    peak_heap_used_bytes INTEGER,
    peak_external_bytes INTEGER,
    peak_array_buffers_bytes INTEGER,
    user_cpu_ms REAL,
    system_cpu_ms REAL,
    disk_read_bytes INTEGER,
    disk_write_bytes INTEGER,
    average_gpu_utilization REAL,
    maximum_gpu_utilization REAL,
    peak_vram_bytes INTEGER,
    additional_metrics_json TEXT,
    notes TEXT,
    error_message TEXT,
    FOREIGN KEY(run_id) REFERENCES benchmark_runs(run_id) ON DELETE CASCADE,
    FOREIGN KEY(case_id) REFERENCES benchmark_cases(case_id),
    UNIQUE(run_id, case_id, variant_key)
  );

  CREATE TABLE IF NOT EXISTS benchmark_samples (
    sample_id INTEGER PRIMARY KEY AUTOINCREMENT,
    result_id INTEGER NOT NULL,
    iteration_index INTEGER NOT NULL,
    elapsed_ms REAL NOT NULL,
    items_processed INTEGER,
    bytes_processed INTEGER,
    rss_bytes INTEGER,
    heap_used_bytes INTEGER,
    external_bytes INTEGER,
    array_buffers_bytes INTEGER,
    user_cpu_ms REAL,
    system_cpu_ms REAL,
    gpu_utilization REAL,
    vram_used_bytes INTEGER,
    disk_read_bytes INTEGER,
    disk_write_bytes INTEGER,
    additional_metrics_json TEXT,
    FOREIGN KEY(result_id) REFERENCES benchmark_results(result_id) ON DELETE CASCADE,
    UNIQUE(result_id, iteration_index)
  );

  CREATE TABLE IF NOT EXISTS benchmark_models (
    benchmark_model_id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id INTEGER NOT NULL,
    model_role TEXT NOT NULL,
    runtime TEXT NOT NULL,
    model_id TEXT NOT NULL,
    model_path TEXT,
    backend TEXT,
    device TEXT,
    device_index INTEGER,
    dtype TEXT,
    installed_before_run INTEGER NOT NULL DEFAULT 0,
    downloaded_during_run INTEGER NOT NULL DEFAULT 0,
    download_duration_ms REAL,
    cold_load_duration_ms REAL,
    warm_load_duration_ms REAL,
    available INTEGER NOT NULL DEFAULT 0,
    error_message TEXT,
    additional_details_json TEXT,
    FOREIGN KEY(run_id) REFERENCES benchmark_runs(run_id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS benchmark_events (
    event_id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id INTEGER NOT NULL,
    result_id INTEGER,
    occurred_at TEXT NOT NULL,
    level TEXT NOT NULL CHECK(level IN ('debug', 'info', 'warning', 'error')),
    phase TEXT NOT NULL,
    event_type TEXT NOT NULL,
    message TEXT NOT NULL,
    details_json TEXT,
    FOREIGN KEY(run_id) REFERENCES benchmark_runs(run_id) ON DELETE CASCADE,
    FOREIGN KEY(result_id) REFERENCES benchmark_results(result_id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS benchmark_workload_state (
    singleton_id INTEGER PRIMARY KEY CHECK(singleton_id = 1),
    active_run_id INTEGER,
    dirty INTEGER NOT NULL DEFAULT 0,
    workload_started_at TEXT,
    cleanup_started_at TEXT,
    cleanup_completed_at TEXT,
    last_cleanup_error TEXT,
    FOREIGN KEY(active_run_id) REFERENCES benchmark_runs(run_id)
  );

  INSERT OR IGNORE INTO benchmark_workload_state(singleton_id, dirty) VALUES(1, 0);

  CREATE INDEX IF NOT EXISTS benchmark_runs_started_at_idx
    ON benchmark_runs(started_at DESC);
  CREATE INDEX IF NOT EXISTS benchmark_results_run_idx
    ON benchmark_results(run_id);
  CREATE INDEX IF NOT EXISTS benchmark_results_case_idx
    ON benchmark_results(case_id, variant_key, run_id DESC);
  CREATE INDEX IF NOT EXISTS benchmark_samples_result_idx
    ON benchmark_samples(result_id, iteration_index);
  CREATE INDEX IF NOT EXISTS benchmark_models_run_idx
    ON benchmark_models(run_id);
  CREATE INDEX IF NOT EXISTS benchmark_events_run_idx
    ON benchmark_events(run_id, occurred_at);

  CREATE VIEW IF NOT EXISTS benchmark_latest_completed_run AS
  SELECT * FROM benchmark_runs
  WHERE status IN ('completed', 'completed_with_failures')
  ORDER BY run_id DESC LIMIT 1;

  CREATE VIEW IF NOT EXISTS benchmark_latest_results AS
  SELECT
    r.run_id,
    c.suite,
    c.case_id,
    c.name,
    c.description,
    r.variant_key,
    r.parameters_json,
    r.status,
    r.measured_iterations,
    r.sample_count,
    r.mean_ms,
    r.median_ms,
    r.p95_ms,
    r.p99_ms,
    r.throughput_value,
    r.throughput_unit,
    r.peak_rss_bytes,
    r.peak_heap_used_bytes,
    r.peak_external_bytes,
    r.peak_array_buffers_bytes,
    r.user_cpu_ms,
    r.system_cpu_ms,
    r.notes,
    r.error_message
  FROM benchmark_results r
  JOIN benchmark_cases c ON c.case_id = r.case_id
  WHERE r.run_id = (
    SELECT MAX(run_id) FROM benchmark_runs
    WHERE status IN ('completed', 'completed_with_failures')
  );
`;

/** Owns one persistent benchmark database and its retained history. */
export class BenchmarkDatabase {
  private readonly sql: BenchmarkSqlite;
  readonly databasePath: string;
  readonly fixtureRoot: string;
  readonly masterKey: Buffer;

  /** Retains the production database path, fixture root, history connection, and benchmark key. */
  private constructor(
    databasePath: string,
    fixtureRoot: string,
    sql: BenchmarkSqlite,
    masterKey: Buffer,
  ) {
    this.databasePath = databasePath;
    this.fixtureRoot = fixtureRoot;
    this.sql = sql;
    this.masterKey = masterKey;
  }

  /** Opens the persistent benchmark database, applies both schemas, and retains one benchmark key. */
  static async open(
    options: { databasePath?: string; fixtureRoot?: string } = {},
  ): Promise<BenchmarkDatabase> {
    const databasePath = options.databasePath || benchmarkDatabasePath();
    const fixtureRoot = options.fixtureRoot || benchmarkFixtureRoot();
    await fs.mkdir(path.dirname(databasePath), {
      recursive: true,
      mode: 0o700,
    });
    await fs.mkdir(fixtureRoot, { recursive: true, mode: 0o700 });
    const sql = new BenchmarkSqlite(databasePath);
    await sql.exec(BENCHMARK_SCHEMA_SQL);
    const now = new Date().toISOString();
    await sql.run(
      `INSERT INTO benchmark_schema_meta(key, value, updated_at)
       VALUES('benchmark_schema_version', ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      [BENCHMARK_SCHEMA_VERSION, now],
    );
    let keyRow = await sql.get<KeyRow>(
      "SELECT value FROM benchmark_schema_meta WHERE key = 'benchmark_master_key_base64'",
    );
    if (!keyRow?.value) {
      const value = randomBytes(32).toString('base64');
      await sql.run(`INSERT INTO benchmark_schema_meta(key, value, updated_at) VALUES(?, ?, ?)`, [
        'benchmark_master_key_base64',
        value,
        now,
      ]);
      keyRow = { value };
    }
    const masterKey = Buffer.from(keyRow.value, 'base64');
    if (masterKey.length !== 32) throw new Error('Benchmark database key is malformed');
    await initializeEncryptedDatabase({ databasePath, masterKey });
    try {
      await fs.chmod(databasePath, 0o600);
    } catch {
      // Non-POSIX filesystems may not expose chmod semantics.
    }
    return new BenchmarkDatabase(databasePath, fixtureRoot, sql, masterKey);
  }

  /** Creates one retained run and command-log row before any workload data is written. */
  async beginRun(options: {
    startedAt: string;
    appVersion: string;
    gitCommit: string;
    gitBranch: string;
    command: string;
    workingDirectory: string;
  }): Promise<{ runId: number; runKey: string }> {
    const runKey = randomUUID();
    const run = await this.sql.run(
      `INSERT INTO benchmark_runs(
         run_key, started_at, status, app_version, git_commit, git_branch,
         benchmark_version, cleanup_status
       ) VALUES(?, ?, 'running', ?, ?, ?, ?, 'not_started')`,
      [
        runKey,
        options.startedAt,
        options.appVersion,
        options.gitCommit,
        options.gitBranch,
        BENCHMARK_SCHEMA_VERSION,
      ],
    );
    await this.sql.run(
      `INSERT INTO benchmark_command_log(
         run_id, command, working_directory, invoked_at, process_id, result
       ) VALUES(?, ?, ?, ?, ?, 'running')`,
      [run.lastID, options.command, options.workingDirectory, options.startedAt, process.pid],
    );
    return { runId: run.lastID, runKey };
  }

  /** Stores the machine and runtime details needed for honest historical comparisons. */
  async recordEnvironment(runId: number, system: BenchmarkSystemInfo): Promise<void> {
    await this.sql.run(
      `INSERT OR REPLACE INTO benchmark_environments(
         run_id, hostname, operating_system, kernel_version, architecture,
         cpu_model, logical_cores, total_memory_bytes, gpu_devices_json,
         node_version, electron_version, sqlite_version, sharp_version,
         ffmpeg_version, ollama_version, environment_json
       ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        runId,
        system.hostname,
        system.platform,
        system.release,
        system.architecture,
        system.cpuModel,
        system.logicalCpuCount,
        system.totalMemoryBytes,
        JSON.stringify(system.gpuSummary ? system.gpuSummary.split('\n') : []),
        system.nodeVersion,
        system.electronVersion,
        system.sqliteVersion,
        system.sharpVersion,
        system.ffmpegVersion,
        system.ollamaVersion,
        JSON.stringify(system),
      ],
    );
  }

  /** Registers stable benchmark case metadata independently from individual runs. */
  async registerCases(definitions: BenchmarkDefinition<any>[]): Promise<void> {
    const now = new Date().toISOString();
    await this.sql.exec('BEGIN IMMEDIATE');
    try {
      for (const definition of definitions) {
        const tags = new Set(definition.tags || []);
        await this.sql.run(
          `INSERT INTO benchmark_cases(
             case_id, suite, name, description, category, benchmark_version,
             primary_metric, default_unit, uses_local_model, uses_database,
             uses_filesystem, enabled, updated_at
           ) VALUES(?, ?, ?, ?, ?, 1, 'elapsed_time', 'milliseconds', ?, ?, ?, 1, ?)
           ON CONFLICT(case_id) DO UPDATE SET
             suite = excluded.suite,
             name = excluded.name,
             description = excluded.description,
             category = excluded.category,
             uses_local_model = excluded.uses_local_model,
             uses_database = excluded.uses_database,
             uses_filesystem = excluded.uses_filesystem,
             enabled = 1,
             updated_at = excluded.updated_at`,
          [
            definition.id,
            definition.suite,
            definition.name,
            definition.description,
            definition.suite,
            tags.has('local-model') ? 1 : 0,
            tags.has('database') ? 1 : 0,
            tags.has('filesystem') ? 1 : 0,
            now,
          ],
        );
      }
      await this.sql.exec('COMMIT');
    } catch (error) {
      await this.sql.exec('ROLLBACK').catch(() => undefined);
      throw error;
    }
  }

  /** Marks production-style benchmark tables as dirty until cleanup has completed. */
  async markWorkloadDirty(runId: number): Promise<void> {
    const now = new Date().toISOString();
    await this.sql.run(
      `UPDATE benchmark_workload_state
       SET active_run_id = ?, dirty = 1, workload_started_at = ?,
           cleanup_started_at = NULL, cleanup_completed_at = NULL, last_cleanup_error = NULL
       WHERE singleton_id = 1`,
      [runId, now],
    );
  }

  /** Deletes benchmark workload rows while preserving schema, history, and the database file itself. */
  async cleanupWorkloadData(runId?: number): Promise<void> {
    const startedAt = new Date().toISOString();
    if (runId) {
      await this.sql.run(`UPDATE benchmark_runs SET cleanup_status = 'running' WHERE run_id = ?`, [
        runId,
      ]);
    }
    await this.sql.run(
      `UPDATE benchmark_workload_state SET cleanup_started_at = ? WHERE singleton_id = 1`,
      [startedAt],
    );
    try {
      await this.sql.exec(`
        BEGIN IMMEDIATE;
        DELETE FROM artifact_chunks;
        DELETE FROM artifacts;
        DELETE FROM chat_messages;
        DELETE FROM chat_state;
        DELETE FROM chats;
        DELETE FROM subagent_outputs;
        DELETE FROM user_skills;
        DELETE FROM launcher_applications;
        DELETE FROM launcher_index_meta;
        DELETE FROM file_concept_memberships;
        DELETE FROM file_concepts;
        DELETE FROM video_frame_semantics;
        DELETE FROM file_semantics;
        DELETE FROM filesystem_nodes;
        DELETE FROM file_index_meta;
        DELETE FROM file_embedding_profile;
        DELETE FROM encrypted_store;
        COMMIT;
      `);
      const completedAt = new Date().toISOString();
      await this.sql.run(
        `UPDATE benchmark_workload_state
         SET active_run_id = NULL, dirty = 0, cleanup_completed_at = ?, last_cleanup_error = NULL
         WHERE singleton_id = 1`,
        [completedAt],
      );
      if (runId) {
        await this.sql.run(
          `UPDATE benchmark_runs SET cleanup_status = 'completed' WHERE run_id = ?`,
          [runId],
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.sql.run(
        `UPDATE benchmark_workload_state SET last_cleanup_error = ? WHERE singleton_id = 1`,
        [message],
      );
      if (runId) {
        await this.sql.run(`UPDATE benchmark_runs SET cleanup_status = 'failed' WHERE run_id = ?`, [
          runId,
        ]);
      }
      throw error;
    }
  }

  /** Persists one aggregate result and the measured samples used to derive its percentiles. */
  async recordResult(runId: number, result: BenchmarkResult): Promise<number> {
    const statistics = result.statistics;
    const notes = result.skipReason || '';
    const insertion = await this.sql.run(
      `INSERT INTO benchmark_results(
         run_id, case_id, variant_key, parameters_json, status,
         warmup_iterations, measured_iterations, sample_count, total_duration_ms,
         minimum_ms, maximum_ms, mean_ms, median_ms, p90_ms, p95_ms, p99_ms,
         standard_deviation_ms, throughput_value, throughput_unit,
         items_processed, bytes_processed, peak_rss_bytes, peak_heap_used_bytes,
         peak_external_bytes, peak_array_buffers_bytes, user_cpu_ms, system_cpu_ms,
         notes, error_message
       ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        runId,
        result.id,
        result.variantKey,
        JSON.stringify(result.parameters),
        result.status,
        result.warmupIterations,
        result.iterations,
        result.samplesMs.length,
        statistics?.totalMs ?? null,
        statistics?.minMs ?? null,
        statistics?.maxMs ?? null,
        statistics?.meanMs ?? null,
        statistics?.medianMs ?? null,
        statistics?.p90Ms ?? null,
        statistics?.p95Ms ?? null,
        statistics?.p99Ms ?? null,
        statistics?.standardDeviationMs ?? null,
        result.operationsPerSecond ?? null,
        result.operationsPerSecond ? 'operations/second' : null,
        result.operationsPerIteration * result.iterations,
        result.bytesPerOperation
          ? result.bytesPerOperation * result.operationsPerIteration * result.iterations
          : null,
        result.peakRssBytes ?? null,
        result.peakHeapUsedBytes ?? null,
        result.peakExternalBytes ?? null,
        result.peakArrayBuffersBytes ?? null,
        result.cpuUserMs ?? null,
        result.cpuSystemMs ?? null,
        notes,
        result.error ?? null,
      ],
    );
    if (result.samplesMs.length) {
      await this.sql.exec('BEGIN IMMEDIATE');
      try {
        for (let index = 0; index < result.samplesMs.length; index += 1) {
          await this.sql.run(
            `INSERT INTO benchmark_samples(
               result_id, iteration_index, elapsed_ms, items_processed, bytes_processed
             ) VALUES(?, ?, ?, ?, ?)`,
            [
              insertion.lastID,
              index,
              result.samplesMs[index],
              result.operationsPerIteration,
              result.bytesPerOperation
                ? result.bytesPerOperation * result.operationsPerIteration
                : null,
            ],
          );
        }
        await this.sql.exec('COMMIT');
      } catch (error) {
        await this.sql.exec('ROLLBACK').catch(() => undefined);
        throw error;
      }
    }
    return insertion.lastID;
  }

  /** Stores local model setup, backend, and download details for the current run. */
  async recordModel(runId: number, model: BenchmarkModelInfo): Promise<void> {
    await this.sql.run(
      `INSERT INTO benchmark_models(
         run_id, model_role, runtime, model_id, model_path, backend, device,
         device_index, dtype, installed_before_run, downloaded_during_run,
         download_duration_ms, cold_load_duration_ms, available, error_message,
         additional_details_json
       ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        runId,
        model.modelRole,
        model.runtime,
        model.modelId,
        model.modelPath || null,
        model.backend || null,
        model.device || null,
        model.deviceIndex ?? null,
        model.dtype || null,
        model.installedBeforeRun ? 1 : 0,
        model.downloadedDuringRun ? 1 : 0,
        model.downloadDurationMs ?? null,
        model.coldLoadDurationMs ?? null,
        model.available ? 1 : 0,
        model.errorMessage || null,
        JSON.stringify(model.details || {}),
      ],
    );
  }

  /** Appends a concise lifecycle event without retaining noisy stdout or sensitive payloads. */
  async recordEvent(
    runId: number,
    level: 'debug' | 'info' | 'warning' | 'error',
    phase: string,
    eventType: string,
    message: string,
    details: Record<string, unknown> = {},
    resultId?: number,
  ): Promise<void> {
    await this.sql.run(
      `INSERT INTO benchmark_events(
         run_id, result_id, occurred_at, level, phase, event_type, message, details_json
       ) VALUES(?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        runId,
        resultId ?? null,
        new Date().toISOString(),
        level,
        phase,
        eventType,
        message,
        JSON.stringify(details),
      ],
    );
  }

  /** Finalizes retained run and command rows with one concise command result. */
  async finishRun(options: {
    runId: number;
    finishedAt: string;
    durationMs: number;
    results: BenchmarkResult[];
    modelsDownloaded: number;
    remoteNetworkAttemptsBlocked: number;
    fatalError?: string;
  }): Promise<void> {
    const passed = options.results.filter((result) => result.status === 'passed').length;
    const failed = options.results.filter((result) => result.status === 'failed').length;
    const skipped = options.results.filter((result) => result.status === 'skipped').length;
    const status = options.fatalError
      ? 'failed'
      : failed || skipped
        ? 'completed_with_failures'
        : 'completed';
    const commandResult = options.fatalError ? 'failed' : failed || skipped ? 'partial' : 'success';
    const summary = `${passed} passed, ${failed} failed, ${skipped} skipped`;
    await this.sql.run(
      `UPDATE benchmark_runs SET
         finished_at = ?, status = ?, total_duration_ms = ?, total_cases = ?,
         passed_cases = ?, failed_cases = ?, skipped_cases = ?, models_downloaded = ?,
         remote_network_attempts_blocked = ?, summary = ?, failure_summary = ?
       WHERE run_id = ?`,
      [
        options.finishedAt,
        status,
        options.durationMs,
        options.results.length,
        passed,
        failed,
        skipped,
        options.modelsDownloaded,
        options.remoteNetworkAttemptsBlocked,
        summary,
        options.fatalError || null,
        options.runId,
      ],
    );
    await this.sql.run(
      `UPDATE benchmark_command_log SET
         completed_at = ?, exit_code = ?, result = ?, duration_ms = ?,
         passed_cases = ?, failed_cases = ?, skipped_cases = ?,
         result_summary = ?, error_summary = ?
       WHERE run_id = ?`,
      [
        options.finishedAt,
        commandResult === 'success' ? 0 : 1,
        commandResult,
        options.durationMs,
        passed,
        failed,
        skipped,
        summary,
        options.fatalError || null,
        options.runId,
      ],
    );
  }

  /** Reads the preceding completed run for percentage comparisons in the Markdown report. */
  async previousResults(runId: number): Promise<Map<string, HistoricalBenchmarkResult>> {
    const previousRun = await this.sql.get<{ run_id: number }>(
      `SELECT run_id FROM benchmark_runs
       WHERE run_id < ? AND status IN ('completed', 'completed_with_failures')
       ORDER BY run_id DESC LIMIT 1`,
      [runId],
    );
    if (!previousRun) return new Map();
    const rows = await this.sql.all<{
      case_id: string;
      variant_key: string;
      median_ms: number | null;
      p95_ms: number | null;
      throughput_value: number | null;
    }>(
      `SELECT case_id, variant_key, median_ms, p95_ms, throughput_value
       FROM benchmark_results WHERE run_id = ?`,
      [previousRun.run_id],
    );
    return new Map(
      rows.map((row) => [
        `${row.case_id}\u0000${row.variant_key}`,
        {
          caseId: row.case_id,
          variantKey: row.variant_key,
          medianMs: row.median_ms,
          p95Ms: row.p95_ms,
          operationsPerSecond: row.throughput_value,
        },
      ]),
    );
  }

  /** Exports the latest completed result view as flat records for CSV generation. */
  async latestResultRows(): Promise<Record<string, unknown>[]> {
    return this.sql.all<Record<string, unknown>>(
      `SELECT * FROM benchmark_latest_results ORDER BY suite, case_id, variant_key`,
    );
  }

  /** Checkpoints and closes both database connections while retaining the database itself. */
  async close(): Promise<void> {
    await closeEncryptedDatabase();
    await this.sql.exec('PRAGMA wal_checkpoint(TRUNCATE)').catch(() => undefined);
    await this.sql.close();
    this.masterKey.fill(0);
  }
}
