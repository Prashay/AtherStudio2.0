import { maskJavaNonCode } from './javaImports.js'

const identifier = /^[\p{L}_$][\p{L}\p{N}_$]*$/u

export function javaDiagnosticTarget(rawLine, diagnostic) {
  if (!rawLine || !diagnostic?.column) return null
  const column = Math.min(diagnostic.column - 1, rawLine.length)
  const symbol = diagnostic.message.match(/\bsymbol:\s+(?:variable|method|class)\s+([\p{L}_$][\p{L}\p{N}_$]*)/u)?.[1]
  const publicType = diagnostic.message.match(/should be declared in a file named ([^\s/]+)\.java(?:$|\s)/)?.[1]
  const tokens = [...maskJavaNonCode(rawLine).matchAll(/[\p{L}_$][\p{L}\p{N}_$]*/gu)]
  const exact = tokens.find((token) => column >= token.index && column < token.index + token[0].length)
  const name = symbol || publicType
  const named = name && tokens.filter((token) => token[0] === name)
    .sort((a, b) => Math.abs(a.index - column) - Math.abs(b.index - column))[0]
  const token = named || exact
  if (token) return { text: token[0], start: token.index, end: token.index + token[0].length }
  const character = rawLine[column]
  return character?.trim() ? { text: character, start: column, end: column + 1 } : null
}

export function javaReferenceChange(source, lines, line, target, replacement) {
  const name = replacement.trim()
  if (!target || !identifier.test(name) || name === target.text) return null
  const lineStart = lines.slice(0, line - 1).reduce((offset, text) => offset + text.length + 1, 0)
  const start = lineStart + target.start
  return { source: source.slice(0, start) + name + source.slice(lineStart + target.end), caret: start + name.length }
}

export function javaParameterSuggestion(outline, line, name) {
  const enclosing = outline.filter((item) => item.kind === 'method' && item.startLine <= line && item.endLine >= line).at(-1)
  const params = enclosing?.detail.match(/^\((.*)\):/)?.[1] || ''
  const candidates = params.split(',').map((param) => param.match(/\s+([\w$]+)\s*(?:\[\s*\])*\s*$/)?.[1])
    .filter((param) => param && param !== name)
  const near = candidates.filter((param) => {
    if (param.length === name.length) return [...name].filter((letter, index) => letter !== param[index]).length === 1
    const [short, long] = name.length < param.length ? [name, param] : [param, name]
    return long.length === short.length + 1 && [...long].some((_, index) => long.slice(0, index) + long.slice(index + 1) === short)
  })
  return near.length === 1 ? near[0] : null
}
