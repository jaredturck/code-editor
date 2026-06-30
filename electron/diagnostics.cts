import { Linter } from 'eslint'
import { HtmlValidate } from 'html-validate'
import { parseTree, printParseErrorCode, type ParseError } from 'jsonc-parser'
import { PositionEncoding, Workspace } from '@astral-sh/ruff-wasm-nodejs'
import * as ts from 'typescript'
import { parseDocument } from 'yaml'

export type DiagnosticSeverity = 'error' | 'warning' | 'info'

export interface DiagnosticInput {
  language: string
  content: string
  file_path: string | null
}

export interface RawDiagnostic {
  source: string
  code: string | null
  severity: DiagnosticSeverity
  message: string
  line: number
  column: number
  end_line: number
  end_column: number
}

let ruff_workspace: Workspace | null = null
const eslint_linter = new Linter({ configType: 'flat' })
const html_validator = new HtmlValidate({
  extends: ['html-validate:recommended'],
})

function clamp_location(value: number | undefined, fallback = 1) {
  return Number.isFinite(value) && value && value > 0 ? Math.floor(value) : fallback
}

function normalize_message(message: string) {
  return message.replace(/\s+\([^()]+\)$/, '').trim()
}

function offset_to_position(content: string, offset: number) {
  const safe_offset = Math.max(0, Math.min(content.length, offset))
  const prefix = content.slice(0, safe_offset)
  const lines = prefix.split('\n')

  return {
    line: lines.length,
    column: (lines.at(-1)?.length ?? 0) + 1,
  }
}

function python_diagnostics(content: string): RawDiagnostic[] {
  ruff_workspace ??= new Workspace(
    {
      lint: {
        select: ['E4', 'E7', 'E9', 'F', 'B'],
      },
    },
    PositionEncoding.Utf16,
  )

  const diagnostics = ruff_workspace.check(content) as Array<{
    code: string | null
    message: string
    start_location: { row: number; column: number }
    end_location: { row: number; column: number }
  }>

  return diagnostics.map((diagnostic) => ({
    source: 'Ruff',
    code: diagnostic.code,
    severity: diagnostic.code === 'invalid-syntax' || diagnostic.code?.startsWith('E9') ? 'error' : 'warning',
    message: diagnostic.message,
    line: clamp_location(diagnostic.start_location.row),
    column: clamp_location(diagnostic.start_location.column),
    end_line: clamp_location(diagnostic.end_location.row, diagnostic.start_location.row),
    end_column: clamp_location(diagnostic.end_location.column, diagnostic.start_location.column + 1),
  }))
}

function javascript_diagnostics(content: string, file_path: string | null): RawDiagnostic[] {
  const filename = file_path ?? 'untitled.js'
  const messages = eslint_linter.verify(
    content,
    [
      {
        files: ['**/*.{js,jsx,mjs,cjs}'],
        languageOptions: {
          ecmaVersion: 'latest',
          sourceType: 'module',
          globals: {
            console: 'readonly',
            window: 'readonly',
            document: 'readonly',
            navigator: 'readonly',
            setTimeout: 'readonly',
            clearTimeout: 'readonly',
            setInterval: 'readonly',
            clearInterval: 'readonly',
            process: 'readonly',
            module: 'readonly',
            require: 'readonly',
            __dirname: 'readonly',
            __filename: 'readonly',
          },
          parserOptions: {
            ecmaFeatures: { jsx: true },
          },
        },
        rules: {
          'constructor-super': 2,
          'for-direction': 2,
          'getter-return': 2,
          'no-async-promise-executor': 2,
          'no-class-assign': 2,
          'no-compare-neg-zero': 2,
          'no-const-assign': 2,
          'no-constant-binary-expression': 2,
          'no-dupe-args': 2,
          'no-dupe-class-members': 2,
          'no-dupe-else-if': 2,
          'no-dupe-keys': 2,
          'no-duplicate-case': 2,
          'no-ex-assign': 2,
          'no-func-assign': 2,
          'no-import-assign': 2,
          'no-loss-of-precision': 2,
          'no-new-native-nonconstructor': 2,
          'no-obj-calls': 2,
          'no-promise-executor-return': 1,
          'no-self-assign': 1,
          'no-setter-return': 2,
          'no-sparse-arrays': 2,
          'no-this-before-super': 2,
          'no-undef': 2,
          'no-unexpected-multiline': 2,
          'no-unreachable': 2,
          'no-unreachable-loop': 1,
          'no-unsafe-finally': 2,
          'no-unsafe-negation': 2,
          'no-unused-labels': 1,
          'no-unused-private-class-members': 1,
          'no-unused-vars': [1, { args: 'after-used', ignoreRestSiblings: true }],
          'no-useless-backreference': 1,
          'no-useless-catch': 1,
          'no-useless-escape': 1,
          'require-yield': 2,
          'use-isnan': 2,
          'valid-typeof': 2,
        },
      },
    ],
    { filename },
  )

  return messages.map((message) => ({
    source: 'ESLint',
    code: message.ruleId,
    severity: message.severity === 2 ? 'error' : 'warning',
    message: message.message,
    line: clamp_location(message.line),
    column: clamp_location(message.column),
    end_line: clamp_location(message.endLine, message.line),
    end_column: clamp_location(message.endColumn, message.column + 1),
  }))
}

function typescript_diagnostics(content: string, file_path: string | null, jsx: boolean): RawDiagnostic[] {
  const filename = file_path ?? (jsx ? 'untitled.tsx' : 'untitled.ts')
  const compiler_options: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    jsx: jsx ? ts.JsxEmit.Preserve : undefined,
    noEmit: true,
    allowJs: false,
    skipLibCheck: true,
  }
  const default_host = ts.createCompilerHost(compiler_options)
  const source_file = ts.createSourceFile(
    filename,
    content,
    ts.ScriptTarget.Latest,
    true,
    jsx ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  )
  const jsx_globals_filename = '__editor_jsx_globals.d.ts'
  const jsx_globals_content = 'declare namespace JSX { interface IntrinsicElements { [elementName: string]: any } }'
  const jsx_globals_file = ts.createSourceFile(
    jsx_globals_filename,
    jsx_globals_content,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  )
  const host: ts.CompilerHost = {
    ...default_host,
    fileExists: (name) => name === filename || (jsx && name === jsx_globals_filename) || default_host.fileExists(name),
    readFile: (name) =>
      name === filename
        ? content
        : jsx && name === jsx_globals_filename
          ? jsx_globals_content
          : default_host.readFile(name),
    getSourceFile: (name, language_version, on_error, should_create_new_source_file) =>
      name === filename
        ? source_file
        : jsx && name === jsx_globals_filename
          ? jsx_globals_file
          : default_host.getSourceFile(name, language_version, on_error, should_create_new_source_file),
  }
  const root_names = jsx ? [jsx_globals_filename, filename] : [filename]
  const program = ts.createProgram(root_names, compiler_options, host)
  const diagnostics = ts.getPreEmitDiagnostics(program, source_file)

  return diagnostics
    .filter((diagnostic) => diagnostic.file?.fileName === filename || !diagnostic.file)
    .map((diagnostic) => {
      const start = diagnostic.start ?? 0
      const length = Math.max(1, diagnostic.length ?? 1)
      const start_position = source_file.getLineAndCharacterOfPosition(Math.min(start, content.length))
      const end_position = source_file.getLineAndCharacterOfPosition(Math.min(start + length, content.length))

      return {
        source: 'TypeScript',
        code: `TS${diagnostic.code}`,
        severity: diagnostic.category === ts.DiagnosticCategory.Warning ? 'warning' : 'error',
        message: ts.flattenDiagnosticMessageText(diagnostic.messageText, ' '),
        line: start_position.line + 1,
        column: start_position.character + 1,
        end_line: end_position.line + 1,
        end_column: end_position.character + 1,
      } satisfies RawDiagnostic
    })
}

async function css_diagnostics(content: string, file_path: string | null): Promise<RawDiagnostic[]> {
  const stylelint_module = await import('stylelint')
  const syntax = file_path?.toLowerCase().endsWith('.scss')
    ? 'postcss-scss'
    : file_path?.toLowerCase().endsWith('.less')
      ? 'postcss-less'
      : undefined
  const result = await stylelint_module.default.lint({
    code: content,
    codeFilename: file_path ?? 'untitled.css',
    customSyntax: syntax,
    config: {
      rules: {
        'at-rule-no-unknown': true,
        'block-no-empty': true,
        'color-no-invalid-hex': true,
        'declaration-block-no-duplicate-properties': true,
        'declaration-block-no-shorthand-property-overrides': true,
        'font-family-no-duplicate-names': true,
        'function-calc-no-unspaced-operator': true,
        'function-linear-gradient-no-nonstandard-direction': true,
        'keyframe-declaration-no-important': true,
        'media-feature-name-no-unknown': true,
        'named-grid-areas-no-invalid': true,
        'no-descending-specificity': null,
        'no-duplicate-at-import-rules': true,
        'no-duplicate-selectors': true,
        'no-empty-source': null,
        'no-invalid-double-slash-comments': true,
        'property-no-unknown': true,
        'selector-pseudo-class-no-unknown': true,
        'selector-pseudo-element-no-unknown': true,
        'string-no-newline': true,
        'unit-no-unknown': true,
      },
    },
  })

  return (result.results[0]?.warnings ?? []).map((warning) => ({
    source: 'Stylelint',
    code: warning.rule,
    severity: warning.severity === 'warning' ? 'warning' : 'error',
    message: normalize_message(warning.text),
    line: clamp_location(warning.line),
    column: clamp_location(warning.column),
    end_line: clamp_location(warning.endLine, warning.line),
    end_column: clamp_location(warning.endColumn, warning.column + 1),
  }))
}

async function html_diagnostics(content: string, file_path: string | null): Promise<RawDiagnostic[]> {
  const report = await html_validator.validateString(content, file_path ?? 'untitled.html')

  return report.results.flatMap((result) =>
    result.messages.map((message) => ({
      source: 'HTML Validate',
      code: message.ruleId,
      severity: message.severity === 2 ? 'error' : 'warning',
      message: message.message,
      line: clamp_location(message.line),
      column: clamp_location(message.column),
      end_line: clamp_location(message.line),
      end_column: clamp_location(message.column + Math.max(1, message.size ?? 1)),
    })),
  )
}

function json_diagnostics(content: string, comments_allowed: boolean): RawDiagnostic[] {
  const errors: ParseError[] = []
  parseTree(content, errors, {
    allowTrailingComma: comments_allowed,
    disallowComments: !comments_allowed,
  })

  return errors.map((error) => {
    const start = offset_to_position(content, error.offset)
    const end = offset_to_position(content, error.offset + Math.max(1, error.length))

    return {
      source: comments_allowed ? 'JSONC' : 'JSON',
      code: printParseErrorCode(error.error),
      severity: 'error',
      message: printParseErrorCode(error.error).replace(/([a-z])([A-Z])/g, '$1 $2'),
      line: start.line,
      column: start.column,
      end_line: end.line,
      end_column: end.column,
    }
  })
}

function yaml_column(position: { column?: number; col?: number }) {
  return position.column ?? position.col ?? 1
}

function yaml_diagnostics(content: string): RawDiagnostic[] {
  const document = parseDocument(content, { prettyErrors: false })

  return [...document.errors, ...document.warnings].map((error) => {
    const start_position = error.linePos?.[0] ?? offset_to_position(content, error.pos?.[0] ?? 0)
    const end_position = error.linePos?.[1] ?? offset_to_position(content, error.pos?.[1] ?? error.pos?.[0] ?? 0)

    return {
      source: 'YAML',
      code: error.code,
      severity: document.errors.includes(error) ? 'error' : 'warning',
      message: error.message.split('\n')[0],
      line: start_position.line,
      column: yaml_column(start_position),
      end_line: end_position.line,
      end_column: yaml_column(end_position),
    }
  })
}

async function markdown_diagnostics(content: string, file_path: string | null): Promise<RawDiagnostic[]> {
  const { lint } = await import('markdownlint/promise')
  const filename = file_path ?? 'untitled.md'
  const results = await lint({
    strings: { [filename]: content },
    config: {
      default: true,
      MD013: false,
      MD033: false,
      MD041: false,
    },
  })
  const errors = results[filename] ?? []

  return errors.map((error) => {
    const range = error.errorRange ?? [1, 1]

    return {
      source: 'Markdownlint',
      code: error.ruleNames[0] ?? null,
      severity: error.severity === 'warning' ? 'warning' : 'error',
      message: error.ruleDescription,
      line: error.lineNumber,
      column: range[0],
      end_line: error.lineNumber,
      end_column: range[0] + Math.max(1, range[1]),
    }
  })
}

export async function analyze_document(input: DiagnosticInput): Promise<RawDiagnostic[]> {
  const language = input.language.toLowerCase()

  if (language === 'python') {
    return python_diagnostics(input.content)
  }

  if (language === 'javascript' || language === 'jsx') {
    return javascript_diagnostics(input.content, input.file_path)
  }

  if (language === 'typescript' || language === 'tsx') {
    return typescript_diagnostics(input.content, input.file_path, language === 'tsx')
  }

  if (language === 'css' || language === 'scss' || language === 'less') {
    return css_diagnostics(input.content, input.file_path)
  }

  if (language === 'html') {
    return html_diagnostics(input.content, input.file_path)
  }

  if (language === 'json' || language === 'json5' || language === 'jsonc') {
    return json_diagnostics(input.content, language !== 'json')
  }

  if (language === 'yaml') {
    return yaml_diagnostics(input.content)
  }

  if (language === 'markdown') {
    return markdown_diagnostics(input.content, input.file_path)
  }

  return []
}
