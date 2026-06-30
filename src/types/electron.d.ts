interface WindowControlsApi {
  minimize: () => void
  toggle_maximize: () => void
  close: () => void
  is_maximized: () => Promise<boolean>
  on_maximized_change: (callback: (is_maximized: boolean) => void) => () => void
}

interface AppControlsApi {
  exit: () => void
}

interface DialogApi {
  open_file: () => Promise<string | null>
  open_folder: () => Promise<string | null>
}

interface EditorApi {
  platform: string
  app: AppControlsApi
  dialog: DialogApi
  window: WindowControlsApi
}

interface Window {
  editor_api: EditorApi
}
