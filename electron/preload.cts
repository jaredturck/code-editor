import { contextBridge } from 'electron'

contextBridge.exposeInMainWorld('editor_api', {
  platform: process.platform,
})
