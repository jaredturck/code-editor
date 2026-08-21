# Terminal, Build, Test and Diagnostics Integration

The Code Editor Agent Chat now exposes the migrated brokered `terminal.exec` capability when an open workspace exists and the user has explicitly enabled **Run terminal commands** in AI Settings.

## Runtime behavior

- commands execute through the IRIS authenticated local bridge, not through the human xterm/node-pty terminal sessions;
- the default command working directory is the current agent workspace;
- IRIS command safety, approval, web-access and package-install guards remain in force;
- command output and exit codes return to the agent, allowing edit → build/test/lint → inspect failure → fix → rerun loops;
- normal Stop aborts the active agent session and global emergency stop revokes terminal authority for subsequent calls;
- bridge command execution remains bounded by the existing 30-second command timeout and output limits.

## Diagnostics

The current Code Editor diagnostics for files inside the open workspace are injected as bounded live evidence at the start of each execution segment. This gives the agent parser/linter/compiler findings alongside terminal results without exposing diagnostics from unrelated workspaces.

## Safety boundary

Terminal authority is opt-in and remains distinct from human terminal sessions. File mutations continue through the editor-aware authority layer so dirty CodeMirror buffers and revision conflicts are respected. Exact-code-search UI integration remains a later milestone even though an authorized terminal command may itself invoke tools such as `rg`.
