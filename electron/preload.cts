import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('editor_api', {
  platform: process.platform,
  app: {
    exit: () => ipcRenderer.send('app:exit'),
    confirm_close: (allow_close: boolean) => ipcRenderer.send('app:close-response', allow_close),
    on_close_request: (callback: () => void) => {
      const listener = () => callback()
      ipcRenderer.on('app:close-request', listener)
      return () => ipcRenderer.removeListener('app:close-request', listener)
    },
  },
  ai: {
    list_models: (base_url: string) => ipcRenderer.invoke('ai:list-models', base_url),
    model_capabilities: (base_url: string, model: string) =>
      ipcRenderer.invoke('ai:model-capabilities', base_url, model),
    start_chat: (request: unknown) => ipcRenderer.send('ai:chat-start', request),
    cancel_chat: (request_id: string) => ipcRenderer.send('ai:chat-cancel', request_id),
    speech_status: (base_url: string, speech_model: string) =>
      ipcRenderer.invoke('ai:speech-status', base_url, speech_model),
    install_speech_model: (base_url: string, speech_model: string) =>
      ipcRenderer.invoke('ai:install-speech-model', base_url, speech_model),
    transcribe: (base_url: string, speech_model: string, audio: Uint8Array) =>
      ipcRenderer.invoke('ai:transcribe', base_url, speech_model, audio),
    on_chat_chunk: (callback: (payload: unknown) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, payload: unknown) => callback(payload)
      ipcRenderer.on('ai:chat-chunk', listener)
      return () => ipcRenderer.removeListener('ai:chat-chunk', listener)
    },
    on_chat_complete: (callback: (payload: unknown) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, payload: unknown) => callback(payload)
      ipcRenderer.on('ai:chat-complete', listener)
      return () => ipcRenderer.removeListener('ai:chat-complete', listener)
    },
    on_chat_error: (callback: (payload: unknown) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, payload: unknown) => callback(payload)
      ipcRenderer.on('ai:chat-error', listener)
      return () => ipcRenderer.removeListener('ai:chat-error', listener)
    },
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
      return () => ipcRenderer.removeListener('browser:state-change', listener)
    },
  },
  diagnostics: {
    analyze: (input: unknown) => ipcRenderer.invoke('diagnostics:analyze', input),
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
    open: (file_path: string) => ipcRenderer.invoke('file:open', file_path),
    check_paths: (file_paths: string[]) => ipcRenderer.invoke('file:check-paths', file_paths),
    resolve_relative: (base_file_path: string, relative_path: string) =>
      ipcRenderer.invoke('file:resolve-relative', base_file_path, relative_path),
    read_attachment: (file_path: string) => ipcRenderer.invoke('file:read-attachment', file_path),
    open_external: (url: string) => ipcRenderer.send('file:open-external', url),
  },
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    update: (settings: unknown) => ipcRenderer.invoke('settings:update', settings),
  },
  terminal: {
    create: (terminal_id: number) => ipcRenderer.invoke('terminal:create', terminal_id),
    write: (terminal_id: number, data: string) => ipcRenderer.send('terminal:write', terminal_id, data),
    resize: (terminal_id: number, cols: number, rows: number) =>
      ipcRenderer.send('terminal:resize', terminal_id, cols, rows),
    kill: (terminal_id: number) => ipcRenderer.send('terminal:kill', terminal_id),
    on_data: (callback: (payload: { terminal_id: number; data: string }) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, payload: { terminal_id: number; data: string }) =>
        callback(payload)
      ipcRenderer.on('terminal:data', listener)
      return () => ipcRenderer.removeListener('terminal:data', listener)
    },
    on_exit: (callback: (payload: { terminal_id: number; exit_code: number; signal: number }) => void) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        payload: { terminal_id: number; exit_code: number; signal: number },
      ) => callback(payload)
      ipcRenderer.on('terminal:exit', listener)
      return () => ipcRenderer.removeListener('terminal:exit', listener)
    },
  },
  window: {
    minimize: () => ipcRenderer.send('window:minimize'),
    toggle_maximize: () => ipcRenderer.send('window:toggle-maximize'),
    close: () => ipcRenderer.send('window:close'),
    is_maximized: () => ipcRenderer.invoke('window:is-maximized'),
    on_maximized_change: (callback: (is_maximized: boolean) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, is_maximized: boolean) => callback(is_maximized)
      ipcRenderer.on('window:maximized-change', listener)
      return () => ipcRenderer.removeListener('window:maximized-change', listener)
    },
    on_focus: (callback: () => void) => {
      const listener = () => callback()
      ipcRenderer.on('window:focus', listener)
      return () => ipcRenderer.removeListener('window:focus', listener)
    },
  },
})
