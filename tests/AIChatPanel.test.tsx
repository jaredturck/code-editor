import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import AIChatPanel from '../src/components/AIChatPanel'
import type useAIChat from '../src/hooks/useAIChat'

function chat_state(overrides: Partial<ReturnType<typeof useAIChat>> = {}) {
  return {
    agent_descriptor: {
      provider: 'openai',
      provider_label: 'OpenAI',
      model: 'gpt-test',
      key_id: '1',
      ready: true,
      status: 'ready',
      message: 'OpenAI · gpt-test',
    },
    answer_question: vi.fn(),
    approval_requests: [],
    attachments: [],
    begin_recording: vi.fn(),
    choose_attachment: vi.fn(),
    clear_chat: vi.fn(),
    connection_status: 'connected' as const,
    error: '',
    generating: false,
    install_speech_model: vi.fn(),
    messages: [],
    prompt: '',
    recording: false,
    recording_seconds: 0,
    resolve_approval: vi.fn(),
    restoring_chat: false,
    run_status: '',
    remove_attachment: vi.fn(),
    set_error: vi.fn(),
    set_prompt: vi.fn(),
    set_speech_model_prompt: vi.fn(),
    speech_model_prompt: false,
    stop_generation: vi.fn(),
    stop_recording: vi.fn(),
    submit_prompt: vi.fn(),
    transcribing: false,
    attach_active_file: vi.fn(),
    ...overrides,
  } as unknown as ReturnType<typeof useAIChat>
}

function render_panel(chat: ReturnType<typeof useAIChat>) {
  return render(<AIChatPanel chat={chat} onClose={vi.fn()} onResize={vi.fn()} width={360} />)
}

describe('AIChatPanel agent integration', () => {
  it('shows the configured Orchestrator instead of the legacy Ollama model picker', () => {
    render_panel(chat_state())

    expect(screen.getByText('OpenAI · gpt-test')).toBeInTheDocument()
    expect(screen.getByText('Agent ready')).toBeInTheDocument()
    expect(screen.queryByLabelText('Ollama model')).not.toBeInTheDocument()
  })

  it('shows observable agent activity without a raw reasoning surface', () => {
    render_panel(
      chat_state({
        messages: [
          {
            id: 'assistant-1',
            role: 'assistant',
            content: 'I found the relevant file.',
            attachments: [],
            activity: [
              {
                id: 'activity-1',
                type: 'tool_call',
                label: 'Read file',
                detail: 'src/app.ts',
                status: '',
                tool: 'files.read',
                at: Date.now(),
              },
            ],
            provider: 'openai',
            model: 'gpt-test',
          },
        ],
      }),
    )

    expect(screen.getByText('Agent activity · 1 action')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Agent activity · 1 action'))
    expect(screen.getByText('Read file')).toBeInTheDocument()
    expect(screen.getByText('src/app.ts')).toBeInTheDocument()
  })

  it('renders approval choices and forwards the selected decision', () => {
    const resolve_approval = vi.fn()
    render_panel(
      chat_state({
        resolve_approval,
        approval_requests: [
          {
            id: 'approval-1',
            requestType: 'permission',
            reason: 'Read project files',
            options: [
              {
                id: 'approve',
                label: 'Approve',
                description: 'Allow this request.',
                recommended: true,
              },
              {
                id: 'deny',
                label: 'Deny',
                description: 'Reject this request.',
                recommended: false,
              },
            ],
          },
        ],
      }),
    )

    fireEvent.click(screen.getByRole('button', { name: 'Approve' }))
    expect(resolve_approval).toHaveBeenCalledWith('approval-1', 'approve')
  })

  it('keeps active-file attachment and voice controls in the existing composer', () => {
    render_panel(chat_state())

    expect(screen.getByRole('button', { name: 'Active file' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Attach…' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Record voice prompt' })).toBeInTheDocument()
  })
})
