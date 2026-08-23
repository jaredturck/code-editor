// @ts-nocheck
/**
 * Maintains the runtime todo list and trace events that make an agent run visible in the
 * chat timeline. The model can update task status and record concise progress without
 * replacing the conversation itself.
 */

// Behavior-preserving extraction from the legacy runtime; contracts will be tightened incrementally.

import { toPreview } from '@/platform/agent/agentJsonUtils'

// Converts todo status into the canonical representation expected by later code.
export function normalizeTodoStatus(value) {
  const status = String(value || '').toLowerCase()
  if (status === 'pending' || status === 'in_progress' || status === 'done' || status === 'blocked') {
    return status
  }

  return 'pending'
}

// Converts todo into the canonical representation expected by later code. Preserves BOTH the
// owner role (agentRole — for color) and, in teamwork mode, the specific member id (owner — e.g.
// "executor#2") + its dependencies, so the todo list can split into per-MEMBER lanes (not just
// per-role) and the lead can sequence parts by dependency.
export function normalizeTodo(todo, fallbackId) {
  const agentRole = String(todo?.agentRole || '').trim()
  const owner = String(todo?.owner || '').trim()
  const dependsOn = Array.isArray(todo?.dependsOn)
    ? todo.dependsOn.map((d) => String(d || '').trim()).filter(Boolean)
    : []
  return {
    id: Number.isFinite(Number(todo?.id)) ? Number(todo.id) : fallbackId,
    text: String(todo?.text || 'Untitled task').trim() || 'Untitled task',
    status: normalizeTodoStatus(todo?.status),
    // Fall back to the member id for color when no explicit role was given.
    ...(agentRole || owner ? { agentRole: agentRole || owner } : {}),
    ...(owner ? { owner } : {}),
    ...(dependsOn.length ? { dependsOn } : {}),
  }
}

// Condenses request for todo while retaining the information needed by the next stage.
export function summarizeRequestForTodo(userInput) {
  const text = String(userInput || '')
    .replace(/\s+/g, ' ')
    .trim()
  if (!text) return 'Understand request'
  return `Understand: ${text.slice(0, 80)}${text.length > 80 ? '...' : ''}`
}

// One honest planning seed — NOT a generic skeleton. The model expands this into the REAL,
// task-specific steps (see controllerPrompt '# Planning' + the orbit-problem-solving skill).
// The old fixed "understand / run tools / deliver answer" list tracked nothing and made every
// run's todos look identical and inaccurate.
export function buildSeedTodos(userInput) {
  const text = String(userInput || '')
    .replace(/\s+/g, ' ')
    .trim()
  const label = text
    ? `Plan the steps for: ${text.slice(0, 70)}${text.length > 70 ? '…' : ''}`
    : 'Plan the task and outline the concrete steps'
  return [{ op: 'add', text: label, status: 'in_progress' }]
}

// estimateTokens — moved to @/platform/agent/usageMetrics (imported above)

export function createTodoTool(initialTodos = [], traceTool, onTodosChanged) {
  let todos = Array.isArray(initialTodos)
    ? initialTodos.map((todo, index) => normalizeTodo(todo, Date.now() + index))
    : []

  // Returns the next stable ID for todo tool.
  const nextId = () => {
    const max = todos.reduce((current, todo) => Math.max(current, Number(todo.id) || 0), 0)
    return max + 1
  }

  // Commits the current todo tool state and publishes the updated snapshot.
  const commit = (nextTodos, eventOp, eventText) => {
    todos = nextTodos
    onTodosChanged?.(todos)
    traceTool.todo(eventOp, eventText)
    return todos
  }

  // Updates todo tool with the supplied status value.
  const setStatus = (id, status, fallbackText = 'Task') => {
    const normalizedStatus = normalizeTodoStatus(status)
    let targetText = fallbackText
    let changed = false

    const next = todos.map((todo) => {
      if (todo.id !== id) return todo
      targetText = todo.text || fallbackText
      if (todo.status === normalizedStatus) return todo
      changed = true
      return { ...todo, status: normalizedStatus }
    })

    if (changed) {
      commit(next, 'set_status', targetText)
    }

    return todos.find((todo) => todo.id === id) || null
  }

  // Ensures in progress exists in the valid state required by the agent session runtime.
  // The lifecycle helpers below advance the MODEL's own todos but NEVER fabricate one. Earlier
  // they created a synthetic "Run <tool>"/"Completed <tool>" entry on every tool call when the
  // model had no todo in flight, which flooded the list with tool-usage noise — misguiding the
  // agent and burying the real, model-authored todos. `fallbackText` is kept in the signature
  // for call-site compatibility but is no longer used to mint a todo. The todo list now reflects
  // only what the model created via todo.update.
  const ensureInProgress = (_fallbackText = '') => {
    const current = todos.find((todo) => todo.status === 'in_progress')
    if (current) return current

    const firstPending = todos.find((todo) => todo.status === 'pending')
    if (firstPending) {
      return setStatus(firstPending.id, 'in_progress', firstPending.text)
    }
    return null // no real todo to advance — do not invent one
  }

  // Marks the model's in-progress (or next pending) todo complete; no-op if there is none.
  const completeInProgress = (_fallbackText = '') => {
    const current = todos.find((todo) => todo.status === 'in_progress')
    if (current) {
      return setStatus(current.id, 'done', current.text)
    }

    const pending = todos.find((todo) => todo.status === 'pending')
    if (pending) {
      const inProgress = setStatus(pending.id, 'in_progress', pending.text)
      if (inProgress) {
        return setStatus(inProgress.id, 'done', inProgress.text)
      }
    }
    return null
  }

  // Marks the model's in-progress (or next pending) todo blocked; no-op if there is none.
  const blockInProgress = (_fallbackText = '') => {
    const current = todos.find((todo) => todo.status === 'in_progress')
    if (current) {
      return setStatus(current.id, 'blocked', current.text)
    }

    const pending = todos.find((todo) => todo.status === 'pending')
    if (pending) {
      return setStatus(pending.id, 'blocked', pending.text)
    }
    return null
  }

  // Applies one to the current state using the rules owned by the agent session runtime.
  const applyOne = (update) => {
    if (!update || typeof update !== 'object') return

    const op = String(update.op || '').toLowerCase()

    if (op === 'add') {
      const text = String(update.text || '').trim()
      if (!text) return
      const member = String(update.owner || '').trim()
      const role = String(update.agentRole || member || '').trim()
      commit(
        [
          ...todos,
          {
            id: nextId(),
            text,
            status: normalizeTodoStatus(update.status),
            ...(role ? { agentRole: role } : {}),
            ...(member ? { owner: member } : {}),
          },
        ],
        'add',
        text,
      )
      return
    }

    if (op === 'set') {
      const next = Array.isArray(update.items)
        ? update.items.map((item, index) => normalizeTodo(item, Date.now() + index))
        : []
      commit(next, 'set', `${next.length} tasks`)
      return
    }

    const id = Number(update.id)
    if (!Number.isFinite(id)) return

    if (op === 'set_status') {
      const next = todos.map((todo) =>
        todo.id === id ? { ...todo, status: normalizeTodoStatus(update.status) } : todo,
      )
      const target = next.find((todo) => todo.id === id)
      if (target) commit(next, 'set_status', target.text)
      return
    }

    if (op === 'rename') {
      const nextText = String(update.text || '').trim()
      if (!nextText) return
      const next = todos.map((todo) => (todo.id === id ? { ...todo, text: nextText } : todo))
      if (next.some((todo) => todo.id === id)) commit(next, 'rename', nextText)
      return
    }

    if (op === 'remove') {
      const target = todos.find((todo) => todo.id === id)
      const next = todos.filter((todo) => todo.id !== id)
      if (target) commit(next, 'remove', target.text)
    }
  }

  return {
    list() {
      return todos.slice()
    },
    isEmpty() {
      return todos.length === 0
    },
    // Applies updates to the current state using the rules owned by the agent session runtime.
    applyUpdates(updates = []) {
      if (!Array.isArray(updates)) return todos.slice()
      updates.slice(0, 25).forEach(applyOne)
      return todos.slice()
    },
    ensureInProgress,
    completeInProgress,
    blockInProgress,
  }
}

/**
 * Creates the trace.log tool used by an agent to add an explicit reasoning or progress note
 * to the visible run timeline. The tool bounds message content and records it through the
 * same callback path as other session events.
 */

export function createTraceTool(timeline, onEvent, getTodosSnapshot) {
  let eventId = 1

  // Publishes emit to the active subscribers.
  const emit = (event) => {
    const fullEvent = {
      id: eventId,
      at: Date.now(),
      ...event,
    }

    eventId += 1
    timeline.push(fullEvent)
    onEvent?.(fullEvent, { todos: getTodosSnapshot?.() || [] })
  }

  return {
    // Records a phase transition in the active agent timeline.
    phase(name, summary, meta = {}) {
      emit({
        type: 'phase',
        name: String(name || 'phase'),
        summary: String(summary || '').slice(0, 500),
        step: Number.isFinite(Number(meta.step)) ? Number(meta.step) : undefined,
        channel: meta.channel ? String(meta.channel) : undefined,
      })
    },
    // Records bounded model-thinking output in the active agent timeline.
    thinking(summary, meta = {}) {
      const text = String(summary || '').trim()
      if (!text) return

      const chart =
        meta?.chart && typeof meta.chart === 'object'
          ? {
              kind: String(meta.chart.kind || 'metric').slice(0, 60),
              label: String(meta.chart.label || '').slice(0, 180),
              value: Number.isFinite(Number(meta.chart.value)) ? Number(meta.chart.value) : 0,
              max: Number.isFinite(Number(meta.chart.max)) ? Math.max(1, Number(meta.chart.max)) : 1,
              linesRead: Number.isFinite(Number(meta.chart.linesRead)) ? Number(meta.chart.linesRead) : undefined,
              charsRead: Number.isFinite(Number(meta.chart.charsRead)) ? Number(meta.chart.charsRead) : undefined,
              status: String(meta.chart.status || '').slice(0, 40),
              url: String(meta.chart.url || '').slice(0, 320),
              index: Number.isFinite(Number(meta.chart.index)) ? Number(meta.chart.index) : undefined,
              total: Number.isFinite(Number(meta.chart.total)) ? Number(meta.chart.total) : undefined,
            }
          : undefined

      emit({
        type: 'thinking',
        summary: text.slice(0, 4000),
        step: Number.isFinite(Number(meta.step)) ? Number(meta.step) : undefined,
        chart,
        // 'steering' routes application-injected context (session preamble, overwatcher steer)
        // into the timeline's "Application steering" group, hidden unless Dev mode is on.
        channel: meta.channel ? String(meta.channel) : undefined,
      })
    },
    todo(op, text) {
      emit({ type: 'todo', op: String(op || 'update'), text: String(text || '').slice(0, 300) })
    },
    // Records a tool-call event in the active agent timeline.
    toolCall(tool, moduleName, args, meta = {}) {
      emit({
        type: 'tool_call',
        tool,
        module: moduleName,
        argsPreview: toPreview(args, 500),
        step: Number.isFinite(Number(meta.step)) ? Number(meta.step) : undefined,
        timeoutMs: Number.isFinite(Number(meta.timeoutMs)) ? Number(meta.timeoutMs) : undefined,
      })
    },
    // Records a bounded tool-result event in the active agent timeline.
    toolResult(tool, moduleName, status, output, errorMessage, meta = {}) {
      // Surface a file-write green/red diff (Workstream D QoL) as first-class event fields
      // when the result carries one, so the timeline renders it without re-parsing the JSON
      // preview. Only when present — leaves every other tool result untouched.
      const diffFields = {}
      if (status === 'ok' && output && typeof output === 'object' && !Array.isArray(output)) {
        if (Number.isFinite(Number(output.added))) diffFields.added = Number(output.added)
        if (Number.isFinite(Number(output.removed))) diffFields.removed = Number(output.removed)
        if (typeof output.diff === 'string' && output.diff) {
          diffFields.diff = String(output.diff).slice(0, 6000)
        }
      }
      emit({
        type: 'tool_result',
        tool,
        module: moduleName,
        status,
        outputPreview: status === 'ok' ? toPreview(output, 900) : toPreview(errorMessage || 'Unknown tool error', 900),
        ...diffFields,
        step: Number.isFinite(Number(meta.step)) ? Number(meta.step) : undefined,
        durationMs: Number.isFinite(Number(meta.durationMs)) ? Number(meta.durationMs) : undefined,
        exitCode: Number.isFinite(Number(meta.exitCode)) ? Number(meta.exitCode) : undefined,
      })
    },
    // Passthrough for externally-sourced events (e.g. sub-agent activity) that
    // already carry their own shape. Used to surface sub-agent thinking inline.
    raw(event) {
      if (event && typeof event === 'object') emit(event)
    },
  }
}
