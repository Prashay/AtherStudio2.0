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

export function inferVariableType(lineText, varName) {
  const line = (lineText || '').trim()
  const escaped = varName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

  // 1. Assigned to a typed variable: Type x = varName;
  const assignMatch = new RegExp(`(?:(?:final|var)\\s+)?([A-Za-z0-9_<>\\[\\]]+)\\s+[\\w$]+\\s*=\\s*.*\\b${escaped}\\b`).exec(line)
  if (assignMatch && assignMatch[1] !== 'var') return assignMatch[1]

  // 2. Numeric comparison or operators: i < varName, varName + 1
  if (new RegExp(`(?:<|>|<=|>=|==|!=)\\s*${escaped}|${escaped}\\s*(?:<|>|<=|>=|==|!=)`).test(line) ||
      new RegExp(`[+\\-*/%]\\s*${escaped}|${escaped}\\s*[+\\-*/%]`).test(line)) {
    return 'int'
  }

  // 3. String concatenation: "..." + varName or varName + "..."
  if (new RegExp(`"[^"]*"\\s*\\+\\s*${escaped}|${escaped}\\s*\\+\\s*"[^"]*"`).test(line)) {
    return 'String'
  }

  // 4. Method call on variable: varName.method()
  const callMatch = new RegExp(`${escaped}\\s*\\.\\s*([\\w$]+)\\s*\\(`).exec(line)
  if (callMatch) {
    const called = callMatch[1]
    if (['length', 'charAt', 'substring', 'toLowerCase', 'toUpperCase'].includes(called)) return 'String'
    if (['size', 'add', 'get', 'contains', 'isEmpty'].includes(called)) return 'List<Object>'
  }

  // 5. Array indexing: varName[i]
  if (new RegExp(`${escaped}\\s*\\[`).test(line)) {
    return 'int[]'
  }

  // 6. Boolean condition: if (varName)
  if (new RegExp(`(?:if|while)\\s*\\(\\s*!?${escaped}\\s*\\)`).test(line)) {
    return 'boolean'
  }

  return 'Object'
}

export function getDefaultValueForType(type) {
  const t = (type || '').trim()
  if (t === 'boolean') return 'false'
  if (/^(?:int|long|short|byte|char)$/.test(t)) return '0'
  if (/^(?:double|float)$/.test(t)) return '0.0'
  if (t === 'String') return '""'
  if (/\[\]$/.test(t)) return `new ${t.replace(/\[\]$/, '[0]')}`
  return 'null'
}

export function javaMethodActions(source, outline, line, methodName, rawParams = '', callingLine = '') {
  const enclosingMethod = outline.filter((item) => (item.kind === 'method' || item.subKind === 'method') && item.startLine <= line && (item.endLine || item.startLine + 20) >= line).at(-1)
  const enclosingClass = outline.filter((item) => (item.kind === 'class' || item.subKind === 'class') && item.startLine <= line && (item.endLine || 99999) >= line).at(-1)
    || outline.find((item) => item.kind === 'class' || item.subKind === 'class')

  const code = maskJavaNonCode(source)
  const isStaticCaller = enclosingMethod
    ? /\bstatic\b/.test(code.slice(enclosingMethod.offset, code.indexOf('(', enclosingMethod.offset)))
    : true

  // Infer return type from calling line
  let returnType = 'void'
  const trimmed = (callingLine || '').trim()
  const declMatch = /(?:(?:final|var)\s+)?([A-Za-z0-9_<>[\]]+)\s+[\w$]+\s*=\s*/.exec(trimmed)
  if (declMatch && declMatch[1] !== 'var') {
    returnType = declMatch[1]
  } else if (/^(?:if|while)\s*\(/.test(trimmed) || /[!&|]/.test(trimmed)) {
    returnType = 'boolean'
  } else if (/^return\b/.test(trimmed) && enclosingMethod?.detail) {
    const retMatch = enclosingMethod.detail.match(/:\s*([A-Za-z0-9_<>[\]]+)$/)
    if (retMatch) returnType = retMatch[1]
  } else if (/[+\-*/%]/.test(trimmed)) {
    returnType = 'int'
  } else if (/\bSystem\.out\.print(?:ln)?\s*\(/.test(trimmed)) {
    returnType = 'String'
  }

  // Parse parameters
  const formattedParams = []
  if (rawParams && rawParams.trim()) {
    const rawList = rawParams.split(',').map((p) => p.trim())
    rawList.forEach((rawType, idx) => {
      const simpleType = rawType.replace(/^(?:java\.lang\.|java\.util\.)/, '')
      let pName = `arg${idx + 1}`
      if (/^int|^long|^short|^byte/.test(simpleType)) pName = idx === 0 ? 'a' : String.fromCharCode(97 + idx)
      else if (/^String/.test(simpleType)) pName = idx === 0 ? 'str' : `str${idx + 1}`
      else if (/^boolean/.test(simpleType)) pName = idx === 0 ? 'flag' : `flag${idx + 1}`
      else if (/\[\]$/.test(simpleType)) pName = 'arr'
      else {
        pName = simpleType.charAt(0).toLowerCase() + simpleType.slice(1).replace(/<.*>|\[\]/g, '') || `arg${idx + 1}`
      }
      formattedParams.push(`${simpleType} ${pName}`)
    })
  }

  // Default return statement
  let defaultReturn = ''
  if (returnType === 'boolean') defaultReturn = 'return false;'
  else if (/^(?:int|long|short|byte|char)$/.test(returnType)) defaultReturn = 'return 0;'
  else if (/^(?:double|float)$/.test(returnType)) defaultReturn = 'return 0.0;'
  else if (returnType !== 'void') defaultReturn = 'return null;'

  const newline = source.includes('\r\n') ? '\r\n' : '\n'
  let insertOffset = -1
  let indent = '    '

  if (enclosingMethod && enclosingMethod.endOffset) {
    insertOffset = enclosingMethod.endOffset
    const lineStart = code.lastIndexOf('\n', enclosingMethod.offset - 1) + 1
    indent = code.slice(lineStart, enclosingMethod.offset).match(/^[\t ]*/)?.[0] || '    '
  } else if (enclosingClass && enclosingClass.endOffset) {
    insertOffset = enclosingClass.endOffset - 1
    indent = '    '
  } else {
    const lastBrace = code.lastIndexOf('}')
    insertOffset = lastBrace >= 0 ? lastBrace : source.length
    indent = '    '
  }

  const modifier = isStaticCaller ? 'public static ' : 'private '
  const bodyIndent = indent + (indent.includes('\t') ? '\t' : '    ')
  const bodyContent = defaultReturn ? `${newline}${bodyIndent}${defaultReturn}${newline}` : `${newline}${bodyIndent}`
  const methodSignature = `${modifier}${returnType} ${methodName}(${formattedParams.join(', ')})`
  const methodCode = `${newline}${newline}${indent}${methodSignature} {${bodyContent}${indent}}`

  return {
    label: `Create method '${methodName}(${formattedParams.map((p) => p.split(' ')[0]).join(', ')})'`,
    returnType,
    params: formattedParams.join(', '),
    source: source.slice(0, insertOffset) + methodCode + source.slice(insertOffset),
    caret: insertOffset + methodCode.indexOf('{') + 1 + (defaultReturn ? newline.length + bodyIndent.length : 0),
    preview: methodSignature
  }
}
