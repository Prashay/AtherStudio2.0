import { debuggerValues } from './debuggerValues.js'
import React, { useEffect, useLayoutEffect, useMemo, useRef, useState, useCallback } from 'react'
import PopIcon from './PopupIcons.jsx'
import { javaHighlight, codeHighlight } from './javaHighlight.js'
import { getJavaHint } from './javaHints.js'
import { javaSnippet } from './javaSnippets.js'
import { javaClassNameFix } from './javaClassNameFix.js'
import { javaVariableActions, makeJavaTypePackagePrivate, javaMethodActions, inferVariableType, getDefaultValueForType } from './javaQuickFixes.js'
import { javaDiagnosticTarget, javaParameterSuggestion, javaReferenceChange } from './javaDiagnosticTarget.js'
import { validateSyntax, formatJsonSource, formatYamlSource } from './syntaxValidation.js'
import { insertJavaImport, javaImportSuggestions, maskJavaNonCode } from './javaImports.js'

export default function CodeEditor({
  path,
  value,
  onChange,
  fontSize,
  wordWrap,
  jump,
  onNavigate,
  applications = [],
  mainLine,
  onRunMain,
  onDebugMain,
  workspace,
  breakpointLines = [],
  debugLocation,
  onToggleBreakpoint,
  className = '',
  outline = [],
  externalFoldedLines,
  onExternalToggleFold,
  onValidationChange
}) {
  const frame = useRef(null)
  const hintTimer = useRef(null)
  const pointerToken = useRef(null)
  const [hintTarget, setHintTarget] = useState(null)
  const [referenceDraft, setReferenceDraft] = useState(null)
  const [declarationDraft, setDeclarationDraft] = useState(null)
  const [showClassActions, setShowClassActions] = useState(false)
  const gutter = useRef(null)
  const diagnosticsGutter = useRef(null)
  const editor = useRef(null)
  const highlight = useRef(null)
  const searchInputRef = useRef(null)

  const [runMenu, setRunMenu] = useState(null)
  const [validation, setValidation] = useState(null)
  const [importLine, setImportLine] = useState(null)
  const [importAnchor, setImportAnchor] = useState(null)
  const [braceCaret, setBraceCaret] = useState(null)
  const [activeCaretLine, setActiveCaretLine] = useState(1)
  const [hoveredSymbol, setHoveredSymbol] = useState(null)
  const [isShiftDown, setIsShiftDown] = useState(false)
  const [isModifierDown, setIsModifierDown] = useState(false)
  const lastMouseCoords = useRef({ x: 0, y: 0 })
  const [formatStatus, setFormatStatus] = useState(null)
  const [navHighlightLine, setNavHighlightLine] = useState(null)

  useEffect(() => {
    setHintTarget(null)
    setReferenceDraft(null)
    setDeclarationDraft(null)
    setShowClassActions(false)
    pointerToken.current = null
    return () => clearTimeout(hintTimer.current)
  }, [path, value])

  // Local method folding state
  const [localFolds, setLocalFolds] = useState(new Set())
  const activeFolds = externalFoldedLines || localFolds

  const toggleFold = useCallback((startLine) => {
    if (onExternalToggleFold) {
      onExternalToggleFold(startLine)
    } else {
      setLocalFolds((prev) => {
        const next = new Set(prev)
        if (next.has(startLine)) next.delete(startLine)
        else next.add(startLine)
        return next
      })
    }
  }, [onExternalToggleFold])

  // In-file search state
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchMatchIndex, setSearchMatchIndex] = useState(0)
  const [searchCase, setSearchCase] = useState(false)

  const isJava = /\.java$/i.test(path)
  const ext = (path.match(/\.([^.]+)$/)?.[1] || '').toLowerCase()
  const isJson = ext === 'json'
  const isYaml = ext === 'yml' || ext === 'yaml'
  const isFormattable = isJava || isJson || isYaml
  const validatableExtensions = new Set([
    'json', 'yml', 'yaml', 'xml', 'html', 'htm', 'hbs', 'handlebars',
    'csv', 'tsv', 'md', 'markdown', 'config', 'properties', 'env',
    'ini', 'conf', 'py', 'js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs'
  ])
  const isValidatable = isJava || validatableExtensions.has(ext)

  const javaBraces = useMemo(() => {
    const pairs = new Map()
    const blocks = []
    if (!isJava) return { pairs, blocks }
    const opening = { '{': [], '(': [] }
    const closing = { '}': '{', ')': '(' }
    let line = 1
    const code = maskJavaNonCode(value)
    for (let offset = 0; offset < code.length; offset++) {
      if (code[offset] === '\n') line++
      else if (opening[code[offset]]) opening[code[offset]].push({ offset, line })
      else if (opening[closing[code[offset]]]?.length) {
        const open = opening[closing[code[offset]]].pop()
        const close = { offset, line }
        pairs.set(open.offset, close)
        pairs.set(close.offset, open)
        if (open.line < line) {
          blocks.push({ startLine: open.line, endLine: line, openOffset: open.offset, closeOffset: offset,
            name: code[offset] === '}' ? 'block' : 'parentheses' })
        }
      }
    }
    return { pairs, blocks }
  }, [isJava, value])

  // Outline fold mapping
  const foldMap = useMemo(() => {
    const map = new Map()
    for (const item of outline || []) {
      if (item.canFold && item.endLine > item.startLine) {
        if (!map.has(item.startLine) || item.kind === 'method' || item.subKind === 'function') {
          map.set(item.startLine, item)
        }
      }
    }
    for (const block of javaBraces.blocks) {
      const item = map.get(block.startLine)
      if (!item || item.name === 'parentheses' || item.endLine === block.endLine && block.name !== 'parentheses') {
        map.set(block.startLine, { ...block, name: item?.name !== 'parentheses' && item?.name || block.name })
      }
    }
    return map
  }, [outline, javaBraces])

  // Compute visible lines and displayed content with method-level minimization
  const rawLines = useMemo(() => value.split('\n'), [value])

  const { visibleLines, displayedValue } = useMemo(() => {
    if (!activeFolds || activeFolds.size === 0) {
      const lines = rawLines.map((text, i) => ({
        realLine: i + 1,
        isFoldHeader: foldMap.has(i + 1),
        isFolded: false,
        foldInfo: foldMap.get(i + 1),
        text
      }))
      return { visibleLines: lines, displayedValue: value }
    }

    const hidden = new Set()
    for (const startLine of activeFolds) {
      const info = foldMap.get(startLine)
      if (info) {
        for (let l = info.startLine + 1; l <= info.endLine; l++) {
          hidden.add(l)
        }
      }
    }

    const visible = []
    const textPieces = []

    for (let i = 0; i < rawLines.length; i++) {
      const lineNum = i + 1
      if (hidden.has(lineNum)) continue

      const isFolded = activeFolds.has(lineNum)
      const foldInfo = foldMap.get(lineNum)
      let lineText = rawLines[i]

      if (isFolded && foldInfo) {
        const collapsedCount = foldInfo.endLine - foldInfo.startLine
        const summary = isJava ? '…' : ` /* ▾ ${collapsedCount} lines collapsed (${foldInfo.name || 'method'}) ▾ */`
        if (Number.isInteger(foldInfo.openOffset)) {
          const lineStart = value.lastIndexOf('\n', foldInfo.openOffset) + 1
          const tailEnd = value.indexOf('\n', foldInfo.closeOffset)
          lineText = lineText.slice(0, foldInfo.openOffset - lineStart + 1) +
            summary + value.slice(foldInfo.closeOffset, tailEnd < 0 ? undefined : tailEnd)
        } else if (lineText.includes('{')) {
          const bIdx = lineText.indexOf('{')
          lineText = lineText.slice(0, bIdx + 1) + summary + ' }'
        } else if (lineText.includes(':')) {
          const cIdx = lineText.indexOf(':')
          lineText = lineText.slice(0, cIdx + 1) + summary
        } else {
          lineText = lineText + summary
        }
      }

      visible.push({
        realLine: lineNum,
        isFoldHeader: Boolean(foldInfo),
        isFolded,
        foldInfo,
        text: lineText
      })
      textPieces.push(lineText)
    }

    return {
      visibleLines: visible,
      displayedValue: textPieces.join('\n')
    }
  }, [rawLines, value, activeFolds, foldMap, isJava])

  const highlighted = useMemo(() => codeHighlight(path, displayedValue.replace(/\r\n?/g, '\n')), [path, displayedValue])
  const result = validation?.path === path && validation.source === value ? validation : null
  const diagnostics = result?.diagnostics || []
  const problemCount = diagnostics.length
  const hasErrors = diagnostics.some(({ severity }) => severity === 'error')
  const diagnosticStatus = !result ? 'pending'
    : hasErrors ? 'error'
    : result.error || problemCount > 0 ? 'warning'
    : 'success'
  const diagnosticLabel = !result ? `Checking ${ext.toUpperCase() || 'syntax'}`
    : result.error ? 'Validation unavailable'
    : problemCount ? `${problemCount} ${isJava ? 'compiler' : 'syntax'} ${problemCount === 1 ? 'diagnostic' : 'diagnostics'}`
    : `No ${isJava ? 'compiler' : 'syntax'} errors`

  const byLine = new Map()
  for (const item of diagnostics) {
    if (typeof item.line === 'number' && item.line > 0) {
      if (!byLine.has(item.line)) byLine.set(item.line, [])
      byLine.get(item.line).push(item)
    }
  }
  const breakpoints = new Set(breakpointLines)

  useEffect(() => {
    if (onValidationChange && result) {
      onValidationChange(path, hasErrors)
    }
  }, [path, result, hasErrors, onValidationChange])

  // Validation hook (Java backend compiler or multi-language client validator)
  useEffect(() => {
    if (!isValidatable) {
      setValidation(null)
      return
    }

    if (isJava) {
      const controller = new AbortController()
      const timer = setTimeout(async () => {
        try {
          const response = await fetch('/api/java/validate', {
            method: 'POST',
            signal: controller.signal,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ file: path, source: value, workspace })
          })
          const data = await response.json()
          if (!response.ok) throw new Error(data.error || 'Java validation is unavailable.')
          if (!controller.signal.aborted) setValidation({ path, source: value, workspace, diagnostics: data.diagnostics })
        } catch (error) {
          if (!controller.signal.aborted) {
            setValidation({
              path,
              source: value,
              workspace,
              error: error instanceof SyntaxError ? 'Java validation is unavailable.' : error.message
            })
          }
        }
      }, 700)
      return () => { clearTimeout(timer); controller.abort() }
    } else {
      const timer = setTimeout(() => {
        try {
          const localDiagnostics = validateSyntax(path, value)
          setValidation({ path, source: value, diagnostics: localDiagnostics })
        } catch {
          setValidation({ path, source: value, diagnostics: [] })
        }
      }, 350)
      return () => clearTimeout(timer)
    }
  }, [isValidatable, isJava, path, value, workspace])

  const syncScroll = (field) => {
    if (gutter.current) gutter.current.scrollTop = field.scrollTop
    if (diagnosticsGutter.current) diagnosticsGutter.current.scrollTop = field.scrollTop
    if (highlight.current) {
      highlight.current.style.right = `${field.offsetWidth - field.clientWidth}px`
      highlight.current.style.bottom = `${field.offsetHeight - field.clientHeight}px`
      highlight.current.scrollTop = field.scrollTop
      highlight.current.scrollLeft = field.scrollLeft
    }
  }

  const debugLine = debugLocation?.line
  const debugCondition = debugLine ? debuggerValues(debugLocation.variables, rawLines[debugLine - 1]).condition : undefined
  useEffect(() => {
    if (!debugLine || !editor.current || !highlight.current) return
    const row = highlight.current.querySelector('[data-source-line="' + debugLine + '"]')
    if (!row) return
    const field = editor.current
    const viewport = field.getBoundingClientRect()
    const top = row.getBoundingClientRect().top
    if (top < viewport.top + 12 || top > viewport.bottom - 30) {
      field.scrollTop += top - viewport.top - field.clientHeight / 3
      syncScroll(field)
    }
  }, [debugLine, visibleLines])

  // Jump to offset
  const jumpToOffset = useCallback((offset, len = 0) => {
    if (!editor.current) return
    const field = editor.current
    const line = field.value.slice(0, offset).split('\n').length
    field.focus()
    field.setSelectionRange(offset, offset + len)
    const lineHeight = parseFloat(getComputedStyle(field).lineHeight) || 20
    field.scrollTop = Math.max(0, (line - 3) * lineHeight)
    syncScroll(field)

    // Smooth line flash highlight like IntelliJ / Eclipse
    setNavHighlightLine(line)
    setTimeout(() => {
      setNavHighlightLine((cur) => (cur === line ? null : cur))
    }, 1200)
  }, [])

  // Navigate to symbol definition (intra-file or cross-file)
  const pushNavHistory = useCallback((targetOffset, targetLen = 0, targetPath = path, targetSymbol = null) => {
    if (targetPath && targetPath !== path && onNavigate) {
      onNavigate(targetPath, targetSymbol, targetOffset)
    } else {
      jumpToOffset(targetOffset, targetLen)
    }
  }, [path, onNavigate, jumpToOffset])

  // Helper to extract identifier token at offset
  const getWordAtOffset = useCallback((text, offset) => {
    if (!text || offset < 0 || offset > text.length) return null
    const isWordChar = (c) => /[a-zA-Z0-9_$]/.test(c)
    let start = offset
    let end = offset

    if (start < text.length && !isWordChar(text[start]) && start > 0 && isWordChar(text[start - 1])) {
      start--
      end--
    }
    if (!isWordChar(text[start])) return null

    while (start > 0 && isWordChar(text[start - 1])) start--
    while (end < text.length && isWordChar(text[end])) end++

    const word = text.slice(start, end)
    return word ? { word, start, end } : null
  }, [])

  // Get symbol info from client coordinates directly and reliably without pointer-events issues
  const getSymbolAtCoords = useCallback((clientX, clientY) => {
    if (!editor.current || !value) return null

    // Method 1: Inspect highlight DOM lines directly
    if (highlight.current) {
      const rows = highlight.current.querySelectorAll('.java-source-line')
      if (rows && rows.length > 0) {
        let targetRow = null
        for (let i = 0; i < rows.length; i++) {
          const rect = rows[i].getBoundingClientRect()
          if (clientY >= rect.top - 2 && clientY <= rect.bottom + 2) {
            targetRow = rows[i]
            break
          }
        }

        if (targetRow) {
          const line = Number(targetRow.dataset.sourceLine)
          if (line && line >= 1) {
            const lineText = rawLines[line - 1] || ''
            const lineStartOffset = rawLines.slice(0, line - 1).reduce((sum, r) => sum + r.length + 1, 0)

            // Look for matching token span inside targetRow
            const spans = targetRow.querySelectorAll('span')
            let matchedSpan = null
            for (let j = 0; j < spans.length; j++) {
              const sRect = spans[j].getBoundingClientRect()
              if (clientX >= sRect.left - 2 && clientX <= sRect.right + 2) {
                matchedSpan = spans[j]
                break
              }
            }

            if (matchedSpan && /[\w$]+/.test(matchedSpan.textContent)) {
              const word = (matchedSpan.dataset.token || matchedSpan.textContent).trim()
              const col = matchedSpan.dataset.col !== undefined ? Number(matchedSpan.dataset.col) : -1
              if (col >= 0) {
                return {
                  word,
                  offset: lineStartOffset + col,
                  line,
                  column: col + 1
                }
              }
              const tokens = [...lineText.matchAll(/[\w$]+/g)]
              const token = tokens.find((t) => t[0] === word)
              if (token) {
                return {
                  word: token[0],
                  offset: lineStartOffset + token.index,
                  line,
                  column: token.index + 1
                }
              }
            }

            // Fallback within row if span not directly hit
            const rowRect = targetRow.getBoundingClientRect()
            const sampleWidth = 8.4
            const approxCol = Math.max(0, Math.floor((clientX - rowRect.left) / sampleWidth))
            const tokens = [...lineText.matchAll(/[\w$]+/g)]
            const token = tokens.find((item) => approxCol >= item.index - 1 && approxCol <= item.index + item[0].length + 1)
            if (token) {
              return {
                word: token[0],
                offset: lineStartOffset + token.index,
                line,
                column: token.index + 1
              }
            }
          }
        }
      }
    }

    // Method 2: Fallback using line-height and char estimation on textarea
    const edRect = editor.current.getBoundingClientRect()
    if (clientX >= edRect.left && clientX <= edRect.right && clientY >= edRect.top && clientY <= edRect.bottom) {
      const computed = window.getComputedStyle(editor.current)
      const paddingTop = parseFloat(computed.paddingTop) || 0
      const paddingLeft = parseFloat(computed.paddingLeft) || 0
      const lineHeight = parseFloat(computed.lineHeight) || 21
      const charWidth = 8.4
      const relY = clientY - edRect.top + editor.current.scrollTop - paddingTop
      const lineIdx = Math.max(0, Math.min(rawLines.length - 1, Math.floor(relY / lineHeight)))
      const line = lineIdx + 1
      const lineText = rawLines[lineIdx] || ''
      const lineStartOffset = rawLines.slice(0, lineIdx).reduce((sum, r) => sum + r.length + 1, 0)
      const relX = clientX - edRect.left + editor.current.scrollLeft - paddingLeft
      const approxCol = Math.max(0, Math.floor(relX / charWidth))
      const tokens = [...lineText.matchAll(/[\w$]+/g)]
      const token = tokens.find((item) => approxCol >= item.index - 1 && approxCol <= item.index + item[0].length + 1)
      if (token) {
        return {
          word: token[0],
          offset: lineStartOffset + token.index,
          line,
          column: token.index + 1
        }
      }
    }

    return null
  }, [value, rawLines])

  // Precision symbol analyzer: distinguishes definitions from usages, resolves receiver types and classes
  const analyzeSymbol = useCallback((text, word, clickOffset = 0) => {
    if (!word || !text) return { defs: [], usages: [], isAtDefinition: false, primaryDef: null, receiverClass: null, isClass: false }
    const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const escaped = escapeRegex(word)

    // Java keywords that should never be navigated
    const JAVA_KEYWORDS = new Set([
      'abstract', 'assert', 'boolean', 'break', 'byte', 'case', 'catch', 'char', 'class',
      'const', 'continue', 'default', 'do', 'double', 'else', 'enum', 'extends', 'final',
      'finally', 'float', 'for', 'goto', 'if', 'implements', 'import', 'instanceof', 'int',
      'interface', 'long', 'native', 'new', 'package', 'private', 'protected', 'public',
      'return', 'short', 'static', 'strictfp', 'super', 'switch', 'synchronized', 'this',
      'throw', 'throws', 'transient', 'try', 'void', 'volatile', 'while', 'record', 'yield',
      'var', 'sealed', 'permits', 'non-sealed'
    ])
    if (JAVA_KEYWORDS.has(word)) {
      return { defs: [], usages: [], isAtDefinition: false, primaryDef: null, receiverClass: null, isClass: false }
    }

    // 1. Check method/class declarations in code via AST/regex
    // Recognizes annotations (@Override, @GetMapping...), generics (<T>, ResponseEntity<ProductResponse>), arrays
    const declRegex = /(?:@[\w$]+(?:\([^)]*\))?\s+)*(?:(?:public|protected|private|static|final|abstract|synchronized|default|native|strictfp|sealed)\s+)*(?:(class|interface|enum|record)\s+([\w$]+)|(?:<[\w$,\s?]+>\s+)?([\w$.<>?,[\] ]+?)\s+([\w$]+)\s*\(([^;{}()]*)\)\s*(?:throws\s+[^;{}]+)?(?:\{|;))/g
    const defs = []
    let m
    while ((m = declRegex.exec(text)) !== null) {
      const name = m[2] || m[4]
      if (name === word) {
        const fullMatch = m[0]
        const wordIdx = fullMatch.indexOf(name)
        const offset = m.index + (wordIdx >= 0 ? wordIdx : 0)
        defs.push({
          name,
          offset,
          line: text.slice(0, offset).split('\n').length,
          signature: fullMatch.replace(/\{.*$/, '').trim(),
          kind: m[2] ? m[1] : 'method'
        })
      }
    }

    // 2. Cross-reference outline items
    for (const item of outline) {
      if ((item.name === word || item.method === word) && !defs.some((d) => Math.abs(d.offset - item.offset) < 50)) {
        const snippet = text.slice(Math.max(0, item.offset - 40), item.offset + 120)
        const tokenIdx = snippet.indexOf(word)
        const offset = tokenIdx >= 0 ? Math.max(0, item.offset - 40) + tokenIdx : item.offset
        defs.push({
          name: word,
          offset,
          line: item.line || item.startLine,
          signature: item.label || item.detail || word,
          kind: item.kind || 'method'
        })
      }
    }

    // 3. Check variable / field / parameter declarations
    const varDeclRegex = /(?:(?:public|protected|private|static|final)\s+)?(?:[\w$.<>\[\]]+)\s+([\w$]+)\s*(?:=|;|,|\)|:)/g
    let vm
    while ((vm = varDeclRegex.exec(text)) !== null) {
      const varName = vm[1]
      if (varName === word) {
        const wordIdx = vm[0].indexOf(varName)
        const offset = vm.index + (wordIdx >= 0 ? wordIdx : 0)
        if (!defs.some((d) => Math.abs(d.offset - offset) < 5)) {
          defs.push({
            name: varName,
            offset,
            line: text.slice(0, offset).split('\n').length,
            signature: vm[0].replace(/[;=,].*$/, '').trim(),
            kind: 'variable'
          })
        }
      }
    }

    // 4. Find all occurrences in text
    const occRegex = new RegExp('\\b' + escaped + '\\b', 'g')
    const allOccs = []
    let occ
    while ((occ = occRegex.exec(text)) !== null) {
      allOccs.push({
        offset: occ.index,
        line: text.slice(0, occ.index).split('\n').length
      })
    }

    // Usages are occurrences that are not definitions
    const isDefOffset = (pos) => defs.some((d) => Math.abs(d.offset - pos) <= word.length)
    const usages = allOccs.filter((o) => !isDefOffset(o.offset))

    // Is the clicked offset at the definition token itself?
    const matchedDef = defs.find((d) => Math.abs(d.offset - clickOffset) <= word.length)
    const isAtDefinition = Boolean(matchedDef)

    // Select the best primary definition
    let primaryDef = matchedDef
    if (!primaryDef && defs.length > 0) {
      const preceding = defs.filter((d) => d.offset <= clickOffset)
      primaryDef = preceding.length > 0 ? preceding[preceding.length - 1] : defs[0]
    }

    // 5. If no local definition found, check if word is invoked on an object / receiver:
    // e.g. productHandler.createProduct(...) -> receiver is productHandler
    let receiverClass = null
    const safeOffset = clickOffset > 0 ? clickOffset : (allOccs[0]?.offset ?? 0)
    const prefixText = text.slice(Math.max(0, safeOffset - 120), safeOffset)
    const receiverMatch = /([\w$]+)\s*\.\s*$/.exec(prefixText)
    if (receiverMatch) {
      const receiverVar = receiverMatch[1]
      if (/^[A-Z]/.test(receiverVar)) {
        receiverClass = receiverVar
      } else {
        const varTypeRegex = new RegExp(
          `(?:(?:private|protected|public|static|final)\\s+)*([A-Z][\\w$]*)(?:<[^>]+>)?\\s+${receiverVar}\\b`
        )
        const varTypeMatch = varTypeRegex.exec(text)
        if (varTypeMatch) {
          receiverClass = varTypeMatch[1]
        }
      }
    }

    const isClass = /^[A-Z][\w$]*$/.test(word)

    return {
      defs,
      usages,
      isAtDefinition,
      primaryDef,
      receiverClass,
      isClass
    }
  }, [outline])

  // Go to Definition or Usage on Shift+Click, Ctrl+Click, or F12 / Ctrl+B
  const jumpToDefinitionOrUsage = useCallback((word, clickOffset) => {
    if (!word || !editor.current) return false
    const text = value
    const len = word.length
    const { defs, usages, isAtDefinition, primaryDef, receiverClass, isClass } = analyzeSymbol(text, word, clickOffset)

    if (isAtDefinition) {
      // User is already at the definition -> cycle through its usages!
      if (usages.length > 0) {
        const next = usages.find((u) => u.offset > clickOffset + 10) ?? usages[0]
        pushNavHistory(next.offset, len)
        return true
      }
      return false
    }

    if (primaryDef) {
      // User is at a method call, variable use, or local class -> jump to its definition!
      pushNavHistory(primaryDef.offset, len)
      return true
    }

    // Cross-file navigation:
    // If it's a method call on a resolved receiver object:
    // e.g. productHandler.createProduct(...) -> receiverClass = 'ProductHandler', method = 'createProduct'
    if (receiverClass && onNavigate) {
      pushNavHistory(0, len, receiverClass + '.java', word)
      return true
    }

    // If it's a class name: e.g. ProductHandler, ProductResponse
    if (isClass && onNavigate) {
      pushNavHistory(0, len, word + '.java', word)
      return true
    }

    // Cross-file method or symbol search:
    if (onNavigate) {
      pushNavHistory(0, len, null, word)
      return true
    }

    return false
  }, [value, pushNavHistory, onNavigate, analyzeSymbol])

  // Find definition info and usages for Shift/hover tooltip
  const findSymbolInfo = useCallback((word, clickOffset) => {
    if (!word || !value) return null
    const { defs, usages, isAtDefinition, primaryDef, receiverClass, isClass } = analyzeSymbol(value, word, clickOffset)
    if (!primaryDef && !receiverClass && !isClass && usages.length === 0) return null

    const fileName = path ? path.split(/[/\\]/).pop() : 'current file'
    const projectName = workspace ? workspace.split(/[/\\]/).pop() : fileName.replace(/\.java$/, '')

    // Extract package and class for IntelliJ header
    const pkgMatch = /^\s*package\s+([\w.]+)\s*;/m.exec(value)
    const pkg = pkgMatch ? pkgMatch[1] : ''
    const clsMatch = /^\s*(?:public\s+|protected\s+|private\s+|abstract\s+|final\s+)*class\s+([\w$]+)/m.exec(value)
    const cls = clsMatch ? clsMatch[1] : fileName.replace(/\.java$/, '')
    const qualifiedClass = pkg ? `${pkg}.${cls}` : cls

    if (primaryDef) {
      return {
        word,
        kind: primaryDef.kind,
        signature: primaryDef.signature,
        defLine: primaryDef.line,
        fileName,
        projectName,
        qualifiedClass,
        isDefinition: isAtDefinition,
        targetOffset: isAtDefinition ? (usages[0]?.offset ?? primaryDef.offset) : primaryDef.offset,
        usageCount: usages.length,
        usageLines: usages.map((u) => u.line)
      }
    }

    // Cross-file receiver method or class
    const targetClassName = receiverClass || (isClass ? word : null)
    if (targetClassName) {
      const app = applications.find(
        (a) => a.path.endsWith('/' + targetClassName + '.java') || (a.className && a.className.endsWith('.' + targetClassName))
      )
      const qClass = app?.className || (pkg ? `${pkg}.${targetClassName}` : targetClassName)
      const isMethodCall = Boolean(receiverClass)
      return {
        word,
        kind: isMethodCall ? 'method' : 'class',
        signature: isMethodCall ? `public ${targetClassName} ${word}(...)` : `public class ${targetClassName}`,
        defLine: 1,
        fileName: `${targetClassName}.java`,
        projectName: app?.className ? app.className.split('.').slice(0, -1).join('.') : projectName,
        qualifiedClass: qClass,
        targetPath: app?.path || `${targetClassName}.java`,
        targetOffset: 0,
        isDefinition: false,
        usageCount: 0,
        usageLines: []
      }
    }

    return null
  }, [value, path, applications, workspace, analyzeSymbol])

  useEffect(() => {
    if (jump?.path !== path || !editor.current) return
    if (jump.symbol) {
      // Priority 1: Match declaration in the file
      const declRegex = new RegExp(
        `(?:(?:public|protected|private|static|final|abstract|synchronized)\\s+)*(?:(?:class|interface|enum|record)\\s+|[\\w$.<>\\[\\]]+\\s+)${jump.symbol}\\b`
      )
      const declMatch = declRegex.exec(value)
      if (declMatch) {
        const symIdx = declMatch.index + declMatch[0].lastIndexOf(jump.symbol)
        jumpToOffset(symIdx, jump.symbol.length)
        return
      }
      const idx = value.indexOf(jump.symbol)
      if (idx >= 0) {
        jumpToOffset(idx, jump.symbol.length)
        return
      }
    }
    if (typeof jump.offset === 'number') {
      jumpToOffset(jump.offset)
    }
  }, [jump, path, value, jumpToOffset])

  useEffect(() => {
    const field = editor.current
    if (!field) return
    const align = () => {
      syncScroll(field)
      if (wordWrap && isJava && gutter.current && highlight.current) {
        for (const rail of [gutter.current, diagnosticsGutter.current]) {
          Array.from(rail?.children || []).forEach((row, index) => {
            row.style.height = `${highlight.current.children[index]?.getBoundingClientRect().height || 0}px`
          })
        }
      }
    }
    const observer = new ResizeObserver(align)
    observer.observe(field)
    align()
    return () => observer.disconnect()
  }, [isJava, displayedValue, wordWrap, fontSize])

  // In-file search matches calculation
  const searchMatches = useMemo(() => {
    if (!searchQuery) return []
    const matches = []
    const target = searchCase ? value : value.toLowerCase()
    const query = searchCase ? searchQuery : searchQuery.toLowerCase()
    let pos = 0
    while ((pos = target.indexOf(query, pos)) !== -1) {
      matches.push({ start: pos, end: pos + query.length })
      pos += query.length || 1
    }
    return matches
  }, [value, searchQuery, searchCase])

  // Jump to current match
  useEffect(() => {
    if (!searchOpen || !searchMatches.length) return
    const safeIdx = Math.max(0, Math.min(searchMatchIndex, searchMatches.length - 1))
    const match = searchMatches[safeIdx]
    if (match) {
      jumpToOffset(match.start, match.end - match.start)
    }
  }, [searchOpen, searchMatches, searchMatchIndex, jumpToOffset])

  const openSearch = useCallback(() => {
    setSearchOpen(true)
    const field = editor.current
    if (field) {
      const selectedText = field.value.slice(field.selectionStart, field.selectionEnd).trim()
      if (selectedText && !selectedText.includes('\n')) {
        setSearchQuery(selectedText)
      }
    }
    setTimeout(() => {
      searchInputRef.current?.focus()
      searchInputRef.current?.select()
    }, 50)
  }, [])

  const closeSearch = useCallback(() => {
    setSearchOpen(false)
    editor.current?.focus()
  }, [])

  const nextMatch = useCallback(() => {
    if (!searchMatches.length) return
    setSearchMatchIndex((prev) => (prev + 1) % searchMatches.length)
  }, [searchMatches.length])

  const prevMatch = useCallback(() => {
    if (!searchMatches.length) return
    setSearchMatchIndex((prev) => (prev - 1 + searchMatches.length) % searchMatches.length)
  }, [searchMatches.length])

  // Global Ctrl+F / Cmd+F handler inside editor frame
  useEffect(() => {
    const handleFindKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f' && !e.shiftKey) {
        e.preventDefault()
        e.stopPropagation()
        openSearch()
      }
    }
    window.addEventListener('keydown', handleFindKey, true)
    return () => window.removeEventListener('keydown', handleFindKey, true)
  }, [openSearch])

  // Track modifier keys for IntelliJ Ctrl+hover and Shift+hover hyperlinks
  useEffect(() => {
    const handleModDown = (e) => {
      if (e.key === 'Control' || e.key === 'Shift' || e.key === 'Meta') {
        setIsModifierDown(true)
        if (e.key === 'Shift') setIsShiftDown(true)
      }
    }
    const handleModUp = (e) => {
      if (e.key === 'Control' || e.key === 'Shift' || e.key === 'Meta') {
        const stillDown = e.ctrlKey || e.shiftKey || e.metaKey
        setIsModifierDown(stillDown)
        if (!e.shiftKey) setIsShiftDown(false)
        if (!stillDown) {
          setHoveredSymbol(null)
        }
      }
    }
    window.addEventListener('keydown', handleModDown)
    window.addEventListener('keyup', handleModUp)
    return () => {
      window.removeEventListener('keydown', handleModDown)
      window.removeEventListener('keyup', handleModUp)
    }
  }, [])

  const importSuggestions = useMemo(() => isJava && importLine?.path === path
    ? javaImportSuggestions(value, importLine.line) : [], [isJava, importLine, path, value])

  const updateImportLine = (field, afterEdit = false) => {
    const index = field.value.slice(0, field.selectionStart).split('\n').length - 1
    const line = afterEdit ? index + 1 : visibleLines[index]?.realLine
    if (line) setActiveCaretLine(line)
    if (!isJava) return
    const column = field.selectionStart - field.value.lastIndexOf('\n', field.selectionStart - 1) - 1
    setImportLine({ path, line, column })
    setBraceCaret(!afterEdit && visibleLines[index]?.isFolded ? null : { path, line, column })
  }

  const currentImport = useMemo(() => {
    if (!importSuggestions.length || !importLine) return null
    const line = maskJavaNonCode(value).split('\n')[importLine.line - 1] || ''
    const tokens = [...line.matchAll(/[\w$]+/g)]
    const candidate = importSuggestions.flatMap((qualified) => {
      const simple = qualified.split('.').at(-1)
      return tokens.filter((token) => token[0] === simple &&
        !line.slice(0, token.index).trimEnd().endsWith('.'))
        .map((token) => ({ qualified, offset: token.index,
          distance: Math.max(token.index - importLine.column, importLine.column - token.index - simple.length, 0) }))
    })
    return candidate.sort((a, b) => a.distance - b.distance)[0] || null
  }, [importLine, importSuggestions, value])

  const snippet = useMemo(() => isJava && importLine?.path === path
    ? javaSnippet(value, importLine.line, importLine.column) : null, [isJava, importLine, path, value])
  const classFixForLine = useCallback((line) => {
    if (!isJava) return null
    const diagnostic = result?.diagnostics?.find((item) => item.line === line &&
      item.message.includes('should be declared in a file named '))
    return javaClassNameFix(path, value, line, diagnostic)
  }, [isJava, path, result, value])
  const classFix = useMemo(() => importLine?.path === path ? classFixForLine(importLine.line) : null,
    [classFixForLine, importLine, path])
  const packagePrivate = classFix && makeJavaTypePackagePrivate(value, importLine.line, classFix)
  const methodFix = useMemo(() => {
    if (!isJava || importLine?.path !== path) return null
    const line = importLine.line
    const diagnostic = result?.diagnostics?.find((item) => item.line === line && item.methodSuggestions?.length)
    if (!diagnostic) return null
    const target = javaDiagnosticTarget(rawLines[line - 1], diagnostic)
    if (!target || importLine.column < target.start || importLine.column > target.end + 1) return null
    const suggestion = diagnostic.methodSuggestions[0]
    const change = javaReferenceChange(value, rawLines, line, target, suggestion.name)
    return change && { ...change, offset: target.start, label: 'Change to ' + suggestion.name + '()', preview: target.text + ' → ' + suggestion.name }
  }, [isJava, importLine, path, result, rawLines, value])
  const sourceAction = snippet || classFix || methodFix
  const inlineAction = sourceAction || currentImport

  const positionInlineAction = useCallback(() => {
    if (!inlineAction || !frame.current || !highlight.current) {
      setImportAnchor(null)
      return
    }
    const row = highlight.current.querySelector(`[data-source-line="${importLine.line}"]`)
    const walker = row && document.createTreeWalker(row, NodeFilter.SHOW_TEXT)
    let remaining = inlineAction.offset
    let node
    while (walker && (node = walker.nextNode()) && remaining >= node.length) remaining -= node.length
    if (!node) {
      setImportAnchor(null)
      return
    }
    const range = document.createRange()
    range.setStart(node, remaining)
    range.setEnd(node, remaining + 1)
    const rect = range.getBoundingClientRect()
    const bounds = frame.current.getBoundingClientRect()
    const viewport = highlight.current.getBoundingClientRect()
    if (rect.bottom < viewport.top || rect.top > viewport.bottom || rect.right < viewport.left || rect.left > viewport.right) {
      setImportAnchor(null)
      return
    }
    const left = Math.max(8, Math.min(rect.left - bounds.left - 8, bounds.width - 330))
    const above = rect.top - bounds.top >= 46
    const top = above ? rect.top - bounds.top - 7 : rect.bottom - bounds.top + 7
    setImportAnchor({ left, top, above })
  }, [inlineAction, importLine])

  useLayoutEffect(() => {
    positionInlineAction()
    if (!inlineAction || !frame.current) return
    const observer = new ResizeObserver(positionInlineAction)
    observer.observe(frame.current)
    if (highlight.current) observer.observe(highlight.current)
    return () => observer.disconnect()
  }, [positionInlineAction, inlineAction])

  const applySourceAction = (action) => {
    if (!action) return
    replaceEditorSource(action.source)
    setImportLine(null)
    requestAnimationFrame(() => jumpToOffset(action.source.slice(0, action.caret).replace(/\r\n/g, '\n').length))
  }

  const applyImport = (qualified) => {
    if (!importSuggestions.includes(qualified)) return
    const field = editor.current
    const before = field.value.slice(0, field.selectionStart).split('\n')
    const line = visibleLines[before.length - 1]?.realLine || 1
    const column = Math.min(before.at(-1).length, rawLines[line - 1].length)
    const position = rawLines.slice(0, line - 1).reduce((offset, text) => offset + text.length + 1, column)
    const updated = insertJavaImport(value, qualified)
    replaceEditorSource(updated.source)
    setImportLine(null)
    requestAnimationFrame(() => jumpToOffset(position + (position >= updated.offset ? updated.length : 0)))
  }

  const handleBracketAutoClose = (event) => {
    if (event.ctrlKey || event.altKey || event.metaKey) return false
    const field = event.currentTarget
    const start = field.selectionStart
    const end = field.selectionEnd

    // Only auto-close '(' and '{' (never '<', '[', quotes, to prevent breaking comparison operators like '<')
    const pairs = {
      '(': ')',
      '{': '}'
    }
    const closingChars = new Set([')', '}'])

    // 1. Backspace: delete matching pair if cursor is between () or {}
    if (event.key === 'Backspace' && start === end && start > 0) {
      const prev = field.value[start - 1]
      const next = field.value[start]
      if (
        (prev === '(' && next === ')') ||
        (prev === '{' && next === '}')
      ) {
        event.preventDefault()
        field.setRangeText('', start - 1, start + 1, 'end')
        field.setSelectionRange(start - 1, start - 1)
        handleEditorChange(field.value)
        return true
      }
    }

    // 2. Overtype closing character
    if (closingChars.has(event.key) && start === end && field.value[start] === event.key) {
      event.preventDefault()
      field.setSelectionRange(start + 1, start + 1)
      return true
    }

    // 3. Auto-close opening pair
    if (pairs[event.key]) {
      const close = pairs[event.key]
      event.preventDefault()
      if (start !== end) {
        // Wrap selected text: e.g. (selected) or {selected}
        const selected = field.value.slice(start, end)
        field.setRangeText(event.key + selected + close, start, end, 'select')
        field.setSelectionRange(start + 1, end + 1)
      } else {
        // Insert pair and place caret in between
        field.setRangeText(event.key + close, start, end, 'end')
        field.setSelectionRange(start + 1, start + 1)
      }
      handleEditorChange(field.value)
      return true
    }

    return false
  }

  const indent = (event) => {
    if (event.key !== 'Tab' || event.shiftKey || event.ctrlKey || event.altKey || event.metaKey) return
    const field = event.currentTarget
    const start = field.selectionStart
    event.preventDefault()
    field.setRangeText('  ', start, field.selectionEnd, 'end')
    handleEditorChange(field.value)
  }

  const lineDiagnosticsForHover = hintTarget?.source === value ? (byLine.get(hintTarget.line) || []) : []
  const diagnosticOnHover = hintTarget?.source === value && (lineDiagnosticsForHover.find((diagnostic) => {
    const range = javaDiagnosticTarget(rawLines[hintTarget.line - 1], diagnostic)
    return range && hintTarget.column >= range.start && hintTarget.column <= range.end
  }) || lineDiagnosticsForHover[0])
  const hoverClassFix = hintTarget?.source === value ? classFixForLine(hintTarget.line) : null
  const hoverPackagePrivate = hoverClassFix && makeJavaTypePackagePrivate(value, hintTarget.line, hoverClassFix)
  const hoverHint = hintTarget && hintTarget.source === value
    ? getJavaHint(value, hintTarget.line, hintTarget.column, byLine.get(hintTarget.line) || []) ||
      (hoverClassFix ? { diagnostic: { severity: 'error', message: hoverClassFix.message } } : null)
    : null
  const hoverDetails = diagnosticOnHover || hoverHint?.diagnostic
  const diagnosticRange = hintTarget && javaDiagnosticTarget(rawLines[hintTarget.line - 1], hoverDetails)
  const variableName = hoverDetails?.message.match(/symbol:\s+variable\s+([^\s·]+)/)?.[1]
  const canRenameReference = Boolean(variableName)
  const inferredVarType = variableName && hintTarget ? inferVariableType(rawLines[hintTarget.line - 1], variableName) : 'int'
  const variableActions = canRenameReference ? javaVariableActions(value, outline, hintTarget.line, variableName) : []

  // Missing method quick fix (e.g. "cannot find symbol ... symbol: method calculateTotal(int,String)")
  const methodSymbol = hoverDetails?.message.match(/symbol:\s+method\s+([\w$]+)\s*(?:\(([^)]*)\))?/)
  const missingMethodName = methodSymbol?.[1]
  const missingMethodParams = methodSymbol?.[2] || ''
  const methodAction = missingMethodName && hintTarget
    ? javaMethodActions(value, outline, hintTarget.line, missingMethodName, missingMethodParams, rawLines[hintTarget.line - 1])
    : null
  const declaration = declarationDraft && variableActions.find(({ label }) => label === declarationDraft.label)
  const declarationEdit = declaration?.edit(declarationDraft.type, declarationDraft.initializer)
  const suggestedParameter = canRenameReference && javaParameterSuggestion(outline, hintTarget.line, diagnosticRange.text)
  const replaceReference = (name) => {
    const change = javaReferenceChange(value, rawLines, hintTarget.line, diagnosticRange, name)
    if (change) {
      applySourceAction(change)
      dismissHint()
    }
  }
  const hintTypes = hoverDetails?.message.match(/incompatible types: (.+?) cannot be converted to ([^·]+)/)

  const dismissHint = () => {
    pointerToken.current = null
    clearTimeout(hintTimer.current)
    setHintTarget(null)
    setReferenceDraft(null)
    setDeclarationDraft(null)
  }

  const scheduleHintClose = () => {
    pointerToken.current = null
    clearTimeout(hintTimer.current)
    hintTimer.current = setTimeout(dismissHint, 220)
  }

  const previewJavaHint = (event) => {
    lastMouseCoords.current = { x: event.clientX, y: event.clientY }
    if (!isJava || !highlight.current || event.pointerType === 'touch' || event.buttons) return

    const sym = getSymbolAtCoords(event.clientX, event.clientY)
    if (!sym) {
      if (pointerToken.current !== null) scheduleHintClose()
      setHoveredSymbol(null)
      return
    }

    if (event.shiftKey || event.ctrlKey || event.metaKey || isShiftDown || isModifierDown) {
      // Underline token with IntelliJ hyperlink on Ctrl/Cmd/Shift
      setHoveredSymbol(sym.word)
    } else {
      setHoveredSymbol(null)
    }

    const line = sym.line
    const column = sym.column
    const lineDiagnostics = byLine.get(line) || []
    const punctuation = lineDiagnostics.some((item) => item.column - 1 === column)
    if (!sym.word && !punctuation && !lineDiagnostics.length) {
      if (pointerToken.current !== null) scheduleHintClose()
      return
    }
    const key = line + ':' + sym.offset
    if (key === pointerToken.current) return
    pointerToken.current = key
    clearTimeout(hintTimer.current)
    const bounds = frame.current?.getBoundingClientRect() || { left: 0, top: 0, width: 600, height: 400 }
    const hintLeft = Math.max(8, Math.min(event.clientX - bounds.left, bounds.width - 462))
    const hintTop = Math.max(8, Math.min(event.clientY - bounds.top + 14, bounds.height - 190))
    hintTimer.current = setTimeout(() => setHintTarget({ source: value, line, column, left: hintLeft, top: hintTop }), 380)
  }

  const currentJavaLine = importLine?.path === path ? importLine.line : null
  const methodDiagnostic = isJava && /\.\s*[\w$]+\s*\(/.test(rawLines[currentJavaLine - 1] || '')
    ? byLine.get(currentJavaLine)?.find(({ severity, message }) => severity === 'error' &&
      /\bmethod\b|incompatible types|no suitable/i.test(message))
    : null

  const braceLineStart = braceCaret?.path === path && braceCaret.line > 0
    ? rawLines.slice(0, braceCaret.line - 1).reduce((total, line) => total + line.length + 1, 0)
    : -1
  const braceOffset = braceLineStart < 0 ? -1 : braceLineStart + braceCaret.column
  const selectedBrace = javaBraces.pairs.has(braceOffset) ? braceOffset
    : braceCaret?.column > 0 && javaBraces.pairs.has(braceOffset - 1) ? braceOffset - 1 : -1
  const matchingBrace = javaBraces.pairs.get(selectedBrace)
  const matchingLabel = /[()]/.test(value[selectedBrace] || '') ? 'parenthesis' : 'brace'
  const braceColumns = new Map()
  if (matchingBrace) {
    braceColumns.set(braceCaret.line, new Set([selectedBrace - braceLineStart]))
    const matchLineStart = value.lastIndexOf('\n', matchingBrace.offset - 1) + 1
    const columns = braceColumns.get(matchingBrace.line) || new Set()
    columns.add(matchingBrace.offset - matchLineStart)
    braceColumns.set(matchingBrace.line, columns)
  }

  const renderJavaTokens = (tokens, line) => {
    const ranges = line?.isFolded ? [] : (byLine.get(line?.realLine) || []).flatMap((diagnostic) => {
      const target = javaDiagnosticTarget(rawLines[line.realLine - 1], diagnostic)
      return target ? [{ ...target, style: 'java-token-' + diagnostic.severity }] : []
    })
    for (const column of line?.isFolded ? [] : braceColumns.get(line?.realLine) || []) {
      ranges.push({ start: column, end: column + 1, style: 'java-brace-match' })
    }
    let offset = 0
    const isHyperlinkActive = Boolean((isModifierDown || isShiftDown) && hoveredSymbol)
    return tokens.map(({ text, kind }, index) => {
      const start = offset
      offset += text.length
      const isWord = /^[\p{L}_$][\p{L}\p{N}_$]*$/u.test(text)
      const tokenKind = kind || (isWord ? 'ident' : '')
      const isHyperlink = isHyperlinkActive && text === hoveredSymbol
      const decorations = ranges.filter((range) => range.end > start && range.start < offset)
      if (!decorations.length) {
        const cls = [tokenKind ? `java-${tokenKind}` : '', isHyperlink ? 'java-token-hyperlink' : ''].filter(Boolean).join(' ')
        return cls ? <span className={cls} key={index} data-col={start} data-token={text}>{text}</span> : <span key={index} data-col={start}>{text}</span>
      }
      const boundaries = [...new Set([start, offset, ...decorations.flatMap((range) =>
        [Math.max(range.start, start), Math.min(range.end, offset)])])].sort((a, b) => a - b)
      return (
        <span className={tokenKind ? `java-${tokenKind}` : undefined} key={index} data-col={start} data-token={text}>
          {boundaries.slice(0, -1).map((position, part) => {
            const classes = decorations.filter((range) => range.start <= position && range.end > position).map((range) => range.style)
            if (isHyperlink) classes.push('java-token-hyperlink')
            const segment = text.slice(position - start, boundaries[part + 1] - start)
            return classes.length ? <span className={classes.join(' ')} key={position}>{segment}</span> : segment
          })}
        </span>
      )
    })
  }

  const formatDocument = async () => {
    if (formatStatus?.pending) return
    if (isJson) {
      try {
        const formatted = formatJsonSource(value)
        replaceEditorSource(formatted)
        setFormatStatus({ message: 'JSON formatted' })
      } catch (error) {
        setFormatStatus({ message: error.message || 'Invalid JSON syntax.' })
      }
      return
    }
    if (isYaml) {
      try {
        const formatted = formatYamlSource(value)
        replaceEditorSource(formatted)
        setFormatStatus({ message: 'YAML formatted' })
      } catch (error) {
        setFormatStatus({ message: error.message || 'Invalid YAML syntax.' })
      }
      return
    }
    if (!isJava) return
    if (import.meta.env.MODE === 'pages') {
      setFormatStatus({ message: 'Java formatting requires the Ather Studio desktop app.' })
      return
    }
    const field = editor.current
    const requestedSource = value
    const requestedDisplay = field.value
    const requestedFile = field.getAttribute('aria-label')
    setFormatStatus({ pending: true })
    try {
      const res = await fetch('/api/java/format', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: requestedSource })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      if (editor.current === field && field.value === requestedDisplay && field.getAttribute('aria-label') === requestedFile) {
        replaceEditorSource(data.source)
        setFormatStatus({ message: 'Java formatted' })
      } else {
        setFormatStatus(null)
      }
    } catch (error) {
      setFormatStatus({ message: error instanceof SyntaxError ? 'Java formatting requires the Ather Studio desktop app.' : error.message })
    }
  }

  // Apply full-source actions without losing content hidden by folds.
  const replaceEditorSource = (source) => {
    activeFolds.forEach(toggleFold)
    onChange(source)
  }

  // Handle typing inside editor safely when folds are active
  const handleEditorChange = (newText) => {
    if (activeFolds.size) {
      activeFolds.forEach(toggleFold)
      return
    }
    onChange(newText)
  }

  return (
    <div ref={frame} className={`code-editor-frame ${className}`}>
      {(hoverHint || hoverDetails) && (
        <aside
          className="java-hover-hint"
          aria-label="Java hint"
          style={{ left: hintTarget.left, top: hintTarget.top }}
          onPointerEnter={() => clearTimeout(hintTimer.current)}
          onPointerLeave={scheduleHintClose}
          onKeyDown={(event) => { if (event.key === 'Escape') { dismissHint(); editor.current?.focus() } }}
        >
          {hoverDetails && (
            <header className={`java-hover-${hoverDetails.severity}`}>
              <div className="java-diagnostic-location">
                Line {hoverDetails.line}:{(diagnosticRange?.start ?? hoverDetails.column - 1) + 1}
                {diagnosticRange && <> · <code>{diagnosticRange.text}</code></>}
              </div>
              {hintTypes ? (
                <dl><dt>Required type</dt><dd><code>{hintTypes[2].trim()}</code></dd>
                  <dt>Provided</dt><dd><code>{hintTypes[1].trim()}</code></dd></dl>
              ) : hoverDetails.message}
            </header>
          )}
          {hoverDetails?.methodSuggestions?.length > 0 && diagnosticRange && (
            <div className="java-method-fixes">
              {hoverDetails.methodSuggestions.map(({ name, signature, docPath }) => (
                <div key={name} className="java-reference-actions">
                  <button type="button" className="ghost" onClick={() => replaceReference(name)}>Change to {name}()</button>
                  <a href={`https://docs.oracle.com/en/java/javase/${docPath}`} target="_blank" rel="noreferrer" title={signature}>Javadoc</a>
                  <code>{signature}</code>
                </div>
              ))}
            </div>
          )}
          {canRenameReference && (
            <div className="java-reference-actions">
              {suggestedParameter && <button type="button" className="ghost" onClick={() => replaceReference(suggestedParameter)}>Change to {suggestedParameter}</button>}
              {referenceDraft === null ? (
                <button type="button" className="ghost" onClick={() => setReferenceDraft(diagnosticRange.text)}>Rename reference…</button>
              ) : (
                <form onSubmit={(event) => { event.preventDefault(); replaceReference(referenceDraft) }}>
                  <input autoFocus aria-label="Reference name" value={referenceDraft} onChange={(event) => setReferenceDraft(event.target.value)} />
                  <button type="submit" className="ghost">Apply</button>
                </form>
              )}
            </div>
          )}
          {methodAction && (
            <div className="java-reference-actions java-declaration-actions">
              <button
                type="button"
                className="ghost"
                style={{ color: '#58a6ff', fontWeight: 600 }}
                onClick={() => {
                  applySourceAction(methodAction)
                  dismissHint()
                }}
              >
                <PopIcon name="sparkle" size={14} /> {methodAction.label}
              </button>
              <small style={{ color: 'var(--muted, #888)', display: 'block', marginTop: '2px' }}>
                Generates <code>{methodAction.preview}</code> (Alt+Enter)
              </small>
            </div>
          )}
          {variableActions.length > 0 && (
            <div className="java-reference-actions java-declaration-actions">
              {variableActions.map((action) => (
                <button type="button" className="ghost" key={action.label} onClick={() => {
                  setDeclarationDraft({
                    label: action.label,
                    type: inferredVarType,
                    initializer: getDefaultValueForType(inferredVarType)
                  })
                  setReferenceDraft(null)
                }}><PopIcon name="sparkle" size={14} /> {action.label} ‘{variableName}’ <small>({inferredVarType})</small></button>
              ))}
              {declaration && (
                <form onSubmit={(event) => {
                  event.preventDefault()
                  if (declarationEdit) {
                    applySourceAction(declarationEdit)
                    dismissHint()
                  }
                }}>
                  <label>Type <input autoFocus value={declarationDraft.type} placeholder="int" onChange={(event) =>
                    setDeclarationDraft({ ...declarationDraft, type: event.target.value })} /></label>
                  {declaration.needsValue && <label>Initial value <input value={declarationDraft.initializer} placeholder="0" onChange={(event) =>
                    setDeclarationDraft({ ...declarationDraft, initializer: event.target.value })} /></label>}
                  {declarationEdit && <code>{declarationEdit.preview.trim()}</code>}
                  <button type="submit" className="ghost" disabled={!declarationEdit}>Apply</button>
                </form>
              )}
            </div>
          )}
          {hoverPackagePrivate && <button type="button" className="ghost" onClick={() => {
            applySourceAction(hoverPackagePrivate)
            dismissHint()
          }}>{hoverPackagePrivate.label}</button>}
          {hoverClassFix && (
            <button type="button" className="ghost" onClick={() => {
              applySourceAction(hoverClassFix)
              dismissHint()
            }}>{hoverClassFix.label}</button>
          )}
          {hoverHint?.fix && (
            <button type="button" className="ghost" onClick={() => {
              const { offset, text } = hoverHint.fix
              replaceEditorSource(value.slice(0, offset) + text + value.slice(offset))
              dismissHint()
              editor.current?.focus()
            }}>{hoverHint.fix.label}</button>
          )}
          {hoverHint?.importName && (
            <button type="button" className="ghost" onClick={() => {
              const update = insertJavaImport(value, hoverHint.importName)
              replaceEditorSource(update.source)
              dismissHint()
              editor.current?.focus()
            }}>Import {hoverHint.importName}</button>
          )}
          {hoverHint?.signature && (
            <div className="java-hover-docs">
              <code>{hoverHint.signature}</code>
              <p>{hoverHint.description}</p>
              <a href={hoverHint.url} target="_blank" rel="noreferrer">Java API documentation</a>
            </div>
          )}
        </aside>
      )}
      {isFormattable && (
        <div className="java-import-actions java-structure-actions">
          <button type="button" className="ghost" onClick={formatDocument} disabled={formatStatus?.pending}>
            {isJson ? 'Format JSON' : isYaml ? 'Format YAML' : 'Format Java'}
          </button>
          {isJava && matchingBrace && (
            <button type="button" className="ghost" onClick={() => {
              activeFolds.forEach(toggleFold)
              requestAnimationFrame(() => jumpToOffset(value.slice(0, matchingBrace.offset).replace(/\r\n/g, '\n').length))
            }}>Matching {matchingLabel} on line {matchingBrace.line}</button>
          )}
          {formatStatus?.message && <span role="status">{formatStatus.message}</span>}
        </div>
      )}
      {methodDiagnostic && (
        <div className="java-import-actions java-method-diagnostic" role="status" title={methodDiagnostic.message}>
          {methodDiagnostic.message}
        </div>
      )}
      {inlineAction && importAnchor && (
        <div className={`java-import-popup${importAnchor.above ? ' above' : ''}`}
          style={{ left: importAnchor.left, top: importAnchor.top }} role="group" aria-label={snippet ? "Expand Java snippet" : classFix ? "Fix Java class name" : methodFix ? "Fix Java method name" : "Add Java import"}>
          <button type="button" className="ghost" onMouseDown={(event) => event.preventDefault()}
            onClick={() => sourceAction ? applySourceAction(sourceAction) : applyImport(currentImport.qualified)}>
            <span>{sourceAction?.label || 'Import class…'}</span>
            <code>{sourceAction?.preview || currentImport.qualified}</code>
            <kbd>{snippet ? 'Tab' : 'Alt+Enter'}</kbd>
          </button>
          {packagePrivate && (
            <>
              <button type="button" className="ghost" aria-expanded={showClassActions}
                onMouseDown={(event) => event.preventDefault()} onClick={() => setShowClassActions(!showClassActions)}>More actions…</button>
              {showClassActions && <button type="button" className="ghost" onMouseDown={(event) => event.preventDefault()}
                onClick={() => applySourceAction(packagePrivate)}>{packagePrivate.label}</button>}
            </>
          )}
        </div>
      )}
      {/* Floating In-File Search Bar (Ctrl+F) */}
      {searchOpen && (
        <div className="in-file-search-bar" role="search" aria-label="Find in file">
          <div className="search-input-wrapper">
            <span className="search-icon"><PopIcon name="search" size={14} /></span>
            <input
              ref={searchInputRef}
              type="text"
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value)
                setSearchMatchIndex(0)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  if (e.shiftKey) prevMatch()
                  else nextMatch()
                } else if (e.key === 'Escape') {
                  e.preventDefault()
                  closeSearch()
                }
              }}
              placeholder="Find in file (Enter / Shift+Enter)..."
              spellCheck="false"
              autoComplete="off"
            />
            <span className="match-counter">
              {searchQuery ? `${searchMatches.length ? searchMatchIndex + 1 : 0} of ${searchMatches.length}` : '0 results'}
            </span>
          </div>

          <button
            type="button"
            className="search-nav-btn"
            onClick={prevMatch}
            disabled={!searchMatches.length}
            title="Previous match (Shift+Enter)"
            aria-label="Previous match"
          >
            <PopIcon name="chevronUp" size={14} />
          </button>
          <button
            type="button"
            className="search-nav-btn"
            onClick={nextMatch}
            disabled={!searchMatches.length}
            title="Next match (Enter)"
            aria-label="Next match"
          >
            <PopIcon name="chevronDown" size={14} />
          </button>
          <button
            type="button"
            className={`search-toggle-btn ${searchCase ? 'active' : ''}`}
            onClick={() => setSearchCase((prev) => !prev)}
            title="Match case"
            aria-label="Match case"
          >
            Aa
          </button>
          <button
            type="button"
            className="search-close-btn"
            onClick={closeSearch}
            title="Close search (Esc)"
            aria-label="Close find in file"
          >
            ×
          </button>
        </div>
      )}

      <div className={`code-editor ${isJava ? 'java-editor' : ''} ${highlighted ? 'has-highlight' : ''}`} style={{ '--editor-size': `${fontSize}px` }}>
        {/* Line Numbers Gutter: RENDERED FOR EVERY TYPE OF FILE */}
        {/* Strictly uncopyable: user-select: none & pointer-events: none */}
        <div className="code-gutter" ref={gutter} aria-label="Line numbers">
          {visibleLines.map((lineData) => {
            const { realLine, isFoldHeader, isFolded, foldInfo } = lineData
            const lineDiags = byLine.get(realLine) || []
            const hasLineError = lineDiags.some((d) => d.severity === 'error')
            const hasLineWarn = !hasLineError && lineDiags.some((d) => d.severity === 'warning')
            return (
              <div className={`code-gutter-line ${activeCaretLine === realLine ? 'active-line' : ''} ${hasLineError ? 'error-line-gutter' : hasLineWarn ? 'warn-line-gutter' : ''}`} key={realLine}>
                {isJava && (
                  <button
                    type="button"
                    className="breakpoint-toggle"
                    tabIndex={breakpoints.has(realLine) ? 0 : -1}
                    aria-label={`Breakpoint on line ${realLine}`}
                    aria-pressed={breakpoints.has(realLine)}
                    title={`${breakpoints.has(realLine) ? 'Remove' : 'Add'} breakpoint on line ${realLine}`}
                    onClick={() => onToggleBreakpoint?.(realLine)}
                  />
                )}
                {realLine === mainLine && (
                  <button
                    type="button"
                    className="gutter-main-action"
                    aria-label="Main method run actions"
                    aria-expanded={Boolean(runMenu)}
                    onClick={(event) => {
                      const row = event.currentTarget.getBoundingClientRect()
                      const surface = event.currentTarget.closest('.code-editor').getBoundingClientRect()
                      setRunMenu(runMenu ? null : {
                        top: Math.max(0, Math.min(row.top - surface.top, surface.height - 80)),
                        left: row.right - surface.left + 4
                      })
                    }}
                  >
                    <PopIcon name="play" size={12} />
                  </button>
                )}
                {/* Method-level minimization toggle in editor gutter */}
                {isFoldHeader && foldInfo && (
                  <button
                    type="button"
                    className={`gutter-fold-btn ${isFolded ? 'folded' : 'expanded'}`}
                    aria-label={isFolded ? `Expand ${foldInfo.name}` : `Minimize ${foldInfo.name}`}
                    title={isFolded ? `Expand ${foldInfo.name} (Lines ${foldInfo.startLine}-${foldInfo.endLine})` : `Minimize ${foldInfo.name} (Lines ${foldInfo.startLine}-${foldInfo.endLine})`}
                    onClick={(e) => {
                      e.stopPropagation()
                      toggleFold(realLine)
                    }}
                  >
                    {isFolded ? '▸' : '▾'}
                  </button>
                )}
                <span className="code-gutter-num" aria-hidden="true">{realLine}</span>
              </div>
            )
          })}
        </div>

        {runMenu && (
          <div
            className="gutter-run-menu"
            style={runMenu}
            onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setRunMenu(null) }}
            onKeyDown={(event) => { if (event.key === 'Escape') setRunMenu(null) }}
          >
            <button autoFocus onClick={() => { setRunMenu(false); onRunMain?.() }}>Run main()</button>
            <button disabled={!onDebugMain} onClick={() => { setRunMenu(false); onDebugMain?.() }}>Debug main()</button>
          </div>
        )}

        <div className="code-editor-field">
          {highlighted && (
            <pre ref={highlight} className={`java-highlight ${wordWrap ? 'wrap' : ''}`} aria-hidden="true">
              {highlighted.map((tokens, line) => {
                const lineData = visibleLines[line]
                const realLine = lineData?.realLine
                const lineDiags = byLine.get(realLine) || []
                const hasLineError = lineDiags.some((d) => d.severity === 'error')
                const hasLineWarn = !hasLineError && lineDiags.some((d) => d.severity === 'warning')
                return (
                  <span
                    key={line}
                    data-source-line={lineData?.isFolded ? undefined : realLine}
                    className={`java-source-line ${activeCaretLine === realLine ? 'java-active-line' : ''} ${breakpoints.has(realLine) ? 'java-breakpoint-line' : ''} ${debugLine === realLine ? 'java-execution-line' : ''} ${hasLineError ? 'java-error-line' : hasLineWarn ? 'java-warning-line' : ''} ${navHighlightLine === realLine ? 'java-nav-jump-highlight' : ''}`}
                  >
                    {tokens.length ? renderJavaTokens(tokens, lineData) : '\u200b'}
                    {debugLine === realLine && debugLocation?.variables?.length > 0 && (
                      <span className="java-execution-values">{[...(debugCondition === undefined ? [] : ['= ' + debugCondition]), ...debugLocation.variables.slice(0, 4).map(({ name, value }) => name + ' = ' + value)].join('   ')}</span>
                    )}
                  </span>
                )
              })}
            </pre>
          )}

          <textarea
            ref={editor}
            className="editor"
            aria-label={`Edit ${path}`}
            value={displayedValue}
            wrap={wordWrap ? 'soft' : 'off'}
            style={{ cursor: (isShiftDown || isModifierDown) ? 'pointer' : undefined }}
            onPointerMove={previewJavaHint}
            onPointerLeave={() => {
              scheduleHintClose()
              setHoveredSymbol(null)
            }}
            onPointerDown={(event) => {
              dismissHint()
            }}
            onMouseDown={(event) => {
              if (event.shiftKey || event.ctrlKey || event.metaKey) {
                event.preventDefault()
                let sym = getSymbolAtCoords(event.clientX, event.clientY)
                if (!sym && hoveredSymbol) {
                  sym = { word: hoveredSymbol, offset: 0 }
                }
                if (!sym && editor.current) {
                  const caretInfo = getWordAtOffset(value, editor.current.selectionStart)
                  if (caretInfo) {
                    sym = { word: caretInfo.word, offset: caretInfo.start }
                  }
                }
                if (sym) {
                  jumpToDefinitionOrUsage(sym.word, sym.offset)
                }
              }
            }}
            onClick={(event) => {
              if (event.shiftKey || event.ctrlKey || event.metaKey) {
                event.preventDefault()
                let sym = getSymbolAtCoords(event.clientX, event.clientY)
                if (!sym && hoveredSymbol) {
                  sym = { word: hoveredSymbol, offset: 0 }
                }
                if (!sym && editor.current) {
                  const caretInfo = getWordAtOffset(value, event.currentTarget.selectionStart)
                  if (caretInfo) {
                    sym = { word: caretInfo.word, offset: caretInfo.start }
                  }
                }
                if (sym) {
                  jumpToDefinitionOrUsage(sym.word, sym.offset)
                }
                return
              }
            }}
            onKeyUp={(event) => {
              if (event.key === 'Shift' || event.key === 'Control' || event.key === 'Meta') {
                setIsShiftDown(false)
                setIsModifierDown(false)
                setHoveredSymbol(null)
              }
            }}
            onFocus={(event) => updateImportLine(event.currentTarget)}
            onSelect={(event) => updateImportLine(event.currentTarget)}
            onChange={(event) => {
              updateImportLine(event.currentTarget, true)
              handleEditorChange(event.target.value)
            }}
            onKeyDown={(event) => {
              if (handleBracketAutoClose(event)) return

              if (event.key === 'F4' || event.key === 'F12' || ((event.ctrlKey || event.metaKey) && (event.key.toLowerCase() === 'b' || event.key === 'Enter' || event.key === 'ArrowDown' || event.key === 'ArrowUp'))) {
                event.preventDefault()
                const field = event.currentTarget
                const offset = field.selectionStart
                const wordInfo = getWordAtOffset(field.value, offset)
                if (wordInfo) {
                  jumpToDefinitionOrUsage(wordInfo.word, wordInfo.start)
                }
                return
              }

              if (event.key === 'Shift' || event.key === 'Control' || event.key === 'Meta') {
                setIsShiftDown(true)
                setIsModifierDown(true)
                const field = event.currentTarget
                const offset = field.selectionStart
                const wordInfo = getWordAtOffset(field.value, offset)
                if (wordInfo) {
                  setHoveredSymbol(wordInfo.word)
                }
              } else if (event.key === 'Escape' && (hoverHint || hoverDetails)) {
                dismissHint()
              } else if (isFormattable && event.ctrlKey && event.altKey && event.key.toLowerCase() === 'l') {
                event.preventDefault()
                void formatDocument()
              } else if (event.altKey && event.key === 'Enter') {
                if (methodAction) {
                  event.preventDefault()
                  applySourceAction(methodAction)
                  dismissHint()
                } else if (declarationEdit) {
                  event.preventDefault()
                  applySourceAction(declarationEdit)
                  dismissHint()
                } else if (sourceAction) {
                  event.preventDefault()
                  applySourceAction(sourceAction)
                } else if (isJava && currentImport) {
                  event.preventDefault()
                  applyImport(currentImport.qualified)
                }
              } else if (sourceAction && snippet && event.key === 'Tab' && !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
                event.preventDefault()
                applySourceAction(sourceAction)
              } else if (isJava && event.key === 'Escape' && inlineAction) {
                setImportLine(null)
              } else if (isJava && event.ctrlKey && event.key === 'F8') {
                event.preventDefault()
                onToggleBreakpoint?.(event.currentTarget.value.slice(0, event.currentTarget.selectionStart).split('\n').length)
              } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
                event.preventDefault()
                openSearch()
              } else {
                indent(event)
              }
            }}
            onScroll={(event) => {
              syncScroll(event.currentTarget)
              if (inlineAction) positionInlineAction()
              if (hintTarget || pointerToken.current) dismissHint()
              if (runMenu) setRunMenu(null)
            }}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
          />
        </div>

        {/* Diagnostics gutter for Java and other validatable files */}
        {isValidatable && (
          <div className="java-diagnostics-gutter" ref={diagnosticsGutter} aria-label="Syntax diagnostics">
            {visibleLines.map((lineData) => {
              const realLine = lineData.realLine
              const items = byLine.get(realLine)
              return (
                <div className="java-diagnostic-row" key={realLine}>
                  {items && (
                    <span
                      className={items.some((item) => item.severity === 'error') ? 'java-diagnostic-error' : 'java-diagnostic-warning'}
                      tabIndex={0}
                      title={items.map(({ severity, message }) => `${severity}: ${message}`).join('\n')}
                      aria-label={`Line ${realLine}. ${items.map(({ severity, message }) => `${severity}: ${message}`).join('. ')}`}
                      onClick={() => jumpToOffset(rawLines.slice(0, realLine - 1).join('\n').length + 1)}
                    >
                      !
                    </span>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {/* Validation Status Badge & Popover */}
        {isValidatable && (
          <details
            className="java-diagnostics-popover"
            onKeyDown={(event) => {
              if (event.key !== 'Escape' || !event.currentTarget.open) return
              event.stopPropagation()
              event.currentTarget.open = false
              event.currentTarget.querySelector('summary').focus()
            }}
          >
            <summary
              className={`java-diagnostics-status is-${diagnosticStatus}`}
              title={diagnosticLabel}
              aria-label={`Diagnostics. ${diagnosticLabel}`}
            >
              <span className="java-diagnostics-icon" aria-hidden="true">
                {diagnosticStatus === 'success' ? <PopIcon name="check" size={14} /> : diagnosticStatus === 'pending' ? '…' : diagnosticStatus === 'error' ? <PopIcon name="close" size={14} /> : <PopIcon name="alert" size={14} />}
              </span>
              {problemCount > 0 && <span className="java-diagnostics-count">{problemCount}</span>}
              <span className="java-diagnostics-label">{diagnosticLabel}</span>
            </summary>
            <div className="java-diagnostics-list">
              {result?.error && <p>{result.error}</p>}
              {!result && <p>Checking {ext.toUpperCase()}…</p>}
              {result && !result.error && problemCount === 0 && <p>No syntax diagnostics.</p>}
              {problemCount > 0 && (
                <ul>
                  {diagnostics.map((diagnostic, index) => {
                    const { line, column, severity, message } = diagnostic
                    const target = isJava ? javaDiagnosticTarget(rawLines[line - 1], diagnostic) : null
                    const startColumn = target?.start ?? Math.max(0, (column || 1) - 1)
                    return (
                      <li key={index} style={{ cursor: line ? 'pointer' : 'default' }} onClick={() => {
                        if (!line) return
                        activeFolds.forEach(toggleFold)
                        const offset = rawLines.slice(0, line - 1).reduce((sum, row) =>
                          sum + row.replace(/\r$/, '').length + 1, startColumn)
                        requestAnimationFrame(() => jumpToOffset(offset, target?.text.length))
                      }}>
                        <strong className={severity === 'error' ? 'java-diagnostic-error' : 'java-diagnostic-warning'}>
                          {line ? `Line ${line}:${startColumn + 1}` : 'File'} · {severity}
                          {target && <> · <code>{target.text}</code></>}
                        </strong>
                        <div>{message}</div>
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
          </details>
        )}
      </div>
    </div>
  )
}
