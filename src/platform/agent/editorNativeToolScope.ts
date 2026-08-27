const workspaceNativeTools = ['diagnostics.check'] as const

export function withEditorNativeToolScope(settings: Record<string, any> | null | undefined) {
  if (!settings || !String(settings.agent_working_dir || '').trim()) return settings

  const configured = Array.isArray(settings.agent_tool_allowlist)
    ? settings.agent_tool_allowlist.map((tool: unknown) => String(tool || '').trim()).filter(Boolean)
    : []
  const allowlist = [...configured]
  for (const tool of workspaceNativeTools) {
    if (!allowlist.includes(tool)) allowlist.push(tool)
  }
  if (allowlist.length === configured.length) return settings

  return { ...settings, agent_tool_allowlist: allowlist }
}
