export interface GitChange {
  path: string
  old_path: string | null
  status: string
  staged: boolean
  unstaged: boolean
  untracked: boolean
}

export interface GitCommitSummary {
  hash: string
  short_hash: string
  subject: string
  author_name: string
  author_email: string
  date: string
}

export interface GitRepositoryStatus {
  root_path: string
  branch: string
  head: string | null
  clean: boolean
  changes: GitChange[]
  nested_repositories: string[]
}

export interface GitDiffResult {
  path: string
  staged: string
  working: string
}

export interface GitAgentCommitResult {
  root_path: string
  commit: string | null
  removed_nested_repositories: string[]
  status: GitRepositoryStatus
}
