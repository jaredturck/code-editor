import { app, BrowserWindow, ipcMain } from 'electron'
import path = require('node:path')
import { pathToFileURL } from 'node:url'
import { is_trusted_renderer_navigation } from './navigationSecurity.cjs'

interface FileSemanticModule {
  getFileSemanticStatus: (homePath: string, buildIfMissing?: boolean) => Promise<Record<string, unknown>>
  searchFileSemanticIndex: (query: unknown, limit?: unknown, kind?: unknown) => Promise<Array<Record<string, unknown>>>
  searchFileSemanticConcepts: (
    query: unknown,
    groupLimit?: unknown,
    filesPerGroup?: unknown,
  ) => Promise<Array<Record<string, unknown>>>
  findSimilarFiles: (filePath: unknown, limit?: unknown) => Promise<Array<Record<string, unknown>>>
}

interface DocumentInspectionModule {
  inspectIndexedDocument: (baseDir: string, requestedPath: unknown) => Promise<Record<string, unknown>>
}

let semanticModulePromise: Promise<FileSemanticModule> | null = null
let documentModulePromise: Promise<DocumentInspectionModule> | null = null

function trustedRendererUrl() {
  return app.isPackaged ? pathToFileURL(path.join(__dirname, '../dist/index.html')).toString() : 'http://localhost:5173'
}

function trustedSender(sender: Electron.WebContents) {
  if (!is_trusted_renderer_navigation(sender.getURL(), trustedRendererUrl())) return null
  return BrowserWindow.fromWebContents(sender)
}

function backendModuleUrl(relativePath: string) {
  return pathToFileURL(path.join(__dirname, '..', 'backend-dist', ...relativePath.split('/'))).href
}

function loadSemanticModule() {
  semanticModulePromise ??= import(
    backendModuleUrl('desktopBridge/services/fileSemanticService.js')
  ) as Promise<FileSemanticModule>
  return semanticModulePromise
}

function loadDocumentModule() {
  documentModulePromise ??= import(
    backendModuleUrl('desktopBridge/services/documentInspectionService.js')
  ) as Promise<DocumentInspectionModule>
  return documentModulePromise
}

function requireTrustedSearchSender(sender: Electron.WebContents) {
  if (!trustedSender(sender)) throw new Error('Search request was not sent by the trusted editor renderer.')
}

ipcMain.handle('search:semantic-status', async (event) => {
  requireTrustedSearchSender(event.sender)
  return (await loadSemanticModule()).getFileSemanticStatus(app.getPath('home'), false)
})

ipcMain.handle('search:semantic', async (event, query: string, limit = 50, kind = 'all') => {
  requireTrustedSearchSender(event.sender)
  return (await loadSemanticModule()).searchFileSemanticIndex(query, limit, kind)
})

ipcMain.handle('search:concepts', async (event, query: string, groupLimit = 6, filesPerGroup = 12) => {
  requireTrustedSearchSender(event.sender)
  return (await loadSemanticModule()).searchFileSemanticConcepts(query, groupLimit, filesPerGroup)
})

ipcMain.handle('search:similar', async (event, filePath: string, limit = 50) => {
  requireTrustedSearchSender(event.sender)
  return (await loadSemanticModule()).findSimilarFiles(filePath, limit)
})

ipcMain.handle('search:inspect-document', async (event, filePath: string) => {
  requireTrustedSearchSender(event.sender)
  return (await loadDocumentModule()).inspectIndexedDocument(app.getPath('home'), filePath)
})
