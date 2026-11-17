import { maskJavaNonCode } from './javaImports.js'

const identifier = /^[\p{L}_$][\p{L}\p{N}_$]*$/u

export function javaDiagnosticTarget(rawLine, diagnostic) {
  if (!rawLine || !diagnostic) return null
  const col = typeof diagnostic.column === 'number' && diagnostic.column > 0 ? diagnostic.column - 1 : -1
  const symbol = diagnostic.message?.match(/\bsymbol:\s+(?:variable|method|class)\s+([\p{L}_$][\p{L}\p{N}_$]*)/u)?.[1]
  const publicType = diagnostic.message?.match(/should be declared in a file named ([^\s/]+)\.java(?:$|\s)/)?.[1]
  const tokens = [...maskJavaNonCode(rawLine).matchAll(/[\p{L}_$][\p{L}\p{N}_$]*/gu)]
  const name = symbol || publicType

  if (name) {
    const named = tokens.filter((token) => token[0] === name)
    if (named.length > 0) {
      if (col >= 0) {
        named.sort((a, b) => Math.abs(a.index - col) - Math.abs(b.index - col))
      }
      return { text: named[0][0], start: named[0].index, end: named[0].index + named[0][0].length }
    }
  }

  if (col >= 0) {
    const column = Math.min(col, rawLine.length)
    const exact = tokens.find((token) => column >= token.index && column < token.index + token[0].length)
    if (exact) return { text: exact[0], start: exact.index, end: exact.index + exact[0].length }
    const character = rawLine[column]
    if (character?.trim()) return { text: character, start: column, end: column + 1 }
  }

  if (tokens.length > 0) {
    return { text: tokens[0][0], start: tokens[0].index, end: tokens[0].index + tokens[0].length }
  }
  return null
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
