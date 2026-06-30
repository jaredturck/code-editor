import { HighlightStyle, defaultHighlightStyle, syntaxHighlighting } from '@codemirror/language'
import type { Extension } from '@codemirror/state'
import { tags } from '@lezer/highlight'
import type { SyntaxColorScheme, ThemeMode } from '../types/editor'

interface SyntaxPalette {
  text: string
  comment: string
  keyword: string
  function: string
  variable: string
  property: string
  type: string
  string: string
  number: string
  bool: string
  operator: string
  punctuation: string
  tag: string
  attribute: string
  heading: string
  link: string
  invalid: string
}

export const syntax_color_scheme_options: Array<{
  value: SyntaxColorScheme
  label: string
}> = [
  { value: 'default', label: 'Editor Default' },
  { value: 'high-contrast', label: 'High Contrast' },
  { value: 'modern', label: 'Modern' },
  { value: 'soft', label: 'Soft' },
  { value: 'classic', label: 'Classic' },
]

const dark_palettes: Record<Exclude<SyntaxColorScheme, 'default'>, SyntaxPalette> = {
  'high-contrast': {
    text: '#f8fafc',
    comment: '#a8b2c1',
    keyword: '#ff7ad9',
    function: '#72d7ff',
    variable: '#f8fafc',
    property: '#8be9fd',
    type: '#7fffd4',
    string: '#ffd580',
    number: '#b8f28c',
    bool: '#ff9f7a',
    operator: '#ffffff',
    punctuation: '#e2e8f0',
    tag: '#ff8f8f',
    attribute: '#ffe082',
    heading: '#7dd3fc',
    link: '#67e8f9',
    invalid: '#ffffff',
  },
  modern: {
    text: '#d4d4d4',
    comment: '#6a9955',
    keyword: '#c586c0',
    function: '#dcdcaa',
    variable: '#9cdcfe',
    property: '#9cdcfe',
    type: '#4ec9b0',
    string: '#ce9178',
    number: '#b5cea8',
    bool: '#569cd6',
    operator: '#d4d4d4',
    punctuation: '#d4d4d4',
    tag: '#569cd6',
    attribute: '#9cdcfe',
    heading: '#4fc1ff',
    link: '#4fc1ff',
    invalid: '#f44747',
  },
  soft: {
    text: '#d7d9df',
    comment: '#87909f',
    keyword: '#c7a0dc',
    function: '#a9c7e8',
    variable: '#d7d9df',
    property: '#aac6df',
    type: '#98c9bd',
    string: '#d8b49c',
    number: '#b6c99b',
    bool: '#b8a6d9',
    operator: '#c9cdd5',
    punctuation: '#aeb4bf',
    tag: '#c99b9b',
    attribute: '#cbb78f',
    heading: '#a7c7e7',
    link: '#8fc5dd',
    invalid: '#e48c8c',
  },
  classic: {
    text: '#e5e7eb',
    comment: '#7f9f7f',
    keyword: '#7aa2f7',
    function: '#f0c674',
    variable: '#e5e7eb',
    property: '#81a2be',
    type: '#8abeb7',
    string: '#b5bd68',
    number: '#de935f',
    bool: '#cc99cc',
    operator: '#c5c8c6',
    punctuation: '#b4b7b4',
    tag: '#cc6666',
    attribute: '#f0c674',
    heading: '#81a2be',
    link: '#5fafd7',
    invalid: '#ff6c6b',
  },
}

const light_palettes: Record<Exclude<SyntaxColorScheme, 'default'>, SyntaxPalette> = {
  'high-contrast': {
    text: '#111827',
    comment: '#42526b',
    keyword: '#8b008b',
    function: '#0047ab',
    variable: '#111827',
    property: '#005a9c',
    type: '#006b5b',
    string: '#8b3a00',
    number: '#176b00',
    bool: '#8a1c1c',
    operator: '#000000',
    punctuation: '#1f2937',
    tag: '#a31515',
    attribute: '#795e00',
    heading: '#005a9c',
    link: '#005a9c',
    invalid: '#ffffff',
  },
  modern: {
    text: '#1f1f1f',
    comment: '#008000',
    keyword: '#af00db',
    function: '#795e26',
    variable: '#001080',
    property: '#001080',
    type: '#267f99',
    string: '#a31515',
    number: '#098658',
    bool: '#0000ff',
    operator: '#1f1f1f',
    punctuation: '#1f1f1f',
    tag: '#800000',
    attribute: '#ff0000',
    heading: '#0070c1',
    link: '#006ab1',
    invalid: '#cd3131',
  },
  soft: {
    text: '#343943',
    comment: '#6e7a69',
    keyword: '#8d5a9e',
    function: '#5c7391',
    variable: '#343943',
    property: '#607a96',
    type: '#4e8075',
    string: '#946c56',
    number: '#5f7d45',
    bool: '#755f96',
    operator: '#525866',
    punctuation: '#666d78',
    tag: '#986060',
    attribute: '#8b744c',
    heading: '#577a9d',
    link: '#477f98',
    invalid: '#b64f4f',
  },
  classic: {
    text: '#202124',
    comment: '#3f7f5f',
    keyword: '#0000cc',
    function: '#795e00',
    variable: '#202124',
    property: '#005c99',
    type: '#006b64',
    string: '#a31515',
    number: '#7f3f00',
    bool: '#7f007f',
    operator: '#202124',
    punctuation: '#4b5563',
    tag: '#800000',
    attribute: '#795e00',
    heading: '#005c99',
    link: '#005faf',
    invalid: '#c00000',
  },
}

export function get_syntax_theme_palette(
  scheme: Exclude<SyntaxColorScheme, 'default'>,
  theme: Exclude<ThemeMode, 'system'>,
) {
  return theme === 'dark' ? dark_palettes[scheme] : light_palettes[scheme]
}

export function create_syntax_highlighting(scheme: SyntaxColorScheme, theme: Exclude<ThemeMode, 'system'>): Extension {
  if (scheme === 'default') {
    return syntaxHighlighting(defaultHighlightStyle, { fallback: true })
  }

  const palette = get_syntax_theme_palette(scheme, theme)
  const style = HighlightStyle.define([
    { tag: tags.meta, color: palette.comment },
    {
      tag: [tags.comment, tags.lineComment, tags.blockComment, tags.docComment],
      color: palette.comment,
    },
    {
      tag: [
        tags.keyword,
        tags.modifier,
        tags.operatorKeyword,
        tags.controlKeyword,
        tags.definitionKeyword,
        tags.moduleKeyword,
      ],
      color: palette.keyword,
    },
    {
      tag: [tags.function(tags.variableName), tags.function(tags.propertyName), tags.macroName],
      color: palette.function,
    },
    {
      tag: [tags.variableName, tags.self, tags.labelName, tags.definition(tags.variableName)],
      color: palette.variable,
    },
    {
      tag: [tags.propertyName, tags.definition(tags.propertyName)],
      color: palette.property,
    },
    {
      tag: [tags.typeName, tags.className, tags.namespace, tags.annotation],
      color: palette.type,
    },
    {
      tag: [tags.string, tags.docString, tags.character, tags.attributeValue, tags.regexp, tags.escape],
      color: palette.string,
    },
    { tag: [tags.number, tags.integer, tags.float], color: palette.number },
    { tag: [tags.bool, tags.null, tags.atom], color: palette.bool },
    {
      tag: [
        tags.operator,
        tags.arithmeticOperator,
        tags.logicOperator,
        tags.bitwiseOperator,
        tags.compareOperator,
        tags.updateOperator,
        tags.definitionOperator,
        tags.typeOperator,
        tags.controlOperator,
      ],
      color: palette.operator,
    },
    {
      tag: [tags.punctuation, tags.separator, tags.bracket, tags.paren, tags.squareBracket, tags.brace],
      color: palette.punctuation,
    },
    { tag: [tags.tagName, tags.angleBracket], color: palette.tag },
    { tag: tags.attributeName, color: palette.attribute },
    {
      tag: [tags.heading, tags.heading1, tags.heading2, tags.heading3],
      color: palette.heading,
      fontWeight: '600',
    },
    {
      tag: [tags.link, tags.url],
      color: palette.link,
      textDecoration: 'underline',
    },
    { tag: tags.emphasis, fontStyle: 'italic' },
    { tag: tags.strong, fontWeight: '700' },
    { tag: tags.strikethrough, textDecoration: 'line-through' },
    {
      tag: tags.invalid,
      color: palette.invalid,
      textDecoration: 'underline wavy',
    },
  ])

  return syntaxHighlighting(style, { fallback: true })
}
