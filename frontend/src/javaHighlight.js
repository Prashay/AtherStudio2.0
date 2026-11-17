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
      : (!keywords.has(token) && !types.has(token) && /^[\p{L}_$][\p{L}\p{N}_$]*$/u.test(token) && /^\s*\(/.test(source.slice(match.index + token.length))) ? 'method'
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

function pushTokenLines(lines, token, kind) {
  token.split('\n').forEach((part, index) => {
    if (index) lines.push([])
    if (!part) return
    const line = lines.at(-1)
    if (line.at(-1)?.kind === kind) line.at(-1).text += part
    else line.push({ text: part, kind })
  })
}

function splitIndentGuides(indentText = '', step = 2) {
  const tokens = []
  let i = 0
  while (i < indentText.length) {
    const chunk = indentText.slice(i, i + step)
    tokens.push({ text: chunk, kind: chunk.length === step && i >= step ? 'indent-guide' : '' })
    i += step
  }
  return tokens
}

export function jsonHighlight(source) {
  const rawLines = source.split('\n')
  return rawLines.map((line) => {
    const tokens = []
    const indentMatch = /^([ ]+)/.exec(line)
    let restLine = line
    if (indentMatch) {
      tokens.push(...splitIndentGuides(indentMatch[1], 2))
      restLine = line.slice(indentMatch[1].length)
    }
    const pattern = /"(?:\\[^\n]|[^"\\\n])*"(?:\s*(?=:))?|"(?:\\[^\n]|[^"\\\n])*"|\b(?:true|false|null)\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|[^]/gu
    for (const match of restLine.matchAll(pattern)) {
      const [token] = match
      let kind = ''
      if (token.startsWith('"')) {
        const after = restLine.slice(match.index + token.length)
        if (/^\s*:/.test(after)) {
          kind = 'json-key'
        } else {
          kind = 'json-string'
        }
      } else if (/^(?:true|false|null)\b/.test(token)) {
        kind = 'json-boolean'
      } else if (/^-?\d/.test(token)) {
        kind = 'json-number'
      }
      if (tokens.at(-1)?.kind === kind && kind !== 'indent-guide') tokens.at(-1).text += token
      else tokens.push({ text: token, kind })
    }
    return tokens
  })
}

export function yamlHighlight(source) {
  const rawLines = source.split('\n')
  return rawLines.map((line) => {
    const tokens = []
    const indentMatch = /^([ ]+)/.exec(line)
    let restLine = line
    if (indentMatch) {
      tokens.push(...splitIndentGuides(indentMatch[1], 2))
      restLine = line.slice(indentMatch[1].length)
    }
    if (restLine.startsWith('#')) {
      tokens.push({ text: restLine, kind: 'comment' })
      return tokens
    }
    const keyMatch = /^((-\s+)?)([A-Za-z0-9_.-]+)(\s*:\s*)(.*)$/.exec(restLine)
    if (keyMatch) {
      const [, listDash, , key, colon, rest] = keyMatch
      if (listDash) tokens.push({ text: listDash, kind: 'yaml-punct' })
      tokens.push({ text: key, kind: 'yaml-key' })
      tokens.push({ text: colon, kind: 'yaml-punct' })
      if (rest) {
        tokens.push(...tokenizeYamlValue(rest))
      }
      return tokens
    }
    const listMatch = /^(-\s+)(.*)$/.exec(restLine)
    if (listMatch) {
      const [, prefix, rest] = listMatch
      tokens.push({ text: prefix, kind: 'yaml-punct' })
      tokens.push(...tokenizeYamlValue(rest))
      return tokens
    }
    tokens.push(...tokenizeYamlValue(restLine))
    return tokens
  })
}

function tokenizeYamlValue(text) {
  const result = []
  const pattern = /#.*$|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\b(?:true|false|null)\b|[^]/gu
  for (const match of text.matchAll(pattern)) {
    const [tok] = match
    const kind = tok.startsWith('#') ? 'comment'
      : /^["']/.test(tok) ? 'yaml-string'
      : /^(?:true|false|null)$/.test(tok) ? 'yaml-boolean'
      : 'yaml-scalar'
    if (result.at(-1)?.kind === kind) result.at(-1).text += tok
    else result.push({ text: tok, kind })
  }
  return result
}

export function codeHighlight(path = '', source = '') {
  const lower = path.toLowerCase()
  if (lower.endsWith('.java')) return javaHighlight(path, source)
  if (lower.endsWith('.json') || lower.endsWith('.webmanifest')) return jsonHighlight(source)
  if (lower.endsWith('.yml') || lower.endsWith('.yaml')) return yamlHighlight(source)
  return null
}
