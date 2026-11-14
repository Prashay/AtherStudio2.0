import React, { useEffect, useMemo, useRef, useState } from 'react'
import { javaHighlight } from './javaHighlight.js'

export default function CodeEditor({ path, value, onChange, fontSize, wordWrap, jump, mainLine, onRunMain, onDebugMain, workspace, breakpointLines = [], onToggleBreakpoint, className = '' }) {
  const gutter = useRef(null)
  const diagnosticsGutter = useRef(null)
  const editor = useRef(null)
  const highlight = useRef(null)
  const [runMenu, setRunMenu] = useState(null)
  const [validation, setValidation] = useState(null)
  const java = /\.java$/i.test(path)
  const highlighted = useMemo(() => java ? javaHighlight(path, value.replace(/\r\n?/g, '\n')) : null, [java, path, value])
  const result = validation?.path === path && validation.source === value && validation.workspace === workspace ? validation : null
  const diagnostics = result?.diagnostics || []
  const problemCount = diagnostics.length
  const hasErrors = diagnostics.some(({ severity }) => severity === 'error')
  const diagnosticStatus = !result ? 'pending'
    : hasErrors ? 'error'
    : result.error || problemCount > 0 ? 'warning'
    : 'success'
  const diagnosticLabel = !result ? 'Checking Java'
    : result.error ? 'Compiler validation unavailable'
    : problemCount ? `${problemCount} compiler ${problemCount === 1 ? 'diagnostic' : 'diagnostics'}`
    : 'No compiler errors'
  const byLine = new Map()
  for (const item of diagnostics) {
    const line = item.line || 1
    if (!byLine.has(line)) byLine.set(line, [])
    byLine.get(line).push(item)
  }
  if (result?.error) byLine.set(1, [{ severity: 'warning', message: result.error }])
  const breakpoints = new Set(breakpointLines)
  useEffect(() => {
    if (!java) return
    const controller = new AbortController()
    const timer = setTimeout(async () => {
      try {
        const response = await fetch('/api/java/validate', {
          method: 'POST', signal: controller.signal, headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ file: path, source: value, workspace })
        })
        const data = await response.json()
        if (!response.ok) throw new Error(data.error || 'Java validation is unavailable.')
        if (!controller.signal.aborted) setValidation({ path, source: value, workspace, diagnostics: data.diagnostics })
      } catch (error) {
        if (!controller.signal.aborted) setValidation({ path, source: value, workspace, error: error instanceof SyntaxError ? 'Java validation is unavailable. Restart the app backend.' : error.message })
      }
    }, 700)
    return () => { clearTimeout(timer); controller.abort() }
  }, [java, path, value, workspace])
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
  useEffect(() => {
    if (jump?.path !== path || !editor.current) return
    const field = editor.current
    const line = field.value.slice(0, jump.offset).split('\n').length
    field.focus()
    field.setSelectionRange(jump.offset, jump.offset)
    field.scrollTop = Math.max(0, (line - 3) * parseFloat(getComputedStyle(field).lineHeight))
    syncScroll(field)
  }, [jump, path])
  useEffect(() => {
    const field = editor.current
    if (!java || !field) return
    const align = () => {
      syncScroll(field)
      if (wordWrap) {
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
  }, [java, value, wordWrap, fontSize])
  const indent = (event) => {
    if (event.key !== 'Tab' || event.shiftKey || event.ctrlKey || event.altKey || event.metaKey) return
    const field = event.currentTarget
    const start = field.selectionStart
    event.preventDefault()
    field.setRangeText('  ', start, field.selectionEnd, 'end')
    onChange(field.value)
  }

  return (
    <div className={`code-editor-frame ${className}`}>
    <div className={`code-editor ${java ? 'java-editor' : ''}`} style={{ '--editor-size': `${fontSize}px` }}>
      {(!wordWrap || java) && (
        <div className="code-gutter" ref={gutter}>
          {value.split('\n').map((_, index) => <div className="code-gutter-line" key={index}>
            {java && <button type="button" className="breakpoint-toggle" tabIndex={breakpoints.has(index + 1) ? 0 : -1}
              aria-label={`Breakpoint on line ${index + 1}`} aria-pressed={breakpoints.has(index + 1)}
              title={`${breakpoints.has(index + 1) ? 'Remove' : 'Add'} breakpoint on line ${index + 1}`}
              onClick={() => onToggleBreakpoint?.(index + 1)} />}
            {index + 1 === mainLine && <button type="button" className="gutter-main-action" aria-label="Main method run actions" aria-expanded={Boolean(runMenu)} onClick={(event) => {
              const row = event.currentTarget.getBoundingClientRect()
              const surface = event.currentTarget.closest('.code-editor').getBoundingClientRect()
              setRunMenu(runMenu ? null : { top: Math.max(0, Math.min(row.top - surface.top, surface.height - 80)), left: row.right - surface.left + 4 })
            }}>▷</button>}
            <span aria-hidden="true">{index + 1}</span>
          </div>)}
        </div>
      )}
      {runMenu && <div className="gutter-run-menu" style={runMenu} onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setRunMenu(null) }} onKeyDown={(event) => { if (event.key === 'Escape') setRunMenu(null) }}>
        <button autoFocus onClick={() => { setRunMenu(false); onRunMain?.() }}>Run main()</button>
        <button disabled={!onDebugMain} onClick={() => { setRunMenu(false); onDebugMain?.() }}>Debug main()</button>
      </div>}
      <div className="code-editor-field">
      {highlighted && <pre ref={highlight} className={`java-highlight ${wordWrap ? 'wrap' : ''}`} aria-hidden="true">
        {highlighted.map((tokens, line) => <span key={line} className={`java-source-line ${breakpoints.has(line + 1) ? 'java-breakpoint-line' : ''}`}>
          {tokens.length ? tokens.map(({ text, kind }, index) => kind ? <span className={`java-${kind}`} key={index}>{text}</span> : text) : '\u200b'}
        </span>)}
      </pre>}
      <textarea
        ref={editor}
        className="editor"
        aria-label={`Edit ${path}`}
        value={value}
        wrap={wordWrap ? 'soft' : 'off'}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (java && event.ctrlKey && event.key === 'F8') {
            event.preventDefault()
            onToggleBreakpoint?.(event.currentTarget.value.slice(0, event.currentTarget.selectionStart).split('\n').length)
          } else indent(event)
        }}
        onScroll={(event) => { syncScroll(event.currentTarget); if (runMenu) setRunMenu(null) }}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
      />
      </div>
      {java && <div className="java-diagnostics-gutter" ref={diagnosticsGutter} aria-label="Compiler diagnostics">
        {highlighted.map((_, index) => {
          const items = byLine.get(index + 1)
          return <div className="java-diagnostic-row" key={index}>{items && (
            <span className={items.some((item) => item.severity === 'error') ? 'java-diagnostic-error' : 'java-diagnostic-warning'}
              tabIndex={0} title={items.map(({ severity, message }) => `${severity}: ${message}`).join('\n')}
              aria-label={`Line ${index + 1}. ${items.map(({ severity, message }) => `${severity}: ${message}`).join('. ')}`}>!</span>
          )}</div>
        })}
      </div>}
      {java && <details className="java-diagnostics-popover" onKeyDown={(event) => {
        if (event.key !== 'Escape' || !event.currentTarget.open) return
        event.stopPropagation()
        event.currentTarget.open = false
        event.currentTarget.querySelector('summary').focus()
      }}>
        <summary className={`java-diagnostics-status is-${diagnosticStatus}`} title={diagnosticLabel} aria-label={`Compiler diagnostics. ${diagnosticLabel}`}>
          <span aria-hidden="true">{diagnosticStatus === 'success' ? '✓' : diagnosticStatus === 'pending' ? '…' : '!'}</span>
          <span className="java-diagnostics-label">Compiler diagnostics{problemCount > 0 ? ` (${problemCount})` : ''}</span>
        </summary>
        <div className="java-diagnostics-list">
          {result?.error && <p>{result.error}</p>}
          {!result && <p>Checking Java…</p>}
          {result && !result.error && problemCount === 0 && <p>No compiler diagnostics.</p>}
          {problemCount > 0 && <ul>
            {diagnostics.map(({ line, column, severity, message }, index) => <li key={index}>
              <strong className={severity === 'error' ? 'java-diagnostic-error' : 'java-diagnostic-warning'}>
                {line ? `Line ${line}${column ? `:${column}` : ''}` : 'File'} · {severity}
              </strong>
              <div>{message}</div>
            </li>)}
          </ul>}
        </div>
      </details>}
    </div>
    </div>
  )
}
