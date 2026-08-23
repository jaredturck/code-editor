/** Feature service surface for the corresponding desktop bridge routes. */
export {
  DEFAULT_WEB_FETCH_TIMEOUT_MS,
  JSDOM,
  POWER_TOOL_RG_MAX_RESULTS,
  POWER_TOOL_STAT_BATCH_MAX,
  Readability,
  escapeSingleQuotedShellArg,
  exec,
  execAsync,
  extractArticleFromHtml,
  fetchHtmlWithTimeout,
  fs,
  path,
  readJsonBody,
  resolvePath,
  sendJson,
} from './bridgeServiceRuntime.js'

export { commandExists, runProcess } from '../shared/processExecution.js'
