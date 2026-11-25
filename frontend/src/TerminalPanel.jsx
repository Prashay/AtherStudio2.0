import React, { useEffect, useState, useRef, useCallback } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import PopIcon from './PopupIcons.jsx'

// Read a CSS custom property from the app so the terminal follows the active theme.
function cssVar(name, fallback) {
  const el = document.querySelector('.app') || document.documentElement
  const value = getComputedStyle(el).getPropertyValue(name).trim()
  return value || fallback
}

function terminalTheme() {
  const light = /^(light|pearl)$/.test(document.documentElement.dataset.workbenchTheme || '')
  const accent = cssVar('--ui-accent', '#ff7624')
  return light ? {
    background: '#00000000', foreground: '#1d1d1f', cursor: accent, cursorAccent: '#ffffff', selectionBackground: '#0071e333',
    black: '#1d1d1f', red: '#c4302b', green: '#2f7d32', yellow: '#9a6700', blue: '#0057b8', magenta: '#8e3ab0', cyan: '#00798c', white: '#6e6e73',
    brightBlack: '#6e6e73', brightRed: '#e0443e', brightGreen: '#3a9a3f', brightYellow: '#b58100', brightBlue: '#1a73e8', brightMagenta: '#a64fc9', brightCyan: '#0095ad', brightWhite: '#1d1d1f'
  } : {
    background: '#00000000', foreground: '#e8e2dc', cursor: accent, cursorAccent: '#161414', selectionBackground: '#ffffff30',
    black: '#2b2726', red: '#ff6b6b', green: '#8fd18a', yellow: '#f2c46d', blue: '#79b8ff', magenta: '#d79bf2', cyan: '#7fd6d6', white: '#d8d2cc',
    brightBlack: '#7b726d', brightRed: '#ff8f8f', brightGreen: '#a8e3a3', brightYellow: '#ffd88a', brightBlue: '#9ccaff', brightMagenta: '#e5b6f7', brightCyan: '#9ee6e6', brightWhite: '#ffffff'
  }
}

export default function TerminalPanel({
  visible,
  workspace,
  onHide,
  isResizing,
  onResizeStart,
  onTouchResizeStart,
  onResizeReset
}) {
  const [tabs, setTabs] = useState([]) // [{ id, title, shell, cwd, pty, exited }]
  const [activeTabId, setActiveTabId] = useState(null)
  const [busy, setBusy] = useState(false)
  const hostRefs = useRef(new Map()) // id -> container div
  const sessions = useRef(new Map()) // id -> { term, fit, es, sendQueue, timer, lineBuffer }
  const counter = useRef(0)

  const post = (url, body) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).catch(() => {})

  const flushInput = (id) => {
    const s = sessions.current.get(id)
    if (!s || !s.sendQueue) return
    const input = s.sendQueue
    s.sendQueue = ''
    s.timer = null
    void post('/api/terminal/input', { id, input })
  }

  const sendInput = (id, data) => {
    const s = sessions.current.get(id)
    if (!s) return
    s.sendQueue += data
    if (!s.timer) s.timer = setTimeout(() => flushInput(id), 4)
  }

  const fitSession = useCallback((id) => {
    const s = sessions.current.get(id)
    const host = hostRefs.current.get(id)
    if (!s || !host || !host.offsetWidth || !host.offsetHeight) return
    try { s.fit.fit() } catch { return }
    const { cols, rows } = s.term
    if (cols !== s.cols || rows !== s.rows) {
      s.cols = cols
      s.rows = rows
      void post('/api/terminal/resize', { id, cols, rows })
    }
  }, [])

  const attachTerminal = useCallback((id, info) => {
    const host = hostRefs.current.get(id)
    if (!host || sessions.current.has(id)) return
    const term = new Terminal({
      fontFamily: cssVar('--ui-mono', "'JetBrains Mono', 'Fira Code', 'Cascadia Code', Menlo, Consolas, monospace"),
      fontSize: 13,
      lineHeight: 1.25,
      cursorBlink: true,
      cursorStyle: 'bar',
      allowTransparency: true,
      scrollback: 10000,
      convertEol: !info.pty,
      macOptionIsMeta: true,
      theme: terminalTheme()
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(host)
    const s = { term, fit, es: null, sendQueue: '', timer: null, lineBuffer: '', cols: 0, rows: 0, pty: info.pty }
    sessions.current.set(id, s)

    // Copy / paste like a desktop IDE terminal.
    term.attachCustomKeyEventHandler((event) => {
      if (event.type !== 'keydown') return true
      const mod = event.ctrlKey || event.metaKey
      if (mod && event.shiftKey && event.key.toLowerCase() === 'c') {
        const text = term.getSelection()
        if (text) navigator.clipboard?.writeText(text).catch(() => {})
        return false
      }
      if (mod && event.shiftKey && event.key.toLowerCase() === 'v') return false // native paste event handles it
      if (event.metaKey && event.key.toLowerCase() === 'c' && term.hasSelection()) {
        navigator.clipboard?.writeText(term.getSelection()).catch(() => {})
        return false
      }
      if (event.ctrlKey && !event.shiftKey && event.key.toLowerCase() === 'c' && term.hasSelection()) {
        navigator.clipboard?.writeText(term.getSelection()).catch(() => {})
        term.clearSelection()
        return false
      }
      return true
    })

    term.onData((data) => {
      if (s.pty) { sendInput(id, data); return }
      // Pipe mode (Windows without PTY): simple local line editing with echo.
      for (const ch of data) {
        if (ch === '\r') { term.write('\r\n'); sendInput(id, s.lineBuffer + '\r\n'); s.lineBuffer = '' }
        else if (ch === '\x7f') { if (s.lineBuffer) { s.lineBuffer = s.lineBuffer.slice(0, -1); term.write('\b \b') } }
        else if (ch === '\x03') { s.lineBuffer = ''; term.write('^C\r\n'); sendInput(id, '\x03') }
        else if (ch >= ' ' || ch === '\t') { s.lineBuffer += ch; term.write(ch) }
      }
    })

    const es = new EventSource(`/api/terminal/stream?id=${encodeURIComponent(id)}`)
    es.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data)
        if (payload.text) term.write(payload.text)
        if (/\[Process completed with exit code/.test(payload.text || '')) {
          setTabs((prev) => prev.map((t) => (t.id === id ? { ...t, exited: true } : t)))
        }
      } catch {}
    }
    s.es = es
    requestAnimationFrame(() => { fitSession(id); term.focus() })
  }, [fitSession])

  const createNewSession = useCallback(async () => {
    setBusy(true)
    try {
      const res = await fetch('/api/terminal/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cwd: workspace || '', cols: 120, rows: 30 })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to start terminal')
      counter.current += 1
      const tab = { id: data.id, title: counter.current === 1 ? 'Local' : `Local (${counter.current})`, shell: data.shell || 'shell', cwd: data.cwd || workspace || '', pty: Boolean(data.pty) }
      setTabs((prev) => [...prev, tab])
      setActiveTabId(data.id)
    } catch (err) {
      const id = 'err-' + Date.now()
      setTabs((prev) => [...prev, { id, title: 'Local', shell: 'shell', cwd: '', pty: false, error: err.message }])
      setActiveTabId(id)
    } finally {
      setBusy(false)
    }
  }, [workspace])

  // Start the first session when the panel opens.
  useEffect(() => {
    if (visible && tabs.length === 0 && !busy) void createNewSession()
  }, [visible, tabs.length, busy, createNewSession])

  // Attach xterm to every new tab once its host div exists.
  useEffect(() => {
    for (const tab of tabs) {
      if (!tab.error) attachTerminal(tab.id, tab)
    }
  }, [tabs, attachTerminal])

  // Refit on panel resize / tab switch / visibility change.
  useEffect(() => {
    if (!visible || !activeTabId) return
    const host = hostRefs.current.get(activeTabId)
    const s = sessions.current.get(activeTabId)
    requestAnimationFrame(() => { fitSession(activeTabId); s?.term.focus() })
    if (!host || typeof ResizeObserver === 'undefined') return
    let frame = 0
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => fitSession(activeTabId))
    })
    observer.observe(host)
    return () => { observer.disconnect(); cancelAnimationFrame(frame) }
  }, [visible, activeTabId, fitSession])

  // Follow theme changes (data-theme / data-workbench-theme on <html>).
  useEffect(() => {
    const observer = new MutationObserver(() => {
      const theme = terminalTheme()
      for (const s of sessions.current.values()) s.term.options.theme = theme
    })
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'data-workbench-theme', 'style'] })
    return () => observer.disconnect()
  }, [])

  // Dispose everything on unmount.
  useEffect(() => {
    const all = sessions.current
    return () => {
      for (const [id, s] of all) {
        try { s.es?.close() } catch {}
        try { s.term.dispose() } catch {}
        void fetch('/api/terminal/session', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) }).catch(() => {})
      }
      all.clear()
    }
  }, [])

  const closeTab = (event, tabId) => {
    event.stopPropagation()
    const s = sessions.current.get(tabId)
    if (s) {
      try { s.es?.close() } catch {}
      try { s.term.dispose() } catch {}
      sessions.current.delete(tabId)
    }
    hostRefs.current.delete(tabId)
    if (!tabId.startsWith('err-')) {
      void fetch('/api/terminal/session', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: tabId }) }).catch(() => {})
    }
    const next = tabs.filter((t) => t.id !== tabId)
    setTabs(next)
    if (activeTabId === tabId) setActiveTabId(next.at(-1)?.id || null)
    if (!next.length) onHide?.()
  }

  const clearBuffer = () => {
    const s = sessions.current.get(activeTabId)
    if (!s) return
    s.term.clear()
    if (s.pty) sendInput(activeTabId, '\x0c')
    s.term.focus()
  }

  const restartActive = async () => {
    const current = activeTabId
    await createNewSession()
    if (current) {
      const s = sessions.current.get(current)
      if (s) {
        try { s.es?.close() } catch {}
        try { s.term.dispose() } catch {}
        sessions.current.delete(current)
      }
      hostRefs.current.delete(current)
      if (!current.startsWith('err-')) {
        void fetch('/api/terminal/session', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: current }) }).catch(() => {})
      }
      setTabs((prev) => prev.filter((t) => t.id !== current))
    }
  }

  const activeTab = tabs.find((t) => t.id === activeTabId)

  return (
    <section className="maven-panel vcs-bottom-panel terminal-bottom-panel" aria-label="Terminal tool window" hidden={!visible}>
      <div
        className={`resizer-handle top ${isResizing ? 'active' : ''}`}
        onMouseDown={onResizeStart}
        onTouchStart={onTouchResizeStart}
        onDoubleClick={onResizeReset}
        title="Drag to resize Terminal tool window (Double-click to reset)"
      />

      <div className="vcs-bottom-header">
        <div className="vcs-bottom-tabs" role="tablist">
          <strong className="vcs-header-title"><PopIcon name="terminal" size={14} /> Terminal</strong>
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              className={`vcs-tab-pill terminal-tab ${activeTabId === tab.id ? 'active' : ''} ${tab.exited ? 'exited' : ''}`}
              aria-selected={activeTabId === tab.id}
              title={`${tab.shell} — ${tab.cwd}`}
              onClick={() => setActiveTabId(tab.id)}
            >
              <span>{tab.title}</span>
              <span className="terminal-tab-close" role="button" aria-label={`Close ${tab.title}`} onClick={(e) => closeTab(e, tab.id)}>
                <PopIcon name="close" size={11} />
              </span>
            </button>
          ))}
          <button type="button" className="vcs-header-icon-btn" title="New Terminal Tab" aria-label="New Terminal Tab" disabled={busy} onClick={() => void createNewSession()}>
            <PopIcon name="plus" size={14} />
          </button>
        </div>

        <div className="vcs-header-right-actions">
          {activeTab && !activeTab.pty && !activeTab.error && <span className="terminal-mode-tag" title="No PTY available: basic line mode">Line mode</span>}
          <button type="button" className="vcs-header-icon-btn" title="Clear (Ctrl+L)" aria-label="Clear terminal" onClick={clearBuffer}><PopIcon name="ban" size={14} /></button>
          <button type="button" className="vcs-header-icon-btn" title="Restart Session" aria-label="Restart terminal session" onClick={() => void restartActive()}><PopIcon name="refresh" size={14} /></button>
          <button type="button" className="vcs-header-icon-btn" onClick={onHide} title="Hide Terminal" aria-label="Hide Terminal panel"><PopIcon name="minus" size={14} /></button>
        </div>
      </div>

      <div className="terminal-body xterm-body">
        {tabs.map((tab) => (
          tab.error ? (
            <div key={tab.id} className="terminal-error" hidden={tab.id !== activeTabId}>
              <PopIcon name="alert" size={14} /> Could not start the terminal: {tab.error}
            </div>
          ) : (
            <div
              key={tab.id}
              className="terminal-xterm-host"
              hidden={tab.id !== activeTabId}
              ref={(el) => { if (el) hostRefs.current.set(tab.id, el) }}
              onMouseDown={() => sessions.current.get(tab.id)?.term.focus()}
            />
          )
        ))}
      </div>
    </section>
  )
}
