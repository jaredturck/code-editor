import { describe, expect, it } from 'vitest'
import type { WorkspaceNode } from '../src/types/workspace'
import {
  get_workspace_relative_path,
  remap_workspace_path,
  remove_workspace_node,
  replace_workspace_children,
  workspace_path_is_same_or_child,
} from '../src/workspace/workspaceTree'

function directory(path: string, parent_path: string | null, children: string[] | null = null): WorkspaceNode {
  return {
    path,
    parent_path,
    name: path.split('/').pop() ?? path,
    kind: 'directory',
    is_symlink: false,
    children,
    loading: false,
    error: null,
  }
}

function file(path: string, parent_path: string): WorkspaceNode {
  return {
    path,
    parent_path,
    name: path.split('/').pop() ?? path,
    kind: 'file',
    is_symlink: false,
    children: null,
    loading: false,
    error: null,
  }
}

describe('workspace tree utilities', () => {
  it('replaces directory children while preserving loaded folder state', () => {
    const nodes = new Map<string, WorkspaceNode>([
      ['/project', directory('/project', null, ['/project/src'])],
      ['/project/src', directory('/project/src', '/project', ['/project/src/App.tsx'])],
      ['/project/src/App.tsx', file('/project/src/App.tsx', '/project/src')],
    ])

    const next = replace_workspace_children(nodes, '/project', [
      {
        path: '/project/src',
        parent_path: '/project',
        name: 'src',
        kind: 'directory',
        is_symlink: false,
      },
      {
        path: '/project/README.md',
        parent_path: '/project',
        name: 'README.md',
        kind: 'file',
        is_symlink: false,
      },
    ])

    expect(next.get('/project')?.children).toEqual(['/project/src', '/project/README.md'])
    expect(next.get('/project/src')?.children).toEqual(['/project/src/App.tsx'])
  })

  it('remaps a renamed folder and all loaded descendants', () => {
    const nodes = new Map<string, WorkspaceNode>([
      ['/project', directory('/project', null, ['/project/src'])],
      ['/project/src', directory('/project/src', '/project', ['/project/src/App.tsx'])],
      ['/project/src/App.tsx', file('/project/src/App.tsx', '/project/src')],
    ])

    const next = remap_workspace_path(nodes, '/project/src', '/project/source')

    expect(next.has('/project/src')).toBe(false)
    expect(next.get('/project')?.children).toEqual(['/project/source'])
    expect(next.get('/project/source')?.children).toEqual(['/project/source/App.tsx'])
    expect(next.get('/project/source/App.tsx')?.parent_path).toBe('/project/source')
  })

  it('removes a folder subtree and its parent reference', () => {
    const nodes = new Map<string, WorkspaceNode>([
      ['/project', directory('/project', null, ['/project/src', '/project/package.json'])],
      ['/project/src', directory('/project/src', '/project', ['/project/src/App.tsx'])],
      ['/project/src/App.tsx', file('/project/src/App.tsx', '/project/src')],
      ['/project/package.json', file('/project/package.json', '/project')],
    ])

    const next = remove_workspace_node(nodes, '/project/src')

    expect(next.has('/project/src')).toBe(false)
    expect(next.has('/project/src/App.tsx')).toBe(false)
    expect(next.get('/project')?.children).toEqual(['/project/package.json'])
  })

  it('computes safe workspace-relative paths', () => {
    expect(workspace_path_is_same_or_child('/project', '/project/src/App.tsx')).toBe(true)
    expect(workspace_path_is_same_or_child('/project', '/project-two/App.tsx')).toBe(false)
    expect(get_workspace_relative_path('/project', '/project/src/App.tsx')).toBe('src/App.tsx')
  })
})
