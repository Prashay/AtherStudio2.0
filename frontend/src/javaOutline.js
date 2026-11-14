export function javaOutline(path, source) {
  if (!path?.endsWith('.java')) return []
  const mask = (match) => match.replace(/[^\r\n]/g, ' ')
  const code = source.replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\/\*[\s\S]*?\*\/|\/\/[^\r\n]*/g, mask)
  const declarations = /^\s*(?:(?:public|protected|private|static|final|abstract|synchronized|default|native|strictfp|sealed)\s+)*(?:(class|interface|enum|record)\s+([\w$]+)|([\w$.<>?,\[\] ]+)\s+([\w$]+)\s*\(([^;{}()]*)\)\s*(?:throws\s+[^;{}]+)?(?:\{|;))/gm
  return Array.from(code.matchAll(declarations), (entry) => {
    const [, type, className, returnType, method, parameters] = entry
    if (!type && /^(?:return|throw|new|else)\b/.test(returnType.trim())) return null
    const offset = entry.index + entry[0].search(/\S/)
    return {
      offset,
      line: code.slice(0, offset).split('\n').length,
      label: type ? className : `${method}(${parameters.trim().replace(/\s+/g, ' ')}): ${returnType.trim()}`,
      kind: type ? 'type' : 'method',
      runnable: !type && method === 'main' && /\bstatic\b/.test(entry[0])
    }
  }).filter(Boolean)
}
