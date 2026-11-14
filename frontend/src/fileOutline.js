// Multi-language structural outline extractor with method-level minimization ranges & rich color semantics
// Supported: .java, .yml, .yaml, .json, .html, .hbs, .xml, .csv, .md, .config, .properties, .env, .py, .js, .ts, .jsx, .tsx

import { javaOutline } from './javaOutline.js'

export { javaOutline }

export function fileOutline(path = '', source = '') {
  if (!path || typeof source !== 'string') return []
  const ext = (path.match(/\.([^.]+)$/)?.[1] || '').toLowerCase()

  if (ext === 'java') {
    return javaOutline(path, source)
  }

  switch (ext) {
    case 'yml':
    case 'yaml':
      return yamlOutline(source)
    case 'json':
      return jsonOutline(source)
    case 'html':
    case 'htm':
      return htmlOutline(source)
    case 'hbs':
    case 'handlebars':
      return handlebarsOutline(source)
    case 'xml':
      return xmlOutline(source)
    case 'csv':
    case 'tsv':
      return csvOutline(source)
    case 'md':
    case 'markdown':
      return markdownOutline(source)
    case 'config':
    case 'properties':
    case 'env':
    case 'ini':
    case 'conf':
      return propertiesOutline(source)
    case 'py':
      return pythonOutline(source)
    case 'js':
    case 'jsx':
    case 'ts':
    case 'tsx':
    case 'mjs':
    case 'cjs':
      return jsTsOutline(source)
    default:
      return []
  }
}

function yamlOutline(source) {
  const items = []
  const lines = source.split(/\r?\n/)
  let currentOffset = 0

  for (let i = 0; i < lines.length; i++) {
    const lineNum = i + 1
    const rawLine = lines[i]
    const trimmed = rawLine.trim()

    if (trimmed && !trimmed.startsWith('#')) {
      const match = rawLine.match(/^(\s*)([A-Za-z0-9_.-]+)\s*:(?:\s*(.*))?$/)
      if (match) {
        const indent = match[1].length
        const key = match[2]
        const val = match[3]?.trim()
        const isParent = !val || val.startsWith('{') || val.startsWith('[')

        // Find endLine by scanning deeper indented child lines
        let endLine = lineNum
        for (let j = i + 1; j < lines.length; j++) {
          const nextTrimmed = lines[j].trim()
          if (!nextTrimmed || nextTrimmed.startsWith('#')) continue
          const nextIndent = lines[j].match(/^(\s*)/)[1].length
          if (nextIndent > indent) {
            endLine = j + 1
          } else {
            break
          }
        }

        const prefix = indent > 0 ? '  '.repeat(Math.min(indent / 2, 4)) : ''
        const color = isParent ? '#c084fc' : '#34d399'
        const badge = isParent ? '{}' : 'K'

        items.push({
          offset: currentOffset + indent,
          line: lineNum,
          startLine: lineNum,
          endLine,
          canFold: endLine > lineNum,
          label: `${prefix}${key}${val && !isParent ? ': ' + val.slice(0, 30) : ''}`,
          name: key,
          detail: val ? (isParent ? (val.startsWith('{') ? '{…}' : '[…]') : val.slice(0, 30)) : '(section)',
          kind: isParent ? 'type' : 'method',
          subKind: isParent ? 'object' : 'property',
          badge,
          color
        })
      }
    }
    currentOffset += rawLine.length + 1
  }

  return items.slice(0, 150)
}

function jsonOutline(source) {
  const items = []
  const regex = /^[ \t]*"([^"\\]+)"\s*:\s*([{\[]|[^\r\n,]+)/gm
  let match

  while ((match = regex.exec(source)) !== null) {
    const key = match[1]
    const valueLead = match[2].trim()
    const isContainer = valueLead === '{' || valueLead === '['
    const offset = match.index
    const startLine = source.slice(0, offset).split('\n').length
    const indent = match[0].match(/^[ \t]*/)[0].length
    const prefix = indent > 0 ? '  '.repeat(Math.min(indent / 2, 4)) : ''

    // Bracket matching for endLine
    let endLine = startLine
    if (isContainer) {
      const openChar = valueLead[0]
      const closeChar = openChar === '{' ? '}' : ']'
      let depth = 1
      let idx = match.index + match[0].length
      let inStr = false
      while (idx < source.length && depth > 0) {
        const char = source[idx]
        if (char === '"' && source[idx - 1] !== '\\') inStr = !inStr
        else if (!inStr) {
          if (char === openChar) depth++
          else if (char === closeChar) {
            depth--
            if (depth === 0) {
              endLine = source.slice(0, idx).split('\n').length
              break
            }
          }
        }
        idx++
      }
    }

    const badge = valueLead === '{' ? '{}' : valueLead === '[' ? '[]' : 'P'
    const color = valueLead === '{' ? '#c084fc' : valueLead === '[' ? '#818cf8' : '#34d399'

    items.push({
      offset,
      line: startLine,
      startLine,
      endLine,
      canFold: endLine > startLine,
      label: `${prefix}${key}${isContainer ? (valueLead === '{' ? ' {…}' : ' […]') : ': ' + valueLead.slice(0, 30)}`,
      name: key,
      detail: isContainer ? (valueLead === '{' ? '{…}' : '[…]') : valueLead.slice(0, 30),
      kind: isContainer ? 'type' : 'method',
      subKind: valueLead === '{' ? 'object' : valueLead === '[' ? 'array' : 'property',
      badge,
      color
    })
  }

  return items.slice(0, 150)
}

function htmlOutline(source) {
  const items = []
  const regex = /<([A-Za-z0-9_-]+)([^>]*?)>/g
  let match

  const noteworthyTags = new Set([
    'head', 'body', 'header', 'nav', 'main', 'section', 'article', 'aside',
    'footer', 'form', 'table', 'template', 'dialog', 'svg', 'script', 'style', 'div'
  ])

  while ((match = regex.exec(source)) !== null) {
    const tagName = match[1].toLowerCase()
    const attrs = match[2]
    const isSelfClosing = attrs.trimEnd().endsWith('/')
    const idMatch = attrs.match(/\bid=["']([^"']+)["']/)
    const classMatch = attrs.match(/\bclass=["']([^"']+)["']/)

    const isMajor = noteworthyTags.has(tagName) || idMatch || Boolean(classMatch)
    if (!isMajor) continue

    const offset = match.index
    const startLine = source.slice(0, offset).split('\n').length
    const descriptor = idMatch ? `#${idMatch[1]}` : classMatch ? `.${classMatch[1].split(' ')[0]}` : ''

    // Calculate closing tag line if not self-closing
    let endLine = startLine
    if (!isSelfClosing && !['meta', 'link', 'input', 'img', 'br', 'hr'].includes(tagName)) {
      const closeTag = `</${tagName}>`
      const closeIdx = source.indexOf(closeTag, offset + match[0].length)
      if (closeIdx !== -1) {
        endLine = source.slice(0, closeIdx + closeTag.length).split('\n').length
      }
    }

    const badge = '<>'
    const color = '#f43f5e'

    items.push({
      offset,
      line: startLine,
      startLine,
      endLine,
      canFold: endLine > startLine,
      label: `<${tagName}${descriptor ? ' ' + descriptor : ''}>`,
      name: `<${tagName}>`,
      detail: descriptor || 'tag',
      kind: noteworthyTags.has(tagName) ? 'type' : 'method',
      subKind: 'tag',
      badge,
      color
    })
  }

  return items.slice(0, 150)
}

function handlebarsOutline(source) {
  const items = []
  const regex = /{{(#|\/|\^|>)?\s*([A-Za-z0-9_.-]+)(?:\s+([^}]+))?}}/g
  let match

  while ((match = regex.exec(source)) !== null) {
    const modifier = match[1] || ''
    const helper = match[2]
    const params = (match[3] || '').trim()
    const offset = match.index
    const startLine = source.slice(0, offset).split('\n').length

    let endLine = startLine
    if (modifier === '#') {
      const closeTag = `{{/${helper}}}`
      const closeIdx = source.indexOf(closeTag, offset + match[0].length)
      if (closeIdx !== -1) {
        endLine = source.slice(0, closeIdx).split('\n').length
      }

      items.push({
        offset,
        line: startLine,
        startLine,
        endLine,
        canFold: endLine > startLine,
        label: `{{#${helper}${params ? ' ' + params.slice(0, 24) : ''}}}`,
        name: `{{#${helper}}}`,
        detail: params.slice(0, 24) || 'block',
        kind: 'type',
        subKind: 'block',
        badge: '{{#}}',
        color: '#fbbf24'
      })
    } else if (modifier === '>') {
      items.push({
        offset,
        line: startLine,
        startLine,
        endLine,
        canFold: false,
        label: `{{> ${helper}}}`,
        name: `{{> ${helper}}}`,
        detail: 'partial',
        kind: 'method',
        subKind: 'partial',
        badge: '{{>}}',
        color: '#60a5fa'
      })
    }
  }

  return items.slice(0, 150)
}

function xmlOutline(source) {
  const items = []
  const regex = /<([A-Za-z0-9_.:-]+)([^>]*?)>/g
  let match

  while ((match = regex.exec(source)) !== null) {
    if (match[0].startsWith('<?') || match[0].startsWith('<!') || match[0].startsWith('</')) continue
    const tag = match[1]
    const attrs = match[2]
    const isSelfClosing = attrs.trimEnd().endsWith('/')
    const idMatch = attrs.match(/\b(?:id|name|artifactId)=["']([^"']+)["']/)
    const offset = match.index
    const startLine = source.slice(0, offset).split('\n').length

    let endLine = startLine
    if (!isSelfClosing) {
      const closeTag = `</${tag}>`
      const closeIdx = source.indexOf(closeTag, offset + match[0].length)
      if (closeIdx !== -1) {
        endLine = source.slice(0, closeIdx + closeTag.length).split('\n').length
      }
    }

    const isMajor = ['project', 'dependency', 'plugin', 'bean', 'configuration', 'target', 'service'].includes(tag.toLowerCase())
    const badge = isMajor ? '<>' : '</>'
    const color = isMajor ? '#fb7185' : '#f43f5e'

    items.push({
      offset,
      line: startLine,
      startLine,
      endLine,
      canFold: endLine > startLine,
      label: `<${tag}${idMatch ? ` id="${idMatch[1]}"` : ''}>`,
      name: `<${tag}>`,
      detail: idMatch ? idMatch[1] : isMajor ? 'section' : 'element',
      kind: isMajor ? 'type' : 'method',
      subKind: isMajor ? 'section' : 'tag',
      badge,
      color
    })
  }

  return items.slice(0, 150)
}

function csvOutline(source) {
  const lines = source.split(/\r?\n/).filter((l) => l.trim().length > 0)
  if (!lines.length) return []

  const delimiter = source.includes('\t') ? '\t' : source.includes(';') ? ';' : ','
  const headerParts = lines[0].split(delimiter).map((p) => p.replace(/^"|"$/g, '').trim())

  const items = [
    {
      offset: 0,
      line: 1,
      startLine: 1,
      endLine: lines.length,
      canFold: lines.length > 2,
      label: `CSV (${headerParts.length} cols, ${lines.length - 1} rows)`,
      name: `Table Header`,
      detail: `${headerParts.length} cols, ${lines.length - 1} rows`,
      kind: 'type',
      subKind: 'table',
      badge: 'CSV',
      color: '#6366f1'
    }
  ]

  let offset = 0
  for (let i = 0; i < Math.min(headerParts.length, 60); i++) {
    items.push({
      offset,
      line: 1,
      startLine: 1,
      endLine: lines.length,
      canFold: false,
      label: `Col ${i + 1}: ${headerParts[i] || 'Untitled'}`,
      name: headerParts[i] || `Col ${i + 1}`,
      detail: `Column ${i + 1}`,
      kind: 'method',
      subKind: 'column',
      badge: `${i + 1}`,
      color: '#38bdf8'
    })
  }

  return items
}

function markdownOutline(source) {
  const items = []
  const lines = source.split(/\r?\n/)
  const regex = /^(#{1,6})\s+(.+)$/

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i]
    const match = rawLine.match(regex)
    if (match) {
      const hashes = match[1]
      const title = match[2].trim()
      const level = hashes.length
      const startLine = i + 1

      // Heading block spans until next heading of equal or higher level (<= level)
      let endLine = lines.length
      for (let j = i + 1; j < lines.length; j++) {
        const nextMatch = lines[j].match(regex)
        if (nextMatch && nextMatch[1].length <= level) {
          endLine = j
          break
        }
      }

      const colors = ['#818cf8', '#38bdf8', '#34d399', '#f59e0b', '#fb923c', '#94a3b8']
      const color = colors[level - 1] || '#94a3b8'

      items.push({
        offset: source.slice(0, lines.slice(0, i).join('\n').length + 1).length,
        line: startLine,
        startLine,
        endLine,
        canFold: endLine > startLine,
        label: `H${level}: ${title.slice(0, 40)}`,
        name: title,
        detail: `H${level}`,
        kind: level <= 2 ? 'type' : 'method',
        subKind: 'heading',
        badge: `H${level}`,
        color
      })
    }
  }

  return items.slice(0, 150)
}

function propertiesOutline(source) {
  const items = []
  const lines = source.split(/\r?\n/)
  let currentOffset = 0

  for (let i = 0; i < lines.length; i++) {
    const lineNum = i + 1
    const rawLine = lines[i]
    const trimmed = rawLine.trim()

    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
      let endLine = lines.length
      for (let j = i + 1; j < lines.length; j++) {
        if (lines[j].trim().startsWith('[')) {
          endLine = j
          break
        }
      }

      items.push({
        offset: currentOffset,
        line: lineNum,
        startLine: lineNum,
        endLine,
        canFold: endLine > lineNum,
        label: trimmed,
        name: trimmed,
        detail: 'section',
        kind: 'type',
        subKind: 'section',
        badge: 'CFG',
        color: '#f59e0b'
      })
    } else if (trimmed && !trimmed.startsWith('#') && !trimmed.startsWith(';')) {
      const match = trimmed.match(/^([^:=]+)[:=](.*)$/)
      if (match) {
        items.push({
          offset: currentOffset,
          line: lineNum,
          startLine: lineNum,
          endLine: lineNum,
          canFold: false,
          label: `${match[1].trim()}`,
          name: match[1].trim(),
          detail: match[2]?.trim().slice(0, 25) || '',
          kind: 'method',
          subKind: 'property',
          badge: 'K',
          color: '#34d399'
        })
      }
    }
    currentOffset += rawLine.length + 1
  }

  return items.slice(0, 150)
}

function pythonOutline(source) {
  const items = []
  const lines = source.split(/\r?\n/)
  const regex = /^[ \t]*(class|def|async\s+def)\s+([A-Za-z0-9_]+)\s*(?:\(([^)]*)\))?/

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i]
    const match = rawLine.match(regex)
    if (match) {
      const keyword = match[1]
      const name = match[2]
      const params = match[3] ? `(${match[3].trim().slice(0, 20)})` : '()'
      const startLine = i + 1
      const isClass = keyword === 'class'
      const indent = rawLine.match(/^(\s*)/)[1].length

      // Python block ends when indentation drops <= indent on a non-empty, non-comment line
      let endLine = lines.length
      for (let j = i + 1; j < lines.length; j++) {
        const nextTrimmed = lines[j].trim()
        if (!nextTrimmed || nextTrimmed.startsWith('#')) continue
        const nextIndent = lines[j].match(/^(\s*)/)[1].length
        if (nextIndent <= indent) {
          endLine = j
          break
        }
      }

      const badge = isClass ? 'C' : 'F'
      const color = isClass ? '#f59e0b' : '#38bdf8'

      items.push({
        offset: source.slice(0, lines.slice(0, i).join('\n').length + 1).length,
        line: startLine,
        startLine,
        endLine,
        canFold: endLine > startLine,
        label: isClass ? `class ${name}` : `def ${name}${params}`,
        name,
        detail: isClass ? 'class' : params,
        kind: isClass ? 'type' : 'method',
        subKind: isClass ? 'class' : 'function',
        badge,
        color,
        runnable: !isClass && name === 'main'
      })
    }
  }

  return items.slice(0, 150)
}

function jsTsOutline(source) {
  const items = []
  const regex = /^[ \t]*(?:export\s+(?:default\s+)?)?(?:async\s+)?(?:function\*?\s+([A-Za-z0-9_$]+)|class\s+([A-Za-z0-9_$]+)|interface\s+([A-Za-z0-9_$]+)|type\s+([A-Za-z0-9_$]+)|enum\s+([A-Za-z0-9_$]+)|(?:const|let|var)\s+([A-Za-z0-9_$]+)\s*=\s*(?:(?:async\s+)?(?:\([^)]*\)|[A-Za-z0-9_$]+)\s*=>|function))/gm
  let match

  while ((match = regex.exec(source)) !== null) {
    const fnName = match[1]
    const className = match[2]
    const ifaceName = match[3]
    const typeName = match[4]
    const enumName = match[5]
    const arrowName = match[6]

    const name = className || fnName || arrowName || ifaceName || typeName || enumName
    if (!name) continue

    const offset = match.index
    const startLine = source.slice(0, offset).split('\n').length
    const isType = Boolean(className || ifaceName || typeName || enumName)

    // Brace matching to find endLine
    let endLine = startLine
    const bodyStart = source.indexOf('{', offset + match[0].length - 1)
    if (bodyStart !== -1 && bodyStart - (offset + match[0].length) < 80) {
      let depth = 1
      let idx = bodyStart + 1
      let inStr = false
      let strChar = ''
      while (idx < source.length && depth > 0) {
        const char = source[idx]
        if (!inStr && (char === '"' || char === "'" || char === '`')) {
          inStr = true
          strChar = char
        } else if (inStr && char === strChar && source[idx - 1] !== '\\') {
          inStr = false
        } else if (!inStr) {
          if (char === '{') depth++
          else if (char === '}') {
            depth--
            if (depth === 0) {
              endLine = source.slice(0, idx).split('\n').length
              break
            }
          }
        }
        idx++
      }
    }

    const subKind = className ? 'class'
      : ifaceName ? 'interface'
      : typeName ? 'type'
      : enumName ? 'enum'
      : 'function'
    const badge = className ? 'C'
      : ifaceName ? 'I'
      : typeName ? 'T'
      : enumName ? 'E'
      : 'F'
    const color = className ? '#f59e0b'
      : ifaceName ? '#a855f7'
      : typeName ? '#c084fc'
      : enumName ? '#d97706'
      : '#38bdf8'

    items.push({
      offset,
      line: startLine,
      startLine,
      endLine,
      canFold: endLine > startLine,
      label: className ? `class ${className}`
        : ifaceName ? `interface ${ifaceName}`
        : typeName ? `type ${typeName}`
        : enumName ? `enum ${enumName}`
        : `${name}()`,
      name,
      detail: isType ? subKind : '()',
      kind: isType ? 'type' : 'method',
      subKind,
      badge,
      color
    })
  }

  return items.slice(0, 150)
}
