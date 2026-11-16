import { maskJavaNonCode } from './javaImports.js'

export function javaSnippet(source, line, column) {
  const code = maskJavaNonCode(source)
  const lines = code.split('\n')
  const text = lines[line - 1] || ''
  const match = /^([\t ]*)(main\(\)|sysout)(?:;)?[\t \r]*$/.exec(text)
  if (!match) return null
  const [, indent, trigger] = match
  const end = indent.length + trigger.length + (text[indent.length + trigger.length] === ';' ? 1 : 0)
  if (column < indent.length + trigger.length || column > end) return null

  const lineStart = lines.slice(0, line - 1).reduce((offset, row) => offset + row.length + 1, 0)
  const prefix = code.slice(0, lineStart)
  const open = prefix.lastIndexOf('{')
  if (open < 0) return null

  let depth = 0
  for (const token of prefix.matchAll(/[{}]/g)) depth += token[0] === '{' ? 1 : -1
  const isMain = trigger === 'main()'
  if (isMain ? depth !== 1 : depth < 2) return null

  const newline = source.includes('\r\n') ? '\r\n' : '\n'
  const bodyIndent = indent + (indent.includes('\t') ? '\t' : '  ')
  const head = 'public static void main(String[] args) {'
  const replacement = isMain ? head + newline + bodyIndent + newline + indent + '}' : 'System.out.println();'
  const start = lineStart + indent.length
  const caret = start + (isMain ? head.length + newline.length + bodyIndent.length : 'System.out.println('.length)
  return {
    offset: indent.length,
    label: isMain ? 'Create main method' : 'Print to console',
    preview: isMain ? 'public static void main(String[] args)' : 'System.out.println();',
    source: source.slice(0, start) + replacement + source.slice(lineStart + end),
    caret,
  }
}
