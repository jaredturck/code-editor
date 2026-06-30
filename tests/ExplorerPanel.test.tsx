import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import ExplorerPanel from '../src/components/ExplorerPanel'
import type { WorkspaceNode } from '../src/types/workspace'

function create_nodes() {
  return new Map<string, WorkspaceNode>([
    [
      '/project',
      {
        path: '/project',
        parent_path: null,
        name: 'project',
        kind: 'directory',
        is_symlink: false,
        children: ['/project/src', '/project/README.md'],
        loading: false,
        error: null,
      },
    ],
    [
      '/project/src',
      {
        path: '/project/src',
        parent_path: '/project',
        name: 'src',
        kind: 'directory',
        is_symlink: false,
        children: null,
        loading: false,
        error: null,
      },
    ],
    [
      '/project/README.md',
      {
        path: '/project/README.md',
        parent_path: '/project',
        name: 'README.md',
        kind: 'file',
        is_symlink: false,
        children: null,
        loading: false,
        error: null,
      },
    ],
  ])
}

describe('ExplorerPanel', () => {
  it('shows an open-folder action when no workspace is open', () => {
    const on_open_folder = vi.fn()

    render(
      <ExplorerPanel
        activeFilePath={null}
        activeSection="explorer"
        clipboard={null}
        expandedPaths={new Set()}
        nodes={new Map()}
        onCloseWorkspace={vi.fn()}
        onCollapseAll={vi.fn()}
        onCopyPath={vi.fn()}
        onCreateEntry={vi.fn()}
        onDeleteEntry={vi.fn()}
        onDropEntry={vi.fn()}
        onOpenFile={vi.fn()}
        onOpenFolder={on_open_folder}
        onPaste={vi.fn()}
        onRefresh={vi.fn()}
        onRenameEntry={vi.fn()}
        onResize={vi.fn()}
        onRevealEntry={vi.fn()}
        onSelectPath={vi.fn()}
        onSetClipboard={vi.fn()}
        onToggleFolder={vi.fn()}
        rootName={null}
        rootPath={null}
        selectedPath={null}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Open Folder' }))
    expect(on_open_folder).toHaveBeenCalledOnce()
  })

  it('opens a file when its tree row is selected', () => {
    const on_open_file = vi.fn()
    const on_select_path = vi.fn()

    render(
      <ExplorerPanel
        activeFilePath={null}
        activeSection="explorer"
        clipboard={null}
        expandedPaths={new Set(['/project'])}
        nodes={create_nodes()}
        onCloseWorkspace={vi.fn()}
        onCollapseAll={vi.fn()}
        onCopyPath={vi.fn()}
        onCreateEntry={vi.fn()}
        onDeleteEntry={vi.fn()}
        onDropEntry={vi.fn()}
        onOpenFile={on_open_file}
        onOpenFolder={vi.fn()}
        onPaste={vi.fn()}
        onRefresh={vi.fn()}
        onRenameEntry={vi.fn()}
        onResize={vi.fn()}
        onRevealEntry={vi.fn()}
        onSelectPath={on_select_path}
        onSetClipboard={vi.fn()}
        onToggleFolder={vi.fn()}
        rootName="project"
        rootPath="/project"
        selectedPath={null}
      />,
    )

    fireEvent.click(screen.getByText('README.md'))
    expect(on_select_path).toHaveBeenCalledWith('/project/README.md')
    expect(on_open_file).toHaveBeenCalledWith('/project/README.md')
  })
})
