export function javaOutline(path, source) {
  if (!path?.endsWith('.java')) return []
  const mask = (match) => match.replace(/[^\r\n]/g, ' ')
  const code = source.replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\/\*[\s\S]*?\*\/|\/\/[^\r\n]*/g, mask)
  const declarations = /^\s*(?:(?:public|protected|private|static|final|abstract|synchronized|default|native|strictfp|sealed)\s+)*(?:(class|interface|enum|record)\s+([\w$]+)|([\w$.<>?,\[\] ]+)\s+([\w$]+)\s*\(([^;{}()]*)\)\s*(?:throws\s+[^;{}]+)?(?:\{|;))/gm
  return Array.from(code.matchAll(declarations), (entry) => {
    const [, type, className, returnType, method, parameters] = entry
    if (!type && /^(?:return|throw|new|else)\b/.test(returnType.trim())) return null
    const offset = entry.index + entry[0].search(/\S/)
    const startLine = code.slice(0, offset).split('\n').length

    // Brace matching to calculate endLine and method minimization range
    let endLine = startLine
    let endOffset = offset
    if (entry[0].trimEnd().endsWith('{')) {
      let depth = 1
      let idx = entry.index + entry[0].length
      while (idx < code.length && depth > 0) {
        if (code[idx] === '{') depth++
        else if (code[idx] === '}') {
          depth--
          if (depth === 0) {
            endOffset = idx
            break
          }
        }
        idx++
      }
      endLine = code.slice(0, endOffset).split('\n').length
    }

    const subKind = type || 'method'
    const badge = type === 'class' ? 'C'
      : type === 'interface' ? 'I'
      : type === 'enum' ? 'E'
      : type === 'record' ? 'R'
      : 'M'
    const color = type === 'class' ? '#f59e0b'
      : type === 'interface' ? '#a855f7'
      : type === 'enum' ? '#d97706'
      : type === 'record' ? '#fb923c'
      : '#38bdf8'

    const name = type ? className : method
    const cleanParams = parameters ? parameters.trim().replace(/\s+/g, ' ') : ''
    const detail = type ? type : `(${cleanParams})${returnType ? ': ' + returnType.trim() : ''}`

    return {
      offset,
      line: startLine,
      startLine,
      endLine,
      canFold: endLine > startLine,
      label: type ? className : `${method}(${cleanParams}): ${returnType ? returnType.trim() : 'void'}`,
      name,
      detail,
      kind: type ? 'type' : 'method',
      subKind,
      badge,
      color,
      runnable: !type && method === 'main' && /\bstatic\b/.test(entry[0])
    }
  }).filter(Boolean)
}
