import { maskJavaNonCode } from './javaImports.js'

export function makeJavaTypePackagePrivate(source, line, classFix) {
  if (!classFix) return null
  const code = maskJavaNonCode(source)
  const start = code.split('\n').slice(0, line - 1).reduce((sum, row) => sum + row.length + 1, 0)
  const declaration = code.slice(start, code.indexOf('\n', start) < 0 ? undefined : code.indexOf('\n', start))
  const modifier = /\bpublic\b[\t ]*/.exec(declaration)
  if (!modifier) return null
  const offset = start + modifier.index
  return {
    label: 'Make class package-private',
    source: source.slice(0, offset) + source.slice(offset + modifier[0].length),
    caret: offset,
  }
}

export function javaVariableActions(source, outline, line, name) {
  const method = outline.filter((item) => item.kind === 'method' && item.startLine < line && item.endLine >= line).at(-1)
  if (!method) return []
  const code = maskJavaNonCode(source)
  const opening = code.indexOf('(', method.offset)
  const closing = code.indexOf(')', opening + 1)
  const body = code.indexOf('{', closing + 1)
  if (opening < method.offset || closing < opening || body < closing) return []

  const stack = []
  for (const token of code.slice(0, method.offset).matchAll(/[{}]/g)) {
    if (token[0] === '{') stack.push(token.index)
    else stack.pop()
  }
  const parent = stack.at(-1)
  const newline = source.includes('\r\n') ? '\r\n' : '\n'
  const methodLine = code.lastIndexOf('\n', method.offset - 1) + 1
  const indent = code.slice(methodLine, method.offset).match(/^[\t ]*/)[0]
  const blockIndent = indent + (indent.includes('\t') ? '\t' : '  ')
  const parameterText = code.slice(opening + 1, closing).trim()
  const beforeVarargs = parameterText.includes('...')
  const create = (label, offset, needsValue, prefix, suffix) => ({
    label, needsValue,
    edit(type, initialValue) {
      const normalizedType = type.trim()
      if (!/^[\p{L}_$][\p{L}\p{N}_$.]*(?:\s*<[\p{L}\p{N}_$.,?<>\[\] \t]+>)?(?:\s*\[\s*\])*$/u.test(normalizedType) ||
        /^(?:void|var)$/.test(normalizedType)) return null
      const initializer = initialValue.trim()
      if (needsValue && !initializer) return null
      if (initializer.includes('\n') || initializer.includes('\r') || /[;{}]/.test(maskJavaNonCode(initializer))) return null
      const declaration = normalizedType + ' ' + name + (needsValue ? ' = ' + initializer : '')
      const preview = prefix + declaration + suffix
      return { preview, source: source.slice(0, offset) + preview + source.slice(offset), caret: offset + preview.length }
    },
  })
  const actions = [
    create('Create parameter', beforeVarargs ? opening + 1 : closing, false,
      parameterText && !beforeVarargs ? ', ' : '', beforeVarargs ? ', ' : ''),
  ]
  // A local declaration cannot go before an explicit constructor invocation.
  if (!/^\s*(?:this|super)\s*\(/.test(code.slice(body + 1))) {
    const suffix = /^[\r\n]/.test(source.slice(body + 1)) ? ';' : ';' + newline + blockIndent
    actions.unshift(create('Create local variable', body + 1, true, newline + blockIndent, suffix))
  }
  const parentHeader = parent === undefined ? '' : code.slice(0, parent).split(/[{};]/).at(-1)
  if (/\bclass\s+[\w$]+/.test(parentHeader)) {
    const isStatic = /\bstatic\b/.test(code.slice(method.offset, opening))
    actions.splice(1, 0, create('Create field', parent + 1, true,
      newline + indent + 'private ' + (isStatic ? 'static ' : ''), ';' + newline))
  }
  return actions
}
