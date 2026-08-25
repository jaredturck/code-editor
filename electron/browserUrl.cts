function loopback_host_from_input(value: string) {
  const authority = value.split(/[/?#]/, 1)[0].toLowerCase()
  if (authority.startsWith('[')) {
    const end = authority.indexOf(']')
    return end >= 0 ? authority.slice(1, end) : authority
  }
  return authority.split(':', 1)[0]
}

function is_loopback_browser_target(value: string) {
  const host = loopback_host_from_input(value)
  return host === 'localhost' || host === '::1' || host === '0.0.0.0' || /^127(?:\.\d{1,3}){3}$/.test(host)
}

export function normalize_browser_url(value: string) {
  const trimmed_value = value.trim()

  if (!trimmed_value) return 'https://duckduckgo.com/'
  if (/^https?:\/\//i.test(trimmed_value)) return trimmed_value
  if (!trimmed_value.includes(' ') && is_loopback_browser_target(trimmed_value)) {
    return `http://${trimmed_value}`
  }
  if (!trimmed_value.includes(' ') && trimmed_value.includes('.')) {
    return `https://${trimmed_value}`
  }
  return `https://duckduckgo.com/?q=${encodeURIComponent(trimmed_value)}`
}
