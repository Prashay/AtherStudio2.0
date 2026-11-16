import React, { useEffect, useLayoutEffect, useMemo, useRef, useState, useCallback } from 'react'
import { javaHighlight } from './javaHighlight.js'
import { getJavaHint } from './javaHints.js'
import { javaSnippet } from './javaSnippets.js'
import { javaClassNameFix } from './javaClassNameFix.js'
import { javaVariableActions, makeJavaTypePackagePrivate } from './javaQuickFixes.js'
import { javaDiagnosticTarget, javaParameterSuggestion, javaReferenceChange } from './javaDiagnosticTarget.js'
import { validateSyntax } from './syntaxValidation.js'
import { insertJavaImport, javaImportSuggestions, maskJavaNonCode } from './javaImports.js'

export default function CodeEditor({
  path,
  value,
  onChange,
  fontSize,
  wordWrap,
  jump,
  mainLine,
  onRunMain,
  onDebugMain,
  workspace,
  breakpointLines = [],
  onToggleBreakpoint,
  className = '',
  outline = [],
  externalFoldedLines,
  onExternalToggleFold
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
  const [formatStatus, setFormatStatus] = useState(null)

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

  const highlighted = useMemo(() => isJava ? javaHighlight(path, displayedValue.replace(/\r\n?/g, '\n')) : null, [isJava, path, displayedValue])
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
    const line = item.line || 1
    if (!byLine.has(line)) byLine.set(line, [])
    byLine.get(line).push(item)
  }
  if (result?.error) byLine.set(1, [{ severity: 'warning', message: result.error }])
  const breakpoints = new Set(breakpointLines)

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
  }, [])

  useEffect(() => {
    if (jump?.path !== path || !editor.current) return
    jumpToOffset(jump.offset)
  }, [jump, path, jumpToOffset])

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

  const importSuggestions = useMemo(() => isJava && importLine?.path === path
    ? javaImportSuggestions(value, importLine.line) : [], [isJava, importLine, path, value])

  const updateImportLine = (field, afterEdit = false) => {
    if (!isJava) return
    const index = field.value.slice(0, field.selectionStart).split('\n').length - 1
    const line = afterEdit ? index + 1 : visibleLines[index]?.realLine
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

  const indent = (event) => {
    if (event.key !== 'Tab' || event.shiftKey || event.ctrlKey || event.altKey || event.metaKey) return
    const field = event.currentTarget
    const start = field.selectionStart
    event.preventDefault()
    field.setRangeText('  ', start, field.selectionEnd, 'end')
    handleEditorChange(field.value)
  }

  const diagnosticOnHover = hintTarget?.source === value && (byLine.get(hintTarget.line) || []).find((diagnostic) => {
    const range = javaDiagnosticTarget(rawLines[hintTarget.line - 1], diagnostic)
    return range && hintTarget.column >= range.start && hintTarget.column <= range.end
  })
  const hoverClassFix = hintTarget?.source === value ? classFixForLine(hintTarget.line) : null
  const hoverPackagePrivate = hoverClassFix && makeJavaTypePackagePrivate(value, hintTarget.line, hoverClassFix)
  const hoverHint = hintTarget && hintTarget.source === value
    ? getJavaHint(value, hintTarget.line, hintTarget.column, byLine.get(hintTarget.line) || []) ||
      (hoverClassFix ? { diagnostic: { severity: 'error', message: hoverClassFix.message } } : null)
    : null
  const hoverDetails = diagnosticOnHover || hoverHint?.diagnostic
  const diagnosticRange = hintTarget && javaDiagnosticTarget(rawLines[hintTarget.line - 1], hoverDetails)
  const variableName = hoverDetails?.message.match(/symbol:\s+variable\s+([^\s·]+)/)?.[1]
  const canRenameReference = Boolean(variableName && diagnosticRange?.text === variableName)
  const variableActions = canRenameReference ? javaVariableActions(value, outline, hintTarget.line, variableName) : []
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
    if (!isJava || !highlight.current || event.pointerType === 'touch' || event.buttons) return
    const field = event.currentTarget
    const layer = highlight.current
    field.style.pointerEvents = 'none'
    layer.style.pointerEvents = 'auto'
    let range
    try {
      range = document.caretRangeFromPoint(event.clientX, event.clientY)
    } finally {
      field.style.pointerEvents = ''
      layer.style.pointerEvents = ''
    }
    const node = range?.startContainer
    const row = node?.parentElement?.closest('.java-source-line')
    if (!row || row.parentElement !== layer) {
      if (pointerToken.current !== null) scheduleHintClose()
      return
    }
    const line = Number(row.dataset.sourceLine)
    const measured = document.createRange()
    measured.selectNodeContents(row)
    measured.setEnd(node, range.startOffset)
    const column = measured.toString().length
    const token = [...(rawLines[line - 1] || '').matchAll(/[\w$]+/g)].find((item) =>
      column >= item.index && column <= item.index + item[0].length)
    const punctuation = (byLine.get(line) || []).some((item) => item.column - 1 === column)
    if (!token && !punctuation) {
      if (pointerToken.current !== null) scheduleHintClose()
      return
    }
    const key = line + ':' + (token?.index ?? column)
    if (key === pointerToken.current) return
    pointerToken.current = key
    clearTimeout(hintTimer.current)
    const bounds = frame.current.getBoundingClientRect()
    const left = Math.max(8, Math.min(event.clientX - bounds.left, bounds.width - 462))
    const top = Math.max(8, Math.min(event.clientY - bounds.top + 14, bounds.height - 190))
    hintTimer.current = setTimeout(() => setHintTarget({ source: value, line, column, left, top }), 380)
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
    return tokens.map(({ text, kind }, index) => {
      const start = offset
      offset += text.length
      const decorations = ranges.filter((range) => range.end > start && range.start < offset)
      if (!decorations.length) return kind ? <span className={`java-${kind}`} key={index}>{text}</span> : text
      const boundaries = [...new Set([start, offset, ...decorations.flatMap((range) =>
        [Math.max(range.start, start), Math.min(range.end, offset)])])].sort((a, b) => a - b)
      return <span className={kind ? `java-${kind}` : undefined} key={index}>
        {boundaries.slice(0, -1).map((position, part) => {
          const classes = decorations.filter((range) => range.start <= position && range.end > position).map((range) => range.style)
          const segment = text.slice(position - start, boundaries[part + 1] - start)
          return classes.length ? <span className={classes.join(' ')} key={position}>{segment}</span> : segment
        })}
      </span>
    })
  }

  const formatJava = async () => {
    if (formatStatus?.pending) return
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
          {variableActions.length > 0 && (
            <div className="java-reference-actions java-declaration-actions">
              {variableActions.map((action) => (
                <button type="button" className="ghost" key={action.label} onClick={() => {
                  setDeclarationDraft({ label: action.label, type: '', initializer: '' })
                  setReferenceDraft(null)
                }}>{action.label} ‘{variableName}’</button>
              ))}
              {declaration && (
                <form onSubmit={(event) => {
                  event.preventDefault()
                  if (declarationEdit) {
                    applySourceAction(declarationEdit)
                    dismissHint()
                  }
                }}>
                  <label>Type <input autoFocus value={declarationDraft.type} placeholder="int[]" onChange={(event) =>
                    setDeclarationDraft({ ...declarationDraft, type: event.target.value })} /></label>
                  {declaration.needsValue && <label>Initial value <input value={declarationDraft.initializer} placeholder="Existing value or expression" onChange={(event) =>
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
      {isJava && (
        <div className="java-import-actions java-structure-actions">
          <button type="button" className="ghost" onClick={formatJava} disabled={formatStatus?.pending}>Format Java</button>
          {matchingBrace && (
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
            <span className="search-icon">🔍</span>
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
            ▲
          </button>
          <button
            type="button"
            className="search-nav-btn"
            onClick={nextMatch}
            disabled={!searchMatches.length}
            title="Next match (Enter)"
            aria-label="Next match"
          >
            ▼
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

      <div className={`code-editor ${isJava ? 'java-editor' : ''}`} style={{ '--editor-size': `${fontSize}px` }}>
        {/* Line Numbers Gutter: RENDERED FOR EVERY TYPE OF FILE */}
        {/* Strictly uncopyable: user-select: none & pointer-events: none */}
        <div className="code-gutter" ref={gutter} aria-label="Line numbers">
          {visibleLines.map((lineData) => {
            const { realLine, isFoldHeader, isFolded, foldInfo } = lineData
            return (
              <div className="code-gutter-line" key={realLine}>
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
                    ▷
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
              {highlighted.map((tokens, line) => (
                <span key={line} data-source-line={visibleLines[line]?.isFolded ? undefined : visibleLines[line]?.realLine} className={`java-source-line ${breakpoints.has(visibleLines[line]?.realLine) ? 'java-breakpoint-line' : ''}`}>
                  {tokens.length ? renderJavaTokens(tokens, visibleLines[line]) : '\u200b'}
                </span>
              ))}
            </pre>
          )}

          <textarea
            ref={editor}
            className="editor"
            aria-label={`Edit ${path}`}
            value={displayedValue}
            wrap={wordWrap ? 'soft' : 'off'}
            onPointerMove={previewJavaHint}
            onPointerLeave={scheduleHintClose}
            onPointerDown={dismissHint}
            onFocus={(event) => updateImportLine(event.currentTarget)}
            onSelect={(event) => updateImportLine(event.currentTarget)}
            onChange={(event) => {
              updateImportLine(event.currentTarget, true)
              handleEditorChange(event.target.value)
            }}
            onKeyDown={(event) => {
              if (event.key === 'Escape' && (hoverHint || hoverDetails)) {
                dismissHint()
              } else if (isJava && event.ctrlKey && event.altKey && event.key.toLowerCase() === 'l') {
                event.preventDefault()
                void formatJava()
              } else if (sourceAction && (event.altKey && event.key === 'Enter' ||
                snippet && event.key === 'Tab' && !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey)) {
                event.preventDefault()
                applySourceAction(sourceAction)
              } else if (isJava && event.altKey && event.key === 'Enter' && currentImport) {
                event.preventDefault()
                applyImport(currentImport.qualified)
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
              <span aria-hidden="true">{diagnosticStatus === 'success' ? '✓' : diagnosticStatus === 'pending' ? '…' : '!'}</span>
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
