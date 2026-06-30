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

interface EditorApi {
  platform: string
  app: AppControlsApi
  window: WindowControlsApi
}

interface Window {
  editor_api: EditorApi
}
