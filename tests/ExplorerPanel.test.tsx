import { fireEvent, render, screen } from '@testing-library/react'
import type { ComponentProps } from 'react'
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
        children: [
          '/project/src',
          '/project/index.html',
          '/project/package-lock.json',
          '/project/package.json',
          '/project/README.md',
        ],
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
      '/project/index.html',
      {
        path: '/project/index.html',
        parent_path: '/project',
        name: 'index.html',
        kind: 'file',
        is_symlink: false,
        children: null,
        loading: false,
        error: null,
      },
    ],
    [
      '/project/package-lock.json',
      {
        path: '/project/package-lock.json',
        parent_path: '/project',
        name: 'package-lock.json',
        kind: 'file',
        is_symlink: false,
        children: null,
        loading: false,
        error: null,
      },
    ],
    [
      '/project/package.json',
      {
        path: '/project/package.json',
        parent_path: '/project',
        name: 'package.json',
        kind: 'file',
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

function render_open_explorer(overrides: Partial<ComponentProps<typeof ExplorerPanel>> = {}) {
  const props: ComponentProps<typeof ExplorerPanel> = {
    activeFilePath: null,
    activeSection: 'explorer',
    clipboard: null,
    expandedPaths: new Set(['/project']),
    nodes: create_nodes(),
    onCollapseAll: vi.fn(),
    onCopyPath: vi.fn(),
    onCreateEntry: vi.fn(),
    onDeleteEntries: vi.fn(),
    onDropEntry: vi.fn(),
    onOpenFile: vi.fn(),
    onOpenFolder: vi.fn(),
    onPaste: vi.fn(),
    onRefresh: vi.fn(),
    onRenameEntry: vi.fn(),
    onResize: vi.fn(),
    onRevealEntry: vi.fn(),
    onSelectPath: vi.fn(),
    onSelectPaths: vi.fn(),
    onSelectSubtree: vi.fn(),
    onSetClipboard: vi.fn(),
    onTogglePathSelection: vi.fn(),
    onToggleFolder: vi.fn(),
    rootName: 'project',
    rootPath: '/project',
    selectedPath: null,
    selectedPaths: new Set(),
    ...overrides,
  }

  return render(<ExplorerPanel {...props} />)
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
        onCollapseAll={vi.fn()}
        onCopyPath={vi.fn()}
        onCreateEntry={vi.fn()}
        onDeleteEntries={vi.fn()}
        onDropEntry={vi.fn()}
        onOpenFile={vi.fn()}
        onOpenFolder={on_open_folder}
        onPaste={vi.fn()}
        onRefresh={vi.fn()}
        onRenameEntry={vi.fn()}
        onResize={vi.fn()}
        onRevealEntry={vi.fn()}
        onSelectPath={vi.fn()}
        onSelectPaths={vi.fn()}
        onSelectSubtree={vi.fn()}
        onSetClipboard={vi.fn()}
        onTogglePathSelection={vi.fn()}
        onToggleFolder={vi.fn()}
        rootName={null}
        rootPath={null}
        selectedPath={null}
        selectedPaths={new Set()}
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
        onCollapseAll={vi.fn()}
        onCopyPath={vi.fn()}
        onCreateEntry={vi.fn()}
        onDeleteEntries={vi.fn()}
        onDropEntry={vi.fn()}
        onOpenFile={on_open_file}
        onOpenFolder={vi.fn()}
        onPaste={vi.fn()}
        onRefresh={vi.fn()}
        onRenameEntry={vi.fn()}
        onResize={vi.fn()}
        onRevealEntry={vi.fn()}
        onSelectPath={on_select_path}
        onSelectPaths={vi.fn()}
        onSelectSubtree={vi.fn()}
        onSetClipboard={vi.fn()}
        onTogglePathSelection={vi.fn()}
        onToggleFolder={vi.fn()}
        rootName="project"
        rootPath="/project"
        selectedPath={null}
        selectedPaths={new Set()}
      />,
    )

    fireEvent.click(screen.getByText('README.md'))
    expect(on_select_path).toHaveBeenCalledWith('/project/README.md')
    expect(on_open_file).toHaveBeenCalledWith('/project/README.md')
  })

  it('keeps modifier-assisted file selection from opening a file', () => {
    const on_open_file = vi.fn()

    render_open_explorer({ onOpenFile: on_open_file })
    fireEvent.click(screen.getByText('index.html'), { ctrlKey: true })
    fireEvent.click(screen.getByText('package.json'), { metaKey: true })
    fireEvent.click(screen.getByText('README.md'), { shiftKey: true })

    expect(on_open_file).not.toHaveBeenCalled()
  })

  it('selects a visible range with Shift', () => {
    const on_select_paths = vi.fn()

    render_open_explorer({ onSelectPaths: on_select_paths })
    fireEvent.click(screen.getByText('index.html'))
    fireEvent.click(screen.getByText('package.json'), { shiftKey: true })

    expect(on_select_paths).toHaveBeenCalledWith(
      ['/project/index.html', '/project/package-lock.json', '/project/package.json'],
      '/project/package.json',
    )
  })

  it('toggles individual selections with Ctrl', () => {
    const on_toggle_path_selection = vi.fn()

    render_open_explorer({ onTogglePathSelection: on_toggle_path_selection })
    fireEvent.click(screen.getByText('index.html'), { ctrlKey: true })
    fireEvent.click(screen.getByText('package.json'), { ctrlKey: true })

    expect(on_toggle_path_selection).toHaveBeenNthCalledWith(1, '/project/index.html')
    expect(on_toggle_path_selection).toHaveBeenNthCalledWith(2, '/project/package.json')
  })

  it('selects a folder subtree when its row is double-clicked', () => {
    const on_select_subtree = vi.fn()

    render_open_explorer({ onSelectSubtree: on_select_subtree })
    const row = screen.getByText('src').closest('[role="treeitem"]')

    expect(row).not.toBeNull()
    fireEvent.doubleClick(row!)
    expect(on_select_subtree).toHaveBeenCalledWith('/project/src')
  })

  it('starts inline folder rename without also selecting the subtree when the folder name is double-clicked', () => {
    const on_select_subtree = vi.fn()

    render_open_explorer({ onSelectSubtree: on_select_subtree })
    fireEvent.doubleClick(screen.getByText('src'))
    expect(screen.getByDisplayValue('src')).toBeInTheDocument()
    expect(on_select_subtree).not.toHaveBeenCalled()
  })

  it('confirms and deletes the full current selection', () => {
    const on_delete_entries = vi.fn().mockResolvedValue(true)
    const selected_paths = new Set(['/project/index.html', '/project/package.json'])

    render_open_explorer({
      onDeleteEntries: on_delete_entries,
      selectedPath: '/project/index.html',
      selectedPaths: selected_paths,
    })

    fireEvent.contextMenu(screen.getByText('index.html'))
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    expect(screen.getByText('2 selected items will be moved to Trash.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Move to Trash' }))
    expect(on_delete_entries).toHaveBeenCalledWith(['/project/index.html', '/project/package.json'])
  })

  it('does not render a Close Folder explorer action', () => {
    render_open_explorer()
    expect(screen.queryByTitle('Close Folder')).not.toBeInTheDocument()
  })
})
