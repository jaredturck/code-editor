/** Feature service surface for the corresponding desktop bridge routes. */
import * as runtime from './bridgeServiceRuntime.js'

export const DEFAULT_FIND_DEPTH = runtime.DEFAULT_FIND_DEPTH
export const DEFAULT_FIND_FUZZY_THRESHOLD = runtime.DEFAULT_FIND_FUZZY_THRESHOLD
export const DEFAULT_FIND_RESULTS = runtime.DEFAULT_FIND_RESULTS
export const DEFAULT_READ_LINE_COUNT = runtime.DEFAULT_READ_LINE_COUNT
export const DEFAULT_TREE_DEPTH = runtime.DEFAULT_TREE_DEPTH
export const MAX_READ_CHARS = runtime.MAX_READ_CHARS
export const MAX_READ_LINE_COUNT = runtime.MAX_READ_LINE_COUNT
export const buildTree = runtime.buildTree
export const fs = runtime.fs
export const isBinary = runtime.isBinary
export const launch = runtime.launch
export const launchLegacyCommand = runtime.launchLegacyCommand
export const parseNumber = runtime.parseNumber
export const path = runtime.path
export const readJsonBody = runtime.readJsonBody
export const resolveFindRootPath = runtime.resolveFindRootPath
export const resolvePath = runtime.resolvePath
export const runCommand = runtime.runCommand
export const saveArtifact = runtime.saveArtifact
export const listArtifacts = runtime.listArtifacts
export const readArtifact = runtime.readArtifact
export const sendJson = runtime.sendJson

export const findFiles = runtime.findFiles as (
  rootPath: string,
  options: {
    query?: unknown
    mode?: string
    useRegex?: boolean
    ignoreCase?: boolean
    depth?: number
    maxResults?: number
    fuzzy?: boolean
    fuzzyThreshold?: number
  },
) => Promise<Record<string, unknown>>
