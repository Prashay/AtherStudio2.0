import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import { javaHighlight } from './javaHighlight.js'
import { validateSyntax } from './syntaxValidation.js'

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
  const gutter = useRef(null)
  const diagnosticsGutter = useRef(null)
  const editor = useRef(null)
  const highlight = useRef(null)
  const searchInputRef = useRef(null)

  const [runMenu, setRunMenu] = useState(null)
  const [validation, setValidation] = useState(null)

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

  // Outline fold mapping
  const foldMap = useMemo(() => {
    const map = new Map()
    if (!outline || !outline.length) return map
    for (const item of outline) {
      if (item.canFold && item.endLine > item.startLine) {
        if (!map.has(item.startLine) || item.kind === 'method' || item.subKind === 'function') {
          map.set(item.startLine, item)
        }
      }
    }
    return map
  }, [outline])

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
        const summary = ` /* ▾ ${collapsedCount} lines collapsed (${foldInfo.name || 'method'}) ▾ */`
        if (lineText.includes('{')) {
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
  }, [rawLines, value, activeFolds, foldMap])

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

  const indent = (event) => {
    if (event.key !== 'Tab' || event.shiftKey || event.ctrlKey || event.altKey || event.metaKey) return
    const field = event.currentTarget
    const start = field.selectionStart
    event.preventDefault()
    field.setRangeText('  ', start, field.selectionEnd, 'end')
    handleEditorChange(field.value)
  }

  // Handle typing inside editor safely when folds are active
  const handleEditorChange = (newText) => {
    if (activeFolds && activeFolds.size > 0) {
      // Unfold on edit to prevent accidental overwriting of collapsed lines
      if (onExternalToggleFold) {
        activeFolds.forEach((line) => onExternalToggleFold(line))
      } else {
        setLocalFolds(new Set())
      }
      onChange(newText)
    } else {
      onChange(newText)
    }
  }

  return (
    <div className={`code-editor-frame ${className}`}>
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
                <span key={line} className={`java-source-line ${breakpoints.has(visibleLines[line]?.realLine) ? 'java-breakpoint-line' : ''}`}>
                  {tokens.length ? tokens.map(({ text, kind }, index) => kind ? <span className={`java-${kind}`} key={index}>{text}</span> : text) : '\u200b'}
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
            onChange={(event) => handleEditorChange(event.target.value)}
            onKeyDown={(event) => {
              if (isJava && event.ctrlKey && event.key === 'F8') {
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
                  {diagnostics.map(({ line, column, severity, message }, index) => (
                    <li
                      key={index}
                      style={{ cursor: line ? 'pointer' : 'default' }}
                      onClick={() => {
                        if (line) {
                          const targetOffset = rawLines.slice(0, line - 1).join('\n').length + Math.max(0, (column || 1) - 1)
                          jumpToOffset(targetOffset)
                        }
                      }}
                    >
                      <strong className={severity === 'error' ? 'java-diagnostic-error' : 'java-diagnostic-warning'}>
                        {line ? `Line ${line}${column ? `:${column}` : ''}` : 'File'} · {severity}
                      </strong>
                      <div>{message}</div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </details>
        )}
      </div>
    </div>
  )
}
