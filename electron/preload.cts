import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('editor_api', {
  platform: process.platform,
  app: {
    exit: () => ipcRenderer.send('app:exit'),
  },
  browser: {
    create: (id: number, url: string) => ipcRenderer.invoke('browser:create', id, url),
    destroy: (id: number) => ipcRenderer.send('browser:destroy', id),
    set_bounds: (id: number, bounds: { x: number; y: number; width: number; height: number }) =>
      ipcRenderer.send('browser:set-bounds', id, bounds),
    set_visible: (id: number, visible: boolean) => ipcRenderer.send('browser:set-visible', id, visible),
    navigate: (id: number, value: string) => ipcRenderer.send('browser:navigate', id, value),
    go_back: (id: number) => ipcRenderer.send('browser:go-back', id),
    go_forward: (id: number) => ipcRenderer.send('browser:go-forward', id),
    reload: (id: number) => ipcRenderer.send('browser:reload', id),
    on_state_change: (
      callback: (state: {
        id: number
        title: string
        url: string
        can_go_back: boolean
        can_go_forward: boolean
        loading: boolean
      }) => void,
    ) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        state: {
          id: number
          title: string
          url: string
          can_go_back: boolean
          can_go_forward: boolean
          loading: boolean
        },
      ) => callback(state)

      ipcRenderer.on('browser:state-change', listener)

      return () => {
        ipcRenderer.removeListener('browser:state-change', listener)
      }
    },
  },
  dialog: {
    open_file: () => ipcRenderer.invoke('dialog:open-file'),
    open_folder: () => ipcRenderer.invoke('dialog:open-folder'),
  },
  edit: {
    copy: () => ipcRenderer.send('edit:command', 'copy'),
    cut: () => ipcRenderer.send('edit:command', 'cut'),
    paste: () => ipcRenderer.send('edit:command', 'paste'),
  },
  file: {
    save_text: (options: {
      content: string
      file_path: string | null
      save_as: boolean
      suggested_name: string
      file_type_name: string
      file_extensions: string[]
    }) => ipcRenderer.invoke('file:save-text', options),
    read_text: (file_path: string) => ipcRenderer.invoke('file:read-text', file_path),
    check_paths: (file_paths: string[]) => ipcRenderer.invoke('file:check-paths', file_paths),
  },
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    update: (settings: unknown) => ipcRenderer.invoke('settings:update', settings),
  },
  window: {
    minimize: () => ipcRenderer.send('window:minimize'),
    toggle_maximize: () => ipcRenderer.send('window:toggle-maximize'),
    close: () => ipcRenderer.send('window:close'),
    is_maximized: () => ipcRenderer.invoke('window:is-maximized'),
    on_maximized_change: (callback: (is_maximized: boolean) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, is_maximized: boolean) => {
        callback(is_maximized)
      }

      ipcRenderer.on('window:maximized-change', listener)

      return () => {
        ipcRenderer.removeListener('window:maximized-change', listener)
      }
    },
    on_focus: (callback: () => void) => {
      const listener = () => callback()

      ipcRenderer.on('window:focus', listener)

      return () => {
        ipcRenderer.removeListener('window:focus', listener)
      }
    },
  },
})
