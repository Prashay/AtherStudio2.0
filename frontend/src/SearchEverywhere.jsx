import React, { useEffect, useMemo, useRef, useState } from 'react'

export default function SearchEverywhere({ tree, tabs, actions, onOpen, onClose }) {
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(0)
  const list = useRef(null)
  const files = useMemo(() => {
    const paths = new Map(tabs.map(({ path }) => [path, path.split(/[\\/]/).pop()]))
    const visit = (node) => {
      if (node.type === 'file') paths.set(node.path, (node.name || node.path).split(/[\\/]/).pop())
      else node.children?.forEach(visit)
    }
    if (tree) visit(tree)
    return Array.from(paths, ([path, name]) => ({
      name: name || path.split(/[\\/]/).pop(),
      path,
      folder: path.split(/[\\/]/).slice(0, -1).pop() || '',
      run: () => onOpen(path)
    }))
  }, [tree, tabs, onOpen])

  const needle = query.trim().toLowerCase()
  const results = [...actions, ...files].filter(({ name, path }) =>
    name.toLowerCase().includes(needle) || path?.toLowerCase().includes(needle)
  ).sort((a, b) => Number(b.name.toLowerCase().startsWith(needle)) - Number(a.name.toLowerCase().startsWith(needle))).slice(0, 50)

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
      <section className="modal search-everywhere" role="dialog" aria-modal="true" aria-label="Search Everywhere" onClick={(event) => event.stopPropagation()}>
        <input
          autoFocus
          aria-label="Search files and actions"
          placeholder="Search files and actions"
          value={query}
          onChange={(event) => { setQuery(event.target.value); setSelected(0) }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') onClose()
            if (event.key === 'Enter') run(results[selected])
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault()
              const direction = event.key === 'ArrowDown' ? 1 : -1
              setSelected((index) => Math.max(0, Math.min(results.length - 1, index + direction)))
            }
          }}
        />
        <ul ref={list}>
          {results.map((item, index) => (
            <li key={item.path || item.name}>
              <button className={index === selected ? 'on' : ''} onClick={() => run(item)}>
                <span>{item.name}</span>
                <small>{item.folder ? `${item.folder}/` : item.path ? 'file' : 'Action'}</small>
              </button>
            </li>
          ))}
        </ul>
        {!results.length && <p>No matching files or actions.</p>}
      </section>
    </div>
  )
}
