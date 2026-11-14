// Real-time syntax and structural validation for:
// .json, .yml, .yaml, .xml, .html, .hbs, .csv, .md, .config, .properties, .env, .py, .js, .ts, .jsx, .tsx

export function validateSyntax(path = '', source = '') {
  if (!path || typeof source !== 'string') return []
  const ext = (path.match(/\.([^.]+)$/)?.[1] || '').toLowerCase()

  switch (ext) {
    case 'json':
      return validateJson(source)
    case 'yml':
    case 'yaml':
      return validateYaml(source)
    case 'xml':
      return validateXml(source)
    case 'html':
    case 'htm':
      return validateHtml(source)
    case 'hbs':
    case 'handlebars':
      return validateHandlebars(source)
    case 'csv':
    case 'tsv':
      return validateCsv(source, ext === 'tsv' ? '\t' : ',')
    case 'md':
    case 'markdown':
      return validateMarkdown(source)
    case 'config':
    case 'properties':
    case 'env':
    case 'ini':
    case 'conf':
      return validateProperties(source)
    case 'py':
      return validatePython(source)
    case 'js':
    case 'jsx':
    case 'ts':
    case 'tsx':
    case 'mjs':
    case 'cjs':
      return validateJavaScript(source)
    default:
      return []
  }
}

function validateJson(source) {
  if (!source.trim()) return []
  try {
    JSON.parse(source)
    return []
  } catch (err) {
    const lineColMatch = err.message.match(/line (\d+) column (\d+)/i)
    const posMatch = err.message.match(/at position (\d+)/i)
    let line = 1
    let column = 1

    if (lineColMatch) {
      line = parseInt(lineColMatch[1], 10)
      column = parseInt(lineColMatch[2], 10)
    } else if (posMatch) {
      const pos = parseInt(posMatch[1], 10)
      const slice = source.slice(0, Math.min(pos, source.length))
      const lines = slice.split('\n')
      line = lines.length
      column = lines[lines.length - 1].length + 1
    }

    return [{
      line,
      column,
      severity: 'error',
      message: err.message.replace(/^JSON\.parse:\s*/, '')
    }]
  }
}

function validateYaml(source) {
  const diagnostics = []
  const lines = source.split(/\r?\n/)
  const indentStack = [0]
  const keyLevels = new Map()

  for (let i = 0; i < lines.length; i++) {
    const lineNum = i + 1
    const rawLine = lines[i]
    const trimmed = rawLine.trim()

    if (!trimmed || trimmed.startsWith('#')) continue

    // 1. YAML tab prohibition
    const leadingTabs = rawLine.match(/^\t+/)
    if (leadingTabs) {
      diagnostics.push({
        line: lineNum,
        column: 1,
        severity: 'error',
        message: 'YAML prohibits tabs for indentation. Use spaces instead.'
      })
      continue
    }

    const indentMatch = rawLine.match(/^(\s*)/)
    const indent = indentMatch ? indentMatch[1].length : 0

    // 2. Check key: value syntax (missing space after colon)
    const missingSpaceColon = trimmed.match(/^([A-Za-z0-9_-]+):[^\s\r\n#]/)
    if (missingSpaceColon && !trimmed.startsWith('http:') && !trimmed.startsWith('https:')) {
      diagnostics.push({
        line: lineNum,
        column: indent + missingSpaceColon[1].length + 1,
        severity: 'error',
        message: `Missing space after colon in '${missingSpaceColon[0]}'`
      })
    }

    // 3. Unclosed quotes
    const singleQuotes = (trimmed.match(/'/g) || []).length
    const doubleQuotes = (trimmed.match(/"/g) || []).length
    if (singleQuotes % 2 !== 0 && !trimmed.endsWith('\\')) {
      diagnostics.push({
        line: lineNum,
        column: rawLine.indexOf("'") + 1,
        severity: 'error',
        message: 'Unclosed single quote in YAML string'
      })
    } else if (doubleQuotes % 2 !== 0 && !trimmed.endsWith('\\')) {
      diagnostics.push({
        line: lineNum,
        column: rawLine.indexOf('"') + 1,
        severity: 'error',
        message: 'Unclosed double quote in YAML string'
      })
    }

    // 4. Duplicate keys at the same level
    const keyMatch = trimmed.match(/^([A-Za-z0-9_-]+)\s*:/)
    if (keyMatch) {
      const key = keyMatch[1]
      const currentKeys = keyLevels.get(indent) || new Set()
      if (currentKeys.has(key)) {
        diagnostics.push({
          line: lineNum,
          column: indent + 1,
          severity: 'warning',
          message: `Duplicate key '${key}' at indentation level ${indent}`
        })
      } else {
        currentKeys.add(key)
        keyLevels.set(indent, currentKeys)
      }
      // Clear deeper levels when ascending
      for (const level of keyLevels.keys()) {
        if (level > indent) keyLevels.delete(level)
      }
    }
  }

  return diagnostics
}

function validateXml(source) {
  if (!source.trim()) return []
  if (typeof DOMParser === 'undefined') return []

  try {
    const parser = new DOMParser()
    const doc = parser.parseFromString(source, 'application/xml')
    const parserError = doc.querySelector('parsererror')
    if (!parserError) return []

    const text = parserError.textContent || ''
    const lineMatch = text.match(/line\s+(\d+)/i) || text.match(/:(\d+):\s*error/i)
    const colMatch = text.match(/column\s+(\d+)/i) || text.match(/:(\d+):(\d+):/i)

    const line = lineMatch ? parseInt(lineMatch[1], 10) : 1
    const column = colMatch ? parseInt(colMatch[2] || colMatch[1], 10) : 1

    const firstLine = text.split('\n')[0].replace(/Below is a rendering.*/i, '').trim()
    return [{
      line,
      column,
      severity: 'error',
      message: firstLine || 'XML parsing error: mismatched or unclosed tags'
    }]
  } catch (err) {
    return [{ line: 1, column: 1, severity: 'error', message: err.message }]
  }
}

function validateHtml(source) {
  const diagnostics = []
  const voidTags = new Set([
    'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
    'link', 'meta', 'param', 'source', 'track', 'wbr', '!doctype'
  ])

  const tagRegex = /<\/?([A-Za-z0-9_-]+)([^>]*?)(\/?>)/g
  const tagStack = []
  let match

  while ((match = tagRegex.exec(source)) !== null) {
    const isClosing = match[0].startsWith('</')
    const isSelfClosing = match[3] === '/>'
    const tagName = match[1].toLowerCase()
    const offset = match.index
    const line = source.slice(0, offset).split('\n').length

    if (voidTags.has(tagName) || isSelfClosing) continue

    if (isClosing) {
      if (tagStack.length === 0) {
        diagnostics.push({
          line,
          column: 1,
          severity: 'error',
          message: `Unexpected closing tag </${tagName}> without opening tag`
        })
      } else {
        const last = tagStack.pop()
        if (last.tagName !== tagName) {
          diagnostics.push({
            line,
            column: 1,
            severity: 'error',
            message: `Mismatched HTML tag: expected </${last.tagName}> (from line ${last.line}), got </${tagName}>`
          })
        }
      }
    } else {
      tagStack.push({ tagName, line, offset })
    }
  }

  // Report remaining unclosed non-void tags (up to 5)
  for (const unclosed of tagStack.slice(-5)) {
    if (['html', 'body', 'head', 'p', 'li'].includes(unclosed.tagName)) continue
    diagnostics.push({
      line: unclosed.line,
      column: 1,
      severity: 'warning',
      message: `Unclosed <${unclosed.tagName}> tag`
    })
  }

  return diagnostics
}

function validateHandlebars(source) {
  const diagnostics = []
  const blockStack = []
  const regex = /{{(#|\/|\^)([A-Za-z0-9_-]+)/g
  let match

  while ((match = regex.exec(source)) !== null) {
    const prefix = match[1]
    const blockName = match[2]
    const offset = match.index
    const line = source.slice(0, offset).split('\n').length

    if (prefix === '#' || prefix === '^') {
      blockStack.push({ blockName, line })
    } else if (prefix === '/') {
      if (blockStack.length === 0) {
        diagnostics.push({
          line,
          column: 1,
          severity: 'error',
          message: `Unexpected closing block {{/${blockName}}} without opening block`
        })
      } else {
        const last = blockStack.pop()
        if (last.blockName !== blockName) {
          diagnostics.push({
            line,
            column: 1,
            severity: 'error',
            message: `Mismatched Handlebars block: expected {{/${last.blockName}}} from line ${last.line}, got {{/${blockName}}}`
          })
        }
      }
    }
  }

  for (const unclosed of blockStack) {
    diagnostics.push({
      line: unclosed.line,
      column: 1,
      severity: 'error',
      message: `Unclosed Handlebars block {{#${unclosed.blockName}}}`
    })
  }

  return diagnostics
}

function validateCsv(source, delimiter = ',') {
  const diagnostics = []
  const lines = source.split(/\r?\n/).filter((l) => l.trim().length > 0)
  if (lines.length <= 1) return []

  const parseRow = (line) => {
    const parts = []
    let curr = ''
    let inQuotes = false
    for (let i = 0; i < line.length; i++) {
      const c = line[i]
      if (c === '"') {
        inQuotes = !inQuotes
      } else if (c === delimiter && !inQuotes) {
        parts.push(curr)
        curr = ''
        continue
      }
      curr += c
    }
    parts.push(curr)
    return { parts, unclosedQuote: inQuotes }
  }

  const header = parseRow(lines[0])
  const expectedCols = header.parts.length

  for (let i = 0; i < lines.length; i++) {
    const lineNum = i + 1
    const { parts, unclosedQuote } = parseRow(lines[i])

    if (unclosedQuote) {
      diagnostics.push({
        line: lineNum,
        column: 1,
        severity: 'error',
        message: 'Unclosed quotation mark in CSV row'
      })
    } else if (parts.length !== expectedCols) {
      diagnostics.push({
        line: lineNum,
        column: 1,
        severity: 'warning',
        message: `Row column count mismatch: expected ${expectedCols} columns, found ${parts.length}`
      })
    }
  }

  return diagnostics.slice(0, 20)
}

function validateMarkdown(source) {
  const diagnostics = []
  const lines = source.split(/\r?\n/)
  let inCodeFence = false
  let fenceStartLine = 0

  for (let i = 0; i < lines.length; i++) {
    const lineNum = i + 1
    const trimmed = lines[i].trim()

    if (trimmed.startsWith('```') || trimmed.startsWith('~~~')) {
      if (!inCodeFence) {
        inCodeFence = true
        fenceStartLine = lineNum
      } else {
        inCodeFence = false
      }
    }
  }

  if (inCodeFence) {
    diagnostics.push({
      line: fenceStartLine,
      column: 1,
      severity: 'warning',
      message: 'Unclosed code block (missing closing ```)'
    })
  }

  return diagnostics
}

function validateProperties(source) {
  const diagnostics = []
  const lines = source.split(/\r?\n/)
  const seenKeys = new Map()

  for (let i = 0; i < lines.length; i++) {
    const lineNum = i + 1
    const trimmed = lines[i].trim()
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith(';') || trimmed.startsWith('[')) continue

    const match = trimmed.match(/^([^:=]+)[:=](.*)$/)
    if (!match) {
      diagnostics.push({
        line: lineNum,
        column: 1,
        severity: 'warning',
        message: `Malformed property line. Expected 'key = value' or 'key: value'`
      })
    } else {
      const key = match[1].trim()
      if (seenKeys.has(key)) {
        diagnostics.push({
          line: lineNum,
          column: 1,
          severity: 'warning',
          message: `Duplicate property key '${key}' (previously defined at line ${seenKeys.get(key)})`
        })
      } else {
        seenKeys.set(key, lineNum)
      }
    }
  }

  return diagnostics
}

function validatePython(source) {
  const diagnostics = []
  const lines = source.split(/\r?\n/)
  const bracketStack = []

  let inTripleSingle = false
  let inTripleDouble = false

  for (let i = 0; i < lines.length; i++) {
    const lineNum = i + 1
    const rawLine = lines[i]
    const trimmed = rawLine.trim()

    if (trimmed.includes("'''")) inTripleSingle = !inTripleSingle
    if (trimmed.includes('"""')) inTripleDouble = !inTripleDouble
    if (inTripleSingle || inTripleDouble) continue

    if (!trimmed || trimmed.startsWith('#')) continue

    // Check mixed tabs and spaces
    if (rawLine.startsWith('\t') && rawLine.includes('  ')) {
      diagnostics.push({
        line: lineNum,
        column: 1,
        severity: 'warning',
        message: 'Mixed tabs and spaces in indentation'
      })
    }

    // Check colon on compound statements
    const compound = trimmed.match(/^(def|class|if|elif|else|for|while|try|except|finally|with|async\s+def)\b(.*)$/)
    if (compound && !trimmed.endsWith(':') && !trimmed.endsWith('\\') && !trimmed.includes('#')) {
      // Check if bracket is open
      const hasOpenBracket = (trimmed.match(/\(/g) || []).length > (trimmed.match(/\)/g) || []).length
      if (!hasOpenBracket) {
        diagnostics.push({
          line: lineNum,
          column: rawLine.length,
          severity: 'error',
          message: `Missing colon ':' at the end of ${compound[1]} statement`
        })
      }
    }

    // Track brackets
    for (let col = 0; col < rawLine.length; col++) {
      const ch = rawLine[col]
      if (ch === '#' && col > 0 && rawLine[col - 1] === ' ') break
      if ('({['.includes(ch)) {
        bracketStack.push({ ch, line: lineNum, col: col + 1 })
      } else if (')}]'.includes(ch)) {
        const expected = ch === ')' ? '(' : ch === '}' ? '{' : '['
        if (bracketStack.length === 0) {
          diagnostics.push({
            line: lineNum,
            column: col + 1,
            severity: 'error',
            message: `Unexpected closing bracket '${ch}'`
          })
        } else {
          const last = bracketStack.pop()
          if (last.ch !== expected) {
            diagnostics.push({
              line: lineNum,
              column: col + 1,
              severity: 'error',
              message: `Mismatched bracket: expected '${expected === '(' ? ')' : expected === '{' ? '}' : ']'}' to close '${last.ch}' from line ${last.line}, got '${ch}'`
            })
          }
        }
      }
    }
  }

  for (const unclosed of bracketStack.slice(-5)) {
    diagnostics.push({
      line: unclosed.line,
      column: unclosed.col,
      severity: 'error',
      message: `Unclosed bracket '${unclosed.ch}'`
    })
  }

  return diagnostics
}

function validateJavaScript(source) {
  const diagnostics = []
  const lines = source.split(/\r?\n/)
  const bracketStack = []
  let inBlockComment = false

  for (let i = 0; i < lines.length; i++) {
    const lineNum = i + 1
    const rawLine = lines[i]

    let inString = null
    for (let c = 0; c < rawLine.length; c++) {
      const ch = rawLine[c]
      const prev = c > 0 ? rawLine[c - 1] : ''

      if (inBlockComment) {
        if (ch === '/' && prev === '*') inBlockComment = false
        continue
      }
      if (ch === '*' && prev === '/') {
        inBlockComment = true
        continue
      }
      if (ch === '/' && c + 1 < rawLine.length && rawLine[c + 1] === '/') {
        break // Rest of line is single-line comment
      }

      if (inString) {
        if (ch === inString && prev !== '\\') inString = null
        continue
      }
      if ((ch === '"' || ch === "'" || ch === '`') && prev !== '\\') {
        inString = ch
        continue
      }

      if ('({['.includes(ch)) {
        bracketStack.push({ ch, line: lineNum, col: c + 1 })
      } else if (')}]'.includes(ch)) {
        const expected = ch === ')' ? '(' : ch === '}' ? '{' : '['
        if (bracketStack.length === 0) {
          diagnostics.push({
            line: lineNum,
            column: c + 1,
            severity: 'error',
            message: `Unexpected closing '${ch}' without matching opening bracket`
          })
        } else {
          const last = bracketStack.pop()
          if (last.ch !== expected) {
            diagnostics.push({
              line: lineNum,
              column: c + 1,
              severity: 'error',
              message: `Mismatched bracket: expected closing for '${last.ch}' (from line ${last.line}), got '${ch}'`
            })
          }
        }
      }
    }
  }

  for (const unclosed of bracketStack.slice(-5)) {
    diagnostics.push({
      line: unclosed.line,
      column: unclosed.col,
      severity: 'error',
      message: `Unclosed bracket '${unclosed.ch}'`
    })
  }

  return diagnostics
}
