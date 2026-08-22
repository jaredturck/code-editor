/**
 * Keeps the privileged editor renderer pinned to its own application URL. The preload exposes
 * filesystem, terminal, Git, credential and bridge controls, so a remote document must never
 * inherit that bridge by replacing the main renderer navigation.
 */
export function is_trusted_renderer_navigation(value: string, trusted_url: string) {
  try {
    const target = new URL(value)
    const trusted = new URL(trusted_url)

    if (trusted.protocol === 'file:') {
      return target.protocol === 'file:'
        && target.host === trusted.host
        && target.pathname === trusted.pathname
    }

    return target.origin === trusted.origin
  } catch {
    return false
  }
}

export function is_privileged_editor_preload(value: unknown) {
  const path = String(value || '').replace(/\\/g, '/')
  return path.slice(path.lastIndexOf('/') + 1) === 'preload.cjs'
}
