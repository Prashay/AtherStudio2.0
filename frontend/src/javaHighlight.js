import { javaOutline } from './javaOutline.js'

const keywords = new Set('abstract assert break case catch class const continue default do else enum exports extends final finally for goto if implements import instanceof interface module native new non-sealed open opens package permits private protected provides public record requires return sealed static strictfp super switch synchronized this throw throws to transient try uses var volatile while with yield'.split(' '))
const types = new Set('boolean byte char double float int long short void'.split(' '))
const literals = new Set(['true', 'false', 'null'])

export function javaHighlight(path, source) {
  const methodOffsets = new Set(javaOutline(path, source).filter(({ kind }) => kind === 'method').flatMap(({ offset }) => {
    const match = /^[^;{}()]*?([\w$]+)\s*\(/.exec(source.slice(offset))
    return match ? [offset + match[0].lastIndexOf(match[1])] : []
  }))
  const pattern = /\/\*[\s\S]*?(?:\*\/|$)|\/\/[^\n]*|"""[\s\S]*?(?:"""|$)|"(?:\\[^\n]|[^"\\\n])*"?|'(?:\\[^\n]|[^'\\\n])*'?|@[\p{L}_$][\p{L}\p{N}_$]*(?:\.[\p{L}_$][\p{L}\p{N}_$]*)*|\b(?:0[xX][\da-fA-F_]+|0[bB][01_]+|\d[\d_]*(?:\.[\d_]*)?(?:[eE][+-]?[\d_]+)?)[fFdDlL]?\b|[\p{L}_$][\p{L}\p{N}_$]*|[^]/gu
  const lines = [[]]
  let importPath = false
  for (const match of source.matchAll(pattern)) {
    const [token] = match
    const kind = token.startsWith('//') || token.startsWith('/*') ? 'comment'
      : /^["']/.test(token) ? 'string'
      : /^@/.test(token) && token.length > 1 ? 'annotation'
      : types.has(token) ? 'type'
      : keywords.has(token) ? 'keyword'
      : importPath && /^[\p{L}_$]/u.test(token) ? 'import'
      : methodOffsets.has(match.index) ? 'method'
      : literals.has(token) || /^\d/.test(token) ? 'literal'
      : /^\p{Lu}/u.test(token) ? 'type' : ''
    if (token === 'import' || token === 'package') importPath = true
    if (token === ';') importPath = false
    token.split('\n').forEach((part, index) => {
      if (index) lines.push([])
      if (!part) return
      const line = lines.at(-1)
      if (line.at(-1)?.kind === kind) line.at(-1).text += part
      else line.push({ text: part, kind })
    })
  }
  return lines
}
