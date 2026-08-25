# Editor-Aware Filesystem Integration (P008)

> **Completed milestone.** This document records the P008 filesystem authority boundary. Later milestones subsequently connected terminal, exact search, semantic RAG, vision/automation and multi-agent execution.

P008 connects the IRIS file tools to the Code Editor workspace without exposing the migrated bridge's broader home-directory filesystem root.

The agent can now use `files.list`, `files.read`, `files.stat`, `files.diff`, `files.write`, `files.edit`, and `files.patch` when a workspace is open. Every operation is routed through a Code Editor file-authority adapter and narrow Electron workspace IPC. Electron resolves real paths and rejects traversal or symlinks that escape the open workspace.

Open text documents are authoritative. Reads use the live CodeMirror buffer, including unsaved content. Agent edits to a dirty document update that live buffer and intentionally leave disk unchanged. Clean documents and closed files are written to disk and synchronized back into editor state. The authority records the revision seen by the agent and rejects a later write when either the human buffer or disk file changed after that read.

Persistent filesystem permissions remain user-controlled in Settings. Later completed milestones connect terminal execution, exact search, semantic RAG, screen control and multi-agent execution through their own permission and policy boundaries; none bypasses this editor-aware file authority.
