import { fireEvent, render, screen } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { describe, expect, it, vi } from 'vitest'
import EditorPanel from '../src/components/EditorPanel'
import { default_editor_settings } from '../src/editor/editorSettings'
import type { TextEditorDocument } from '../src/types/editor'

vi.mock('../src/components/CodeEditor', () => ({
  default: () => <div data-testid="code-editor" />,
}))

vi.mock('../src/components/viewers/MediaViewer', () => ({
  default: () => <div data-testid="media-viewer" />,
}))

function text_document(id: number, name: string, file_path: string, dirty = false): TextEditorDocument {
  return {
    kind: 'text',
    id,
    name,
    content: dirty ? 'changed' : '',
    saved_content: '',
    file_path,
    language: 'TypeScript',
    indent_style: 'spaces',
    indent_size: 2,
    dirty,
    deleted: false,
    markdown_view: 'source',
  }
}

function render_editor(overrides: Partial<ComponentProps<typeof EditorPanel>> = {}) {
  const documents = [
    text_document(1, 'one.ts', '/project/src/one.ts'),
    text_document(2, 'utils.ts', '/project/src/utils.ts'),
    text_document(3, 'three.ts', '/project/src/three.ts', true),
  ]
  const props: ComponentProps<typeof EditorPanel> = {
    activeDocumentId: 1,
    browserVisible: true,
    diagnostics: [],
    documents,
    editorRef: { current: null },
    settings: default_editor_settings,
    theme: 'dark' as const,
    onCloseDocument: vi.fn(),
    onCloseDocuments: vi.fn(),
    onEditorCommandStateChange: vi.fn(),
    onFocusDocument: vi.fn(),
    onOpenFilePath: vi.fn(),
    onOpenContainingFolder: vi.fn(),
    onParserDiagnostics: vi.fn(),
    onSelectDocument: vi.fn(),
    onRevealInExplorer: vi.fn(),
    onToggleMarkdownView: vi.fn(),
    onUpdateDocument: vi.fn(),
    workspaceRoot: '/project',
    ...overrides,
  }

  return { ...render(<EditorPanel {...props} />), props }
}

describe('EditorPanel tabs', () => {
  it('uses left and right arrows only from a focused tab', () => {
    const on_select_document = vi.fn()
    render_editor({ onSelectDocument: on_select_document })

    const first_tab = screen.getByRole('tab', { name: 'one.ts' })
    first_tab.focus()
    fireEvent.keyDown(first_tab, { key: 'ArrowRight' })

    expect(on_select_document).toHaveBeenCalledWith(2)
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'utils.ts' }))
  })

  it('scrolls overflowing tabs horizontally with the mouse wheel without a visible scrollbar class', () => {
    render_editor()
    const tab_list = screen.getByRole('tablist')
    Object.defineProperty(tab_list, 'scrollLeft', { configurable: true, writable: true, value: 0 })

    fireEvent.wheel(tab_list, { deltaY: 48 })

    expect(tab_list.scrollLeft).toBe(48)
    expect(tab_list).toHaveClass('editor-tabs-scroll')
    expect(tab_list).toHaveClass('overflow-y-hidden')
  })

  it('closes every other tab from the tab context menu', () => {
    const on_close_documents = vi.fn()
    render_editor({ onCloseDocuments: on_close_documents })

    fireEvent.contextMenu(screen.getByRole('tab', { name: 'utils.ts' }))
    fireEvent.click(screen.getByRole('button', { name: 'Close Others' }))

    expect(on_close_documents).toHaveBeenCalledWith([1, 3])
  })

  it('closes tabs to the right of the context tab', () => {
    const on_close_documents = vi.fn()
    render_editor({ onCloseDocuments: on_close_documents })

    fireEvent.contextMenu(screen.getByRole('tab', { name: 'utils.ts' }))
    fireEvent.click(screen.getByRole('button', { name: 'Close to the Right' }))

    expect(on_close_documents).toHaveBeenCalledWith([3])
  })

  it('closes only saved tabs from the tab context menu', () => {
    const on_close_documents = vi.fn()
    render_editor({ onCloseDocuments: on_close_documents })

    fireEvent.contextMenu(screen.getByRole('tab', { name: 'utils.ts' }))
    fireEvent.click(screen.getByRole('button', { name: 'Close Saved' }))

    expect(on_close_documents).toHaveBeenCalledWith([1, 2])
  })

  it('copies absolute and workspace-relative paths', () => {
    const copy_text = vi.fn()
    window.editor_api.workspace = { copy_text } as typeof window.editor_api.workspace
    render_editor()

    fireEvent.contextMenu(screen.getByRole('tab', { name: 'utils.ts' }))
    fireEvent.click(screen.getByRole('button', { name: 'Copy Path' }))
    expect(copy_text).toHaveBeenCalledWith('/project/src/utils.ts')

    fireEvent.contextMenu(screen.getByRole('tab', { name: 'utils.ts' }))
    fireEvent.click(screen.getByRole('button', { name: 'Copy Relative Path' }))
    expect(copy_text).toHaveBeenCalledWith('src/utils.ts')
  })

  it('opens the containing folder for workspace files', () => {
    const on_open_containing_folder = vi.fn()
    render_editor({ onOpenContainingFolder: on_open_containing_folder })

    fireEvent.contextMenu(screen.getByRole('tab', { name: 'utils.ts' }))
    fireEvent.click(screen.getByRole('button', { name: 'Open Containing Folder' }))

    expect(on_open_containing_folder).toHaveBeenCalledWith('/project/src/utils.ts')
  })

  it('copies the readable breadcrumbs path for workspace files', () => {
    const copy_text = vi.fn()
    window.editor_api.workspace = { copy_text } as typeof window.editor_api.workspace
    render_editor()

    fireEvent.contextMenu(screen.getByRole('tab', { name: 'utils.ts' }))
    fireEvent.click(screen.getByRole('button', { name: 'Copy Breadcrumbs Path' }))

    expect(copy_text).toHaveBeenCalledWith('src > utils.ts')
  })

  it('reveals a tab file in the workspace explorer', () => {
    const on_reveal_in_explorer = vi.fn()
    render_editor({ onRevealInExplorer: on_reveal_in_explorer })

    fireEvent.contextMenu(screen.getByRole('tab', { name: 'utils.ts' }))
    fireEvent.click(screen.getByRole('button', { name: 'Reveal in Explorer View' }))

    expect(on_reveal_in_explorer).toHaveBeenCalledWith('/project/src/utils.ts')
  })
})
