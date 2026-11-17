import React, { useEffect, useState, useRef, useCallback } from 'react'

export default function TerminalPanel({
  visible,
  workspace,
  onHide,
  isResizing,
  onResizeStart,
  onTouchResizeStart,
  onResizeReset
}) {
  const [tabs, setTabs] = useState([]) // [{ id, title, buffer, shell, cwd }]
  const [activeTabId, setActiveTabId] = useState(null)
  const [inputVal, setInputVal] = useState('')
  const [history, setHistory] = useState([])
  const [historyIdx, setHistoryIdx] = useState(-1)
  const [busy, setBusy] = useState(false)

  const outputRef = useRef(null)
  const inputRef = useRef(null)
  const eventSourcesRef = useRef(new Map())

  // Create a new terminal session
  const createNewSession = useCallback(async (title = null) => {
    try {
      setBusy(true)
      const res = await fetch('/api/terminal/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cwd: workspace || '' })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to start terminal')

      const tabTitle = title || `Local${tabs.length > 0 ? ` (${tabs.length + 1})` : ''}`
      const newTab = {
        id: data.id,
        title: tabTitle,
        shell: data.shell || 'powershell',
        cwd: data.cwd || workspace || '',
        buffer: ''
      }

      setTabs((prev) => [...prev, newTab])
      setActiveTabId(data.id)

      // Connect SSE stream
      const es = new EventSource(`/api/terminal/stream?id=${encodeURIComponent(data.id)}`)
      es.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data)
          if (payload.text) {
            setTabs((prevTabs) =>
              prevTabs.map((t) => (t.id === data.id ? { ...t, buffer: t.buffer + payload.text } : t))
            )
          }
        } catch {}
      }
      es.onerror = () => {
        // Fallback polling if SSE is disconnected
      }
      eventSourcesRef.current.set(data.id, es)
    } catch (err) {
      const fallbackTab = {
        id: 'err-' + Date.now(),
        title: 'Local',
        shell: 'shell',
        cwd: workspace || '',
        buffer: `Could not connect to terminal backend: ${err.message}\r\n`
      }
      setTabs((prev) => [...prev, fallbackTab])
      setActiveTabId(fallbackTab.id)
    } finally {
      setBusy(false)
    }
  }, [workspace, tabs.length])

  // Initialize first terminal session when made visible
  useEffect(() => {
    if (visible && tabs.length === 0) {
      void createNewSession('Local')
    }
  }, [visible, tabs.length, createNewSession])

  // Cleanup event sources on unmount
  useEffect(() => {
    const sources = eventSourcesRef.current
    return () => {
      for (const es of sources.values()) {
        try { es.close() } catch {}
      }
      sources.clear()
    }
  }, [])

  // Auto-scroll output when content changes or tab switches
  const activeTab = tabs.find((t) => t.id === activeTabId) || tabs[0]
  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight
    }
  }, [activeTab?.buffer, activeTabId])

  // Auto-focus input when panel is clicked or visible
  useEffect(() => {
    if (visible) {
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [visible, activeTabId])

  // Send input to terminal
  const sendCommand = async (cmd) => {
    if (!activeTab || !activeTab.id || activeTab.id.startsWith('err-')) return
    const textToSend = cmd !== undefined ? cmd : inputVal
    const trimmed = textToSend.trim()
    if (trimmed) {
      setHistory((prev) => [...prev, trimmed])
      setHistoryIdx(-1)
    }
    setInputVal('')

    try {
      await fetch('/api/terminal/input', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: activeTab.id,
          input: textToSend + '\r\n'
        })
      })
    } catch {}
  }

  // Close tab
  const closeTab = async (e, tabId) => {
    e.stopPropagation()
    const es = eventSourcesRef.current.get(tabId)
    if (es) {
      try { es.close() } catch {}
      eventSourcesRef.current.delete(tabId)
    }
    try {
      fetch('/api/terminal/session', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: tabId })
      }).catch(() => {})
    } catch {}

    const nextTabs = tabs.filter((t) => t.id !== tabId)
    setTabs(nextTabs)
    if (activeTabId === tabId) {
      setActiveTabId(nextTabs[0]?.id || null)
    }
  }

  // Clear current buffer
  const clearBuffer = () => {
    if (!activeTab) return
    setTabs((prev) =>
      prev.map((t) => (t.id === activeTab.id ? { ...t, buffer: '' } : t))
    )
  }

  // Handle keyboard events in input
  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      void sendCommand()
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      if (history.length === 0) return
      const nextIdx = historyIdx === -1 ? history.length - 1 : Math.max(0, historyIdx - 1)
      setHistoryIdx(nextIdx)
      setInputVal(history[nextIdx] || '')
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (history.length === 0 || historyIdx === -1) return
      const nextIdx = historyIdx + 1
      if (nextIdx >= history.length) {
        setHistoryIdx(-1)
        setInputVal('')
      } else {
        setHistoryIdx(nextIdx)
        setInputVal(history[nextIdx] || '')
      }
    } else if (e.ctrlKey && e.key.toLowerCase() === 'c') {
      // Send Ctrl+C break signal
      if (activeTab?.id) {
        fetch('/api/terminal/input', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: activeTab.id, input: '\x03' })
        }).catch(() => {})
      }
    } else if (e.ctrlKey && e.key.toLowerCase() === 'l') {
      e.preventDefault()
      clearBuffer()
    }
  }

  const promptPrefix = '›'

  return (
    <section className="maven-panel vcs-bottom-panel terminal-bottom-panel" aria-label="Terminal tool window" hidden={!visible}>
      <div
        className={`resizer-handle top ${isResizing ? 'active' : ''}`}
        onMouseDown={onResizeStart}
        onTouchStart={onTouchResizeStart}
        onDoubleClick={onResizeReset}
        title="Drag to resize Terminal tool window (Double-click to reset)"
      />

      {/* Terminal Header */}
      <div className="vcs-bottom-header">
        <div className="vcs-bottom-tabs" role="tablist">
          <strong className="vcs-header-title">Terminal</strong>
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              className={`vcs-tab-pill ${activeTabId === tab.id ? 'active' : ''}`}
              aria-selected={activeTabId === tab.id}
              onClick={() => setActiveTabId(tab.id)}
            >
              <span>{tab.title}</span>
              {tabs.length > 1 && (
                <span
                  className="terminal-tab-close"
                  onClick={(e) => void closeTab(e, tab.id)}
                  title="Close Terminal Tab"
                >
                  ×
                </span>
              )}
            </button>
          ))}
          <button
            type="button"
            className="vcs-header-icon-btn"
            title="New Terminal Session"
            disabled={busy}
            onClick={() => void createNewSession()}
          >
            ＋
          </button>
        </div>

        <div className="vcs-header-right-actions">
          <button type="button" className="vcs-header-icon-btn" title="Clear Buffer (Ctrl+L)" onClick={clearBuffer}>⊘</button>
          <button type="button" className="vcs-header-icon-btn" title="Rerun / Restart Terminal" onClick={() => void createNewSession()}>↻</button>
          <button type="button" className="vcs-header-icon-btn" onClick={onHide} title="Hide Terminal" aria-label="Hide Terminal panel">−</button>
        </div>
      </div>

      {/* Terminal Screen Body */}
      <div
        className="terminal-body"
        onClick={() => inputRef.current?.focus()}
      >
        <pre ref={outputRef} className="terminal-output-pre">
          {activeTab?.buffer || ''}
        </pre>

        {/* Interactive Prompt Line */}
        <div className="terminal-prompt-row">
          <span className="terminal-prompt-label">{promptPrefix}</span>
          <input
            ref={inputRef}
            type="text"
            className="terminal-input"
            value={inputVal}
            onChange={(e) => setInputVal(e.target.value)}
            onKeyDown={handleKeyDown}
            autoFocus
            spellCheck="false"
            autoComplete="off"
            placeholder="Type command and press Enter…"
          />
        </div>
      </div>
    </section>
  )
}
