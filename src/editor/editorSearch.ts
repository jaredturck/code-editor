import {
  SearchQuery,
  closeSearchPanel,
  findNext,
  findPrevious,
  getSearchQuery,
  openSearchPanel,
  replaceAll,
  replaceNext,
  search,
  setSearchQuery,
} from '@codemirror/search'
import { StateEffect, StateField, type Extension } from '@codemirror/state'
import { EditorView, type Panel, type ViewUpdate } from '@codemirror/view'

const set_replace_open = StateEffect.define<boolean>()
const replace_open_field = StateField.define({
  create: () => false,
  update: (value, transaction) => {
    for (const effect of transaction.effects) {
      if (effect.is(set_replace_open)) {
        return effect.value
      }
    }

    return value
  },
})
const panel_instances = new WeakMap<EditorView, EditorSearchPanel>()

function create_button(label: string, title: string, on_click: () => void) {
  const button = document.createElement('button')

  button.type = 'button'
  button.className = 'cm-editor-search-button'
  button.textContent = label
  button.title = title
  button.setAttribute('aria-label', title)
  button.addEventListener('click', on_click)

  return button
}

class EditorSearchPanel implements Panel {
  dom: HTMLElement
  top = true
  private view: EditorView
  private search_input: HTMLInputElement
  private replace_input: HTMLInputElement
  private expand_button: HTMLButtonElement
  private case_button: HTMLButtonElement
  private word_button: HTMLButtonElement
  private regex_button: HTMLButtonElement
  private previous_button: HTMLButtonElement
  private next_button: HTMLButtonElement
  private replace_button: HTMLButtonElement
  private replace_all_button: HTMLButtonElement
  private result_label: HTMLSpanElement
  private query: SearchQuery

  constructor(view: EditorView) {
    this.view = view
    this.query = getSearchQuery(view.state)
    this.dom = document.createElement('div')
    this.dom.className = 'cm-editor-search-panel'
    this.dom.addEventListener('keydown', (event) => this.handle_keydown(event))

    this.expand_button = create_button('›', 'Show replace', () => this.toggle_replace())
    this.expand_button.classList.add('cm-editor-search-expand')

    this.search_input = document.createElement('input')
    this.search_input.className = 'cm-editor-search-input'
    this.search_input.placeholder = 'Find'
    this.search_input.setAttribute('aria-label', 'Find')
    this.search_input.setAttribute('main-field', 'true')
    this.search_input.value = this.query.search
    this.search_input.addEventListener('input', () => this.commit())

    this.replace_input = document.createElement('input')
    this.replace_input.className = 'cm-editor-search-input'
    this.replace_input.placeholder = 'Replace'
    this.replace_input.setAttribute('aria-label', 'Replace')
    this.replace_input.value = this.query.replace
    this.replace_input.addEventListener('input', () => this.commit())

    this.case_button = create_button('Aa', 'Match case', () => this.toggle_query_option('case'))
    this.word_button = create_button('ab', 'Match whole word', () => this.toggle_query_option('word'))
    this.regex_button = create_button('.*', 'Use regular expression', () => this.toggle_query_option('regex'))
    this.result_label = document.createElement('span')
    this.result_label.className = 'cm-editor-search-results'
    this.result_label.setAttribute('aria-live', 'polite')

    this.previous_button = create_button('↑', 'Previous match', () => findPrevious(this.view))
    this.next_button = create_button('↓', 'Next match', () => findNext(this.view))
    const close_button = create_button('×', 'Close search', () => closeSearchPanel(this.view))

    const search_field = document.createElement('div')
    search_field.className = 'cm-editor-search-field'
    search_field.append(
      this.search_input,
      this.case_button,
      this.word_button,
      this.regex_button,
      this.result_label,
      this.previous_button,
      this.next_button,
      close_button,
    )

    this.replace_button = create_button('Replace', 'Replace current match', () => replaceNext(this.view))
    this.replace_all_button = create_button('All', 'Replace all matches', () => replaceAll(this.view))

    const replace_field = document.createElement('div')
    replace_field.className = 'cm-editor-search-field cm-editor-replace-field'
    replace_field.append(this.replace_input, this.replace_button, this.replace_all_button)

    const fields = document.createElement('div')
    fields.className = 'cm-editor-search-fields'
    fields.append(search_field, replace_field)

    this.dom.append(this.expand_button, fields)
    panel_instances.set(view, this)
    this.sync_from_state()
  }

  mount() {
    this.search_input.focus()
    this.search_input.select()
  }

  update(update: ViewUpdate) {
    if (
      update.docChanged ||
      update.selectionSet ||
      update.transactions.some((transaction) => transaction.effects.length > 0)
    ) {
      this.sync_from_state()
    }
  }

  destroy() {
    panel_instances.delete(this.view)
  }

  focus_search() {
    this.search_input.focus()
    this.search_input.select()
  }

  private handle_keydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      event.preventDefault()
      closeSearchPanel(this.view)
      return
    }

    if (event.key !== 'Enter') {
      return
    }

    if (event.target === this.search_input) {
      event.preventDefault()
      ;(event.shiftKey ? findPrevious : findNext)(this.view)
    }

    if (event.target === this.replace_input) {
      event.preventDefault()
      replaceNext(this.view)
    }
  }

  private toggle_replace() {
    const replace_open = !this.view.state.field(replace_open_field)

    this.view.dispatch({ effects: set_replace_open.of(replace_open) })

    if (replace_open) {
      this.replace_input.focus()
    } else {
      this.search_input.focus()
    }
  }

  private toggle_query_option(option: 'case' | 'word' | 'regex') {
    this.query = new SearchQuery({
      search: this.search_input.value,
      replace: this.replace_input.value,
      caseSensitive: option === 'case' ? !this.query.caseSensitive : this.query.caseSensitive,
      wholeWord: option === 'word' ? !this.query.wholeWord : this.query.wholeWord,
      regexp: option === 'regex' ? !this.query.regexp : this.query.regexp,
    })
    this.view.dispatch({ effects: setSearchQuery.of(this.query) })
  }

  private commit() {
    const query = new SearchQuery({
      search: this.search_input.value,
      replace: this.replace_input.value,
      caseSensitive: this.query.caseSensitive,
      wholeWord: this.query.wholeWord,
      regexp: this.query.regexp,
    })

    if (!query.eq(this.query)) {
      this.query = query
      this.view.dispatch({ effects: setSearchQuery.of(query) })
    }
  }

  private sync_from_state() {
    const query = getSearchQuery(this.view.state)
    const replace_open = this.view.state.field(replace_open_field)

    this.query = query

    if (this.search_input.value !== query.search) {
      this.search_input.value = query.search
    }

    if (this.replace_input.value !== query.replace) {
      this.replace_input.value = query.replace
    }

    this.case_button.classList.toggle('is-active', query.caseSensitive)
    this.case_button.setAttribute('aria-pressed', String(query.caseSensitive))
    this.word_button.classList.toggle('is-active', query.wholeWord)
    this.word_button.setAttribute('aria-pressed', String(query.wholeWord))
    this.regex_button.classList.toggle('is-active', query.regexp)
    this.regex_button.setAttribute('aria-pressed', String(query.regexp))
    this.search_input.setAttribute('aria-invalid', String(!query.valid))
    this.dom.classList.toggle('cm-search-replace-open', replace_open)
    this.expand_button.classList.toggle('is-open', replace_open)
    this.expand_button.textContent = replace_open ? '⌄' : '›'
    this.expand_button.title = replace_open ? 'Hide replace' : 'Show replace'

    this.update_results()
  }

  private update_results() {
    if (!this.query.valid) {
      this.result_label.textContent = 'Invalid expression'
      this.set_action_disabled(true)
      return
    }

    if (!this.query.search) {
      this.result_label.textContent = 'No results'
      this.set_action_disabled(true)
      return
    }

    const selection = this.view.state.selection.main
    let count = 0
    let current_match = 0
    let truncated = false

    const cursor = this.query.getCursor(this.view.state)

    for (let next_match = cursor.next(); !next_match.done; next_match = cursor.next()) {
      const match = next_match.value

      count += 1

      if (match.from === selection.from && match.to === selection.to) {
        current_match = count
      }

      if (count === 1000) {
        truncated = true
        break
      }
    }

    if (count === 0) {
      this.result_label.textContent = 'No results'
      this.set_action_disabled(true)
      return
    }

    if (truncated) {
      this.result_label.textContent = current_match ? `${current_match} of 1000+` : '1000+ results'
    } else if (current_match) {
      this.result_label.textContent = `${current_match} of ${count}`
    } else {
      this.result_label.textContent = `${count} ${count === 1 ? 'result' : 'results'}`
    }

    this.set_action_disabled(false)
  }

  private set_action_disabled(disabled: boolean) {
    this.previous_button.disabled = disabled
    this.next_button.disabled = disabled
    this.replace_button.disabled = disabled
    this.replace_all_button.disabled = disabled
  }
}

function create_search_panel(view: EditorView) {
  return new EditorSearchPanel(view)
}

export const editor_search_extension: Extension = [
  replace_open_field,
  search({ top: true, createPanel: create_search_panel }),
]

export function open_editor_search(view: EditorView, replace_open: boolean) {
  view.dispatch({ effects: set_replace_open.of(replace_open) })
  openSearchPanel(view)
  panel_instances.get(view)?.focus_search()
  return true
}
