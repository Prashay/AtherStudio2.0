import React, { useEffect, useMemo, useRef, useState } from 'react'

export default function SearchEverywhere({ tree, tabs = [], actions = [], onOpen, onClose }) {
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(0)
  const [activeTab, setActiveTab] = useState('all') // 'all' | 'files' | 'actions'
  const [serverFiles, setServerFiles] = useState([])
  const list = useRef(null)

  // Fetch all files from the server so we aren't limited to expanded tree nodes
  useEffect(() => {
    let active = true
    fetch('/api/files')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (active && Array.isArray(data?.files)) {
          setServerFiles(data.files)
        }
      })
      .catch(() => {})
    return () => {
      active = false
    }
  }, [])

  const files = useMemo(() => {
    const paths = new Map()

    // 1. Add all server files (all workspace files regardless of tree expansion)
    for (const p of serverFiles) {
      if (p) paths.set(p, p.split(/[\\/]/).pop())
    }

    // 2. Add open tabs
    for (const { path } of tabs) {
      if (path) paths.set(path, path.split(/[\\/]/).pop())
    }

    // 3. Fallback: walk tree
    const visit = (node) => {
      if (node.type === 'file') paths.set(node.path, (node.name || node.path).split(/[\\/]/).pop())
      else node.children?.forEach(visit)
    }
    if (tree) visit(tree)

    return Array.from(paths, ([path, name]) => {
      const parts = path.split(/[\\/]/)
      const folder = parts.slice(0, -1).join('/')
      return {
        type: 'file',
        name: name || parts.pop() || path,
        path,
        folder,
        run: () => onOpen(path)
      }
    })
  }, [serverFiles, tabs, tree, onOpen])

  const actionItems = useMemo(
    () =>
      actions.map((act) => ({
        type: 'action',
        name: act.name,
        path: '',
        folder: '',
        run: act.run
      })),
    [actions]
  )

  const needle = query.trim().toLowerCase()

  const results = useMemo(() => {
    let pool = []
    if (activeTab === 'all') pool = [...files, ...actionItems]
    else if (activeTab === 'files') pool = files
    else if (activeTab === 'actions') pool = actionItems

    if (!needle) {
      return pool.slice(0, 60)
    }

    return pool
      .filter(({ name, path }) => name.toLowerCase().includes(needle) || path?.toLowerCase().includes(needle))
      .sort((a, b) => {
        const aName = a.name.toLowerCase()
        const bName = b.name.toLowerCase()
        // Exact match first
        if (aName === needle && bName !== needle) return -1
        if (bName === needle && aName !== needle) return 1
        // Name starts with query
        const aStarts = aName.startsWith(needle)
        const bStarts = bName.startsWith(needle)
        if (aStarts && !bStarts) return -1
        if (bStarts && !aStarts) return 1
        // Prefer shorter name
        if (aName.length !== bName.length) return aName.length - bName.length
        return aName.localeCompare(bName)
      })
      .slice(0, 60)
  }, [activeTab, files, actionItems, needle])

  useEffect(() => {
    list.current?.children[selected]?.scrollIntoView({ block: 'nearest' })
  }, [selected])

  const run = (item) => {
    if (!item) return
    onClose()
    item.run()
  }

  return (
    <div className="modal-back" onClick={onClose}>
      <section
        className="modal search-everywhere"
        role="dialog"
        aria-modal="true"
        aria-label="Search Everywhere"
        onClick={(event) => event.stopPropagation()}
      >
        <div style={{ display: 'flex', gap: '6px', padding: '8px 12px 4px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
          {[
            { id: 'all', label: 'All' },
            { id: 'files', label: 'Files' },
            { id: 'actions', label: 'Actions' }
          ].map(({ id, label }) => (
            <button
              key={id}
              type="button"
              className={`ghost tiny ${activeTab === id ? 'primary' : ''}`}
              style={{
                fontSize: '11px',
                padding: '2px 8px',
                borderRadius: '4px',
                background: activeTab === id ? 'rgba(74, 158, 255, 0.2)' : 'transparent',
                color: activeTab === id ? '#58a6ff' : 'var(--muted, #8b949e)',
                border: activeTab === id ? '1px solid rgba(74, 158, 255, 0.4)' : '1px solid transparent'
              }}
              onClick={() => {
                setActiveTab(id)
                setSelected(0)
              }}
            >
              {label}
            </button>
          ))}
        </div>

        <input
          autoFocus
          aria-label="Search all files and actions"
          placeholder="Search all files, classes, and actions (Double Shift)"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value)
            setSelected(0)
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') onClose()
            if (event.key === 'Enter') run(results[selected])
            if (event.key === 'Tab') {
              event.preventDefault()
              const tabsList = ['all', 'files', 'actions']
              const nextIndex = (tabsList.indexOf(activeTab) + (event.shiftKey ? -1 : 1) + tabsList.length) % tabsList.length
              setActiveTab(tabsList[nextIndex])
              setSelected(0)
            }
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault()
              const direction = event.key === 'ArrowDown' ? 1 : -1
              setSelected((index) => Math.max(0, Math.min(results.length - 1, index + direction)))
            }
          }}
        />

        <ul ref={list}>
          {results.map((item, index) => (
            <li key={(item.path || item.name) + ':' + index}>
              <button className={index === selected ? 'on' : ''} onClick={() => run(item)}>
                <span>{item.name}</span>
                <small title={item.path || item.name}>
                  {item.folder ? `${item.folder}/` : item.type === 'file' ? 'file' : 'Action'}
                </small>
              </button>
            </li>
          ))}
        </ul>
        {!results.length && <p style={{ padding: '16px', color: 'var(--muted, #888)' }}>No matching files or actions.</p>}
      </section>
    </div>
  )
}
