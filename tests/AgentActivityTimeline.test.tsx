import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import AgentActivityTimeline from '../src/components/AgentActivityTimeline'
import type { AgentActivityItem } from '../src/types/editor'

function open_activity(activity: AgentActivityItem[]) {
  render(<AgentActivityTimeline activity={activity} />)
  const summary = screen.getByText(/Agent activity/)
  const details = summary.closest('details') as HTMLDetailsElement
  details.open = true
  fireEvent(details, new Event('toggle'))
}

function open_reasoning(activity: AgentActivityItem[]) {
  render(<AgentActivityTimeline activity={activity} />)
  const summary = screen.getByText(/Reasoning/)
  const details = summary.closest('details') as HTMLDetailsElement
  details.open = true
  fireEvent(details, new Event('toggle'))
}

describe('AgentActivityTimeline', () => {
  it('shows a readable file edit instead of raw JSON', () => {
    open_activity([
      {
        id: 'edit-call',
        type: 'tool_call',
        label: 'Edited',
        detail: JSON.stringify({ path: 'index.html', oldText: '<h1>Old</h1>', newText: '<h1>Cats</h1>' }),
        status: '',
        tool: 'files.edit',
        at: Date.now(),
      },
      {
        id: 'edit-result',
        type: 'tool_result',
        label: 'Edited complete',
        detail: JSON.stringify({ path: 'index.html', diff: '@@ -1,1 +1,1 @@\n-<h1>Old</h1>\n+<h1>Cats</h1>' }),
        status: 'ok',
        tool: 'files.edit',
        at: Date.now(),
      },
    ])

    expect(screen.getByText('Edited index.html')).toBeInTheDocument()
    expect(screen.getByText('-<h1>Old</h1>')).toBeInTheDocument()
    expect(screen.queryByText(/"oldText"/)).not.toBeInTheDocument()
  })

  it('names image generation while it is running', () => {
    open_activity([
      {
        id: 'image-call',
        type: 'tool_call',
        label: 'tool',
        detail: JSON.stringify({ path: 'public/images/cat.webp', prompt: 'A fluffy orange cat', format: 'landscape' }),
        status: '',
        tool: 'image.generate',
        at: Date.now(),
      },
    ])

    expect(screen.getByText('Generating image')).toBeInTheDocument()
    expect(screen.queryByText(/^tool$/i)).not.toBeInTheDocument()
  })

  it('upgrades old generic tool events to a specific action', () => {
    open_activity([
      {
        id: 'legacy-image',
        type: 'tool',
        label: 'tool',
        detail: JSON.stringify(JSON.stringify({ path: 'public/images/cat.webp' })),
        status: 'succeeded',
        tool: 'image.generate',
        at: Date.now(),
      },
    ])

    expect(screen.getByText('Generated cat.webp')).toBeInTheDocument()
    expect(screen.queryByText(/^tool$/i)).not.toBeInTheDocument()
  })

  it('shows forced planning output under reasoning instead of agent activity', () => {
    open_reasoning([
      {
        id: 'planning-ideas',
        type: 'planning',
        label: 'Exploring ideas',
        detail: 'Several possible approaches were explored.',
        status: '',
        tool: '',
        at: Date.now(),
      },
    ])

    expect(screen.getByText('Exploring ideas')).toBeInTheDocument()
    expect(screen.getByText('Several possible approaches were explored.')).toBeInTheDocument()
    expect(screen.queryByText(/Agent activity/)).not.toBeInTheDocument()
  })
})
