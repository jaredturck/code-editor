export async function inspectBrowserRuntime(
  url: string,
  options: { settle_ms?: number; timeout_ms?: number; max_text_chars?: number } = {},
) {
  if (typeof window === 'undefined' || !window.editor_api?.browser?.inspect_runtime) {
    throw new Error('Browser runtime inspection is unavailable in this environment.')
  }
  return window.editor_api.browser.inspect_runtime(url, options)
}
