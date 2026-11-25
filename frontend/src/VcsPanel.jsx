import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react'
import PopIcon from './PopupIcons.jsx'
import TreeIcon, { fileIconName } from './TreeIcon.jsx'

export function VcsBranchWidget({
  workspace,
  vcsState,
  onRefresh,
  onOpenCommit,
  onOpenGitLog
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [promptMode, setPromptMode] = useState(null) // 'newBranch' | 'checkoutRev' | 'renameBranch' | null
  const [promptInput, setPromptInput] = useState('')
  const [promptExtra, setPromptExtra] = useState('')
  const [selectedBranchMenu, setSelectedBranchMenu] = useState(null) // { name, isRemote, current }
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState('')
  const wrapRef = useRef(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) {
        setOpen(false)
        setPromptMode(null)
        setSelectedBranchMenu(null)
      }
    }
    const onKey = (e) => {
      if (e.key === 'Escape') {
        if (selectedBranchMenu) {
          setSelectedBranchMenu(null)
        } else if (promptMode) {
          setPromptMode(null)
        } else {
          setOpen(false)
        }
      }
    }
    window.addEventListener('pointerdown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointerdown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open, promptMode, selectedBranchMenu])

  const runGitAction = async (action, extra = {}) => {
    setBusy(true)
    setToast('')
    try {
      const res = await fetch('/api/vcs/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ...extra })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Git operation failed')
      setToast(data.output || 'Done')
      await onRefresh?.()
      setPromptMode(null)
      setPromptInput('')
      setPromptExtra('')
      setSelectedBranchMenu(null)
    } catch (err) {
      setToast(err.message)
    } finally {
      setBusy(false)
    }
  }

  const rawBranchName = vcsState?.branch || 'main'
  const branchName = vcsState?.isRepo ? rawBranchName : 'Version Control'
  const aheadBehindStr = (vcsState?.ahead ? ` ↑${vcsState.ahead}` : '') + (vcsState?.behind ? ` ↓${vcsState.behind}` : '')

  const localBranches = (vcsState?.branches || []).filter((b) =>
    !query.trim() || b.name.toLowerCase().includes(query.trim().toLowerCase())
  )
  const remoteBranches = (vcsState?.remoteBranches || []).filter((b) =>
    !query.trim() || b.name.toLowerCase().includes(query.trim().toLowerCase())
  )
  const tags = (vcsState?.tags || []).filter((t) =>
    !query.trim() || t.toLowerCase().includes(query.trim().toLowerCase())
  )

  return (
    <div className="vcs-topbar-widget" ref={wrapRef}>
      <button
        type="button"
        className={`vcs-topbar-trigger ${open ? 'open' : ''}`}
        onClick={() => setOpen(!open)}
        title={vcsState?.isRepo ? `Git Branch: ${branchName}${aheadBehindStr}${vcsState?.remote ? ` (tracking ${vcsState.remote})` : ''}` : 'Git Version Control'}
      >
        <svg className="vcs-branch-svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
          <line x1="6" y1="3" x2="6" y2="15" />
          <circle cx="18" cy="6" r="3" />
          <circle cx="6" cy="18" r="3" />
          <path d="M18 9a9 9 0 0 1-9 9" />
        </svg>
        <span className="vcs-topbar-branch-name">{branchName}{aheadBehindStr}</span>
        {vcsState?.files?.length > 0 && <span className="vcs-topbar-dirty-dot" title={`${vcsState.files.length} uncommitted change(s)`} />}
        <span className="project-switcher-chevron" aria-hidden="true" />
      </button>

      {open && (
        <div className="vcs-branch-popup" role="dialog" aria-label="Git branches and actions">
          <div className="vcs-popup-search-row">
            <span className="vcs-popup-search-ico"><PopIcon name="search" size={14} /></span>
            <input
              type="text"
              autoFocus
              placeholder="Search for branches and actions"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <button type="button" className="ghost tiny" title="Refresh Git status" onClick={() => void onRefresh?.()}><PopIcon name="refresh" size={14} /></button>
          </div>

          {!vcsState?.isRepo ? (
            <div className="vcs-popup-section">
              <button
                type="button"
                className="vcs-popup-item"
                disabled={!workspace || busy}
                onClick={() => void runGitAction('init')}
              >
                <span className="vcs-popup-item-left">
                  <span className="vcs-popup-ico">＋</span>
                  <span>Initialize Git Repository…</span>
                </span>
              </button>
            </div>
          ) : (
            <>
              <div className="vcs-popup-section">
                <button
                  type="button"
                  className="vcs-popup-item"
                  disabled={busy}
                  onClick={() => void runGitAction('pull')}
                >
                  <span className="vcs-popup-item-left">
                    <span className="vcs-popup-ico"><PopIcon name="download" size={14} /></span>
                    <span>Update Project…</span>
                  </span>
                  <kbd>Ctrl+T</kbd>
                </button>
                <button
                  type="button"
                  className="vcs-popup-item"
                  onClick={() => {
                    setOpen(false)
                    onOpenCommit?.()
                  }}
                >
                  <span className="vcs-popup-item-left">
                    <span className="vcs-popup-ico"><PopIcon name="git" size={14} /></span>
                    <span>Commit…</span>
                  </span>
                  <kbd>Ctrl+K</kbd>
                </button>
                <button
                  type="button"
                  className="vcs-popup-item"
                  disabled={busy}
                  onClick={() => void runGitAction('push')}
                >
                  <span className="vcs-popup-item-left">
                    <span className="vcs-popup-ico"><PopIcon name="external" size={14} /></span>
                    <span>Push…</span>
                  </span>
                  <kbd>Ctrl+Shift+K</kbd>
                </button>
              </div>

              <div className="vcs-popup-divider" />

              <div className="vcs-popup-section">
                <button
                  type="button"
                  className={`vcs-popup-item ${promptMode === 'newBranch' ? 'active' : ''}`}
                  onClick={() => {
                    setPromptMode(promptMode === 'newBranch' ? null : 'newBranch')
                    setPromptInput('')
                  }}
                >
                  <span className="vcs-popup-item-left">
                    <span className="vcs-popup-ico">＋</span>
                    <span>New Branch…</span>
                  </span>
                  <kbd>Ctrl+Alt+N</kbd>
                </button>
                <button
                  type="button"
                  className={`vcs-popup-item ${promptMode === 'checkoutRev' ? 'active' : ''}`}
                  onClick={() => {
                    setPromptMode(promptMode === 'checkoutRev' ? null : 'checkoutRev')
                    setPromptInput('')
                  }}
                >
                  <span className="vcs-popup-item-left">
                    <span className="vcs-popup-ico"><PopIcon name="tag" size={14} /></span>
                    <span>Checkout Tag or Revision…</span>
                  </span>
                </button>
              </div>

              {promptMode && (
                <form
                  className="vcs-popup-inline-form"
                  onSubmit={(e) => {
                    e.preventDefault()
                    if (!promptInput.trim()) return
                    if (promptMode === 'newBranch') {
                      void runGitAction('checkout', { branch: promptInput.trim(), create: true })
                    } else if (promptMode === 'renameBranch') {
                      void runGitAction('renameBranch', { oldName: promptExtra, newName: promptInput.trim() })
                    } else {
                      void runGitAction('checkout', { branch: promptInput.trim() })
                    }
                  }}
                >
                  <input
                    type="text"
                    autoFocus
                    placeholder={
                      promptMode === 'newBranch' ? 'New branch name…' :
                      promptMode === 'renameBranch' ? `Rename '${promptExtra}' to…` :
                      'Branch, tag, or commit hash…'
                    }
                    value={promptInput}
                    onChange={(e) => setPromptInput(e.target.value)}
                  />
                  <button type="submit" className="primary tiny" disabled={busy || !promptInput.trim()}>
                    {promptMode === 'newBranch' ? 'Create' : promptMode === 'renameBranch' ? 'Rename' : 'Checkout'}
                  </button>
                  <button type="button" className="ghost tiny" onClick={() => setPromptMode(null)}><PopIcon name="close" size={14} /></button>
                </form>
              )}

              <div className="vcs-popup-divider" />

              {/* Local branches */}
              <details open className="vcs-popup-branches">
                <summary>Local ({localBranches.length})</summary>
                <div className="vcs-popup-branch-list">
                  {localBranches.map((b) => (
                    <div key={b.name} className="vcs-branch-item-wrap">
                      <button
                        type="button"
                        className={`vcs-popup-branch-item ${b.current ? 'current' : ''}`}
                        onClick={() => {
                          setSelectedBranchMenu(selectedBranchMenu?.name === b.name ? null : { name: b.name, isRemote: false, current: b.current })
                        }}
                      >
                        <span className="vcs-popup-branch-left">
                          <span className="vcs-tag-ico" aria-hidden="true">{b.current ? <PopIcon name="check" size={14} /> : <PopIcon name="tag" size={14} />}</span>
                          <strong style={{ fontWeight: b.current ? 700 : 400 }}>{b.name}</strong>
                          {b.current && <small style={{ color: '#6897bb', fontSize: 10 }}>(current)</small>}
                        </span>
                        <span className="vcs-branch-chevron">›</span>
                      </button>

                      {selectedBranchMenu?.name === b.name && !selectedBranchMenu.isRemote && (
                        <div className="vcs-branch-action-sheet" role="menu">
                          <div className="vcs-branch-action-sheet-header">
                            <span>Branch: {b.name}</span>
                            <button type="button" className="vcs-close-tiny" onClick={() => setSelectedBranchMenu(null)}><PopIcon name="close" size={14} /></button>
                          </div>
                          {!b.current && (
                            <button
                              type="button"
                              className="vcs-branch-action-btn"
                              disabled={busy}
                              onClick={() => {
                                setSelectedBranchMenu(null)
                                void runGitAction('checkout', { branch: b.name })
                              }}
                            >
                              <span>Checkout</span>
                            </button>
                          )}
                          <button
                            type="button"
                            className="vcs-branch-action-btn"
                            disabled={busy}
                            onClick={() => {
                              setSelectedBranchMenu(null)
                              setPromptMode('newBranch')
                              setPromptInput('')
                            }}
                          >
                            <span>New Branch from '{b.name}'…</span>
                          </button>
                          <button
                            type="button"
                            className="vcs-branch-action-btn"
                            disabled={busy}
                            onClick={() => {
                              setSelectedBranchMenu(null)
                              setPromptMode('renameBranch')
                              setPromptExtra(b.name)
                              setPromptInput(b.name)
                            }}
                          >
                            <span>Rename…</span>
                          </button>
                          {!b.current && (
                            <button
                              type="button"
                              className="vcs-branch-action-btn"
                              disabled={busy}
                              onClick={() => {
                                setSelectedBranchMenu(null)
                                void runGitAction('merge', { branch: b.name })
                              }}
                            >
                              <span>Merge into '{vcsState?.branch || 'HEAD'}'</span>
                            </button>
                          )}
                          {!b.current && (
                            <button
                              type="button"
                              className="vcs-branch-action-btn"
                              disabled={busy}
                              style={{ color: '#f75464' }}
                              onClick={() => {
                                setSelectedBranchMenu(null)
                                if (window.confirm(`Delete branch '${b.name}'?`)) {
                                  void runGitAction('deleteBranch', { branch: b.name })
                                }
                              }}
                            >
                              <span>Delete</span>
                            </button>
                          )}
                          <button
                            type="button"
                            className="vcs-branch-action-btn"
                            onClick={() => {
                              setSelectedBranchMenu(null)
                              setOpen(false)
                              onOpenGitLog?.()
                            }}
                          >
                            <span>Show in Git Log</span>
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </details>

              {/* Remote branches */}
              {remoteBranches.length > 0 && (
                <details open className="vcs-popup-branches">
                  <summary>Remote ({remoteBranches.length})</summary>
                  <div className="vcs-popup-branch-list">
                    {remoteBranches.map((rb) => (
                      <div key={rb.name} className="vcs-branch-item-wrap">
                        <button
                          type="button"
                          className="vcs-popup-branch-item"
                          onClick={() => {
                            setSelectedBranchMenu(selectedBranchMenu?.name === rb.name ? null : { name: rb.name, isRemote: true })
                          }}
                        >
                          <span className="vcs-popup-branch-left">
                            <span className="vcs-tag-ico" aria-hidden="true" style={{ color: 'var(--ui-accent)' }}><PopIcon name="cloud" size={14} /></span>
                            <span>{rb.name}</span>
                          </span>
                          <span className="vcs-branch-chevron">›</span>
                        </button>

                        {selectedBranchMenu?.name === rb.name && selectedBranchMenu.isRemote && (
                          <div className="vcs-branch-action-sheet" role="menu">
                            <div className="vcs-branch-action-sheet-header">
                              <span>Remote: {rb.name}</span>
                              <button type="button" className="vcs-close-tiny" onClick={() => setSelectedBranchMenu(null)}><PopIcon name="close" size={14} /></button>
                            </div>
                            <button
                              type="button"
                              className="vcs-branch-action-btn"
                              disabled={busy}
                              onClick={() => {
                                setSelectedBranchMenu(null)
                                void runGitAction('checkout', { branch: rb.name })
                              }}
                            >
                              <span>Checkout as New Local Branch…</span>
                            </button>
                            <button
                              type="button"
                              className="vcs-branch-action-btn"
                              disabled={busy}
                              onClick={() => {
                                setSelectedBranchMenu(null)
                                void runGitAction('merge', { branch: rb.name })
                              }}
                            >
                              <span>Merge into '{vcsState?.branch || 'HEAD'}'</span>
                            </button>
                            <button
                              type="button"
                              className="vcs-branch-action-btn"
                              onClick={() => {
                                setSelectedBranchMenu(null)
                                setOpen(false)
                                onOpenGitLog?.()
                              }}
                            >
                              <span>Show in Git Log</span>
                            </button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </details>
              )}

              {/* Tags */}
              {tags.length > 0 && (
                <details className="vcs-popup-branches">
                  <summary>Tags ({tags.length})</summary>
                  <div className="vcs-popup-branch-list">
                    {tags.map((t) => (
                      <button
                        type="button"
                        key={t}
                        className="vcs-popup-branch-item"
                        disabled={busy}
                        onClick={() => void runGitAction('checkout', { branch: t })}
                      >
                        <span className="vcs-popup-branch-left">
                          <span className="vcs-tag-ico" aria-hidden="true"><PopIcon name="tag" size={14} /></span>
                          <span>{t}</span>
                        </span>
                        <span className="vcs-branch-chevron">Checkout</span>
                      </button>
                    ))}
                  </div>
                </details>
              )}
            </>
          )}

          {toast && <div className="vcs-popup-toast" role="status">{toast}</div>}
        </div>
      )}
    </div>
  )
}

export function VcsCommitPanel({
  workspace,
  vcsState,
  onRefresh,
  onOpenFile,
  onClose,
  onOpenLog,
  onFileChanged
}) {
  const [commitMessage, setCommitMessage] = useState('')
  const [selectedPaths, setSelectedPaths] = useState(new Set())
  const [diffFile, setDiffFile] = useState(null)
  const [diffText, setDiffText] = useState('')
  const [busy, setBusy] = useState(false)
  const [amend, setAmend] = useState(false)
  const [statusMsg, setStatusMsg] = useState('')

  const files = vcsState?.files || []
  const stagedFiles = useMemo(() => files.filter((f) => f.staged), [files])
  const unstagedFiles = useMemo(() => files.filter((f) => !f.staged && !f.untracked), [files])
  const untrackedFiles = useMemo(() => files.filter((f) => f.untracked), [files])

  useEffect(() => {
    if (files.length > 0) {
      setSelectedPaths(new Set(files.map((f) => f.path)))
    } else {
      setSelectedPaths(new Set())
    }
  }, [files.length])

  const loadDiff = useCallback(async (filePath) => {
    if (!filePath) return
    setDiffFile(filePath)
    setDiffText('Loading diff…')
    try {
      const res = await fetch(`/api/vcs/diff?file=${encodeURIComponent(filePath)}`)
      const data = await res.json()
      setDiffText(data.diff || 'No diff available.')
    } catch {
      setDiffText('Failed to load diff.')
    }
  }, [])

  const runAction = async (action, extra = {}) => {
    setBusy(true)
    setStatusMsg('')
    try {
      const res = await fetch('/api/vcs/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ...extra })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'VCS action failed')
      setStatusMsg(data.output || 'Done')
      if (action === 'commit' || action === 'commitAndPush') {
        setCommitMessage('')
        setDiffFile(null)
        setDiffText('')
      }
      await onRefresh?.()
      onFileChanged?.()
    } catch (err) {
      setStatusMsg(`Error: ${err.message}`)
    } finally {
      setBusy(false)
    }
  }

  const togglePath = (path) => {
    const next = new Set(selectedPaths)
    if (next.has(path)) next.delete(path)
    else next.add(path)
    setSelectedPaths(next)
  }

  const toggleGroup = (groupFiles) => {
    const next = new Set(selectedPaths)
    const allSelected = groupFiles.every((f) => next.has(f.path))
    for (const f of groupFiles) {
      if (allSelected) next.delete(f.path)
      else next.add(f.path)
    }
    setSelectedPaths(next)
  }

  if (vcsState && !vcsState.isRepo) {
    return (
      <div className="vcs-commit-panel" role="region" aria-label="Version Control Commit">
        <div className="side-head">
          <span className="vcs-side-title">Commit</span>
          <button type="button" className="ghost tiny" onClick={onClose}><PopIcon name="close" size={14} /></button>
        </div>
        <div className="vcs-empty-changes" style={{ padding: 16 }}>
          <p>This workspace is not a Git repository.</p>
          <button
            type="button"
            className="primary tiny"
            disabled={busy || !workspace}
            onClick={() => void runAction('init')}
          >
            Initialize Git Repository
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="vcs-commit-panel" role="region" aria-label="Version Control Commit">
      <div className="side-head">
        <span className="vcs-side-title">
          <span>Commit</span>
          {vcsState?.branch && (
            <span className="vcs-branch-tag" title={`Current Branch: ${vcsState.branch}`}>
              {vcsState.branch}
            </span>
          )}
        </span>
        <div style={{ display: 'flex', gap: 4 }}>
          <button type="button" className="ghost tiny" title="Refresh Git status" onClick={() => void onRefresh?.()}><PopIcon name="refresh" size={14} /></button>
          <button type="button" className="ghost tiny" title="Show Git Log" onClick={onOpenLog}>Log</button>
          <button type="button" className="ghost tiny" title="Close Commit panel" onClick={onClose}><PopIcon name="close" size={14} /></button>
        </div>
      </div>

      <div className="vcs-changes-tree">
        {files.length === 0 ? (
          <div className="vcs-empty-changes">
            <p>No changes detected.</p>
            <small style={{ color: '#8c919d' }}>Working tree clean.</small>
          </div>
        ) : (
          <>
            {stagedFiles.length > 0 && (
              <details open className="vcs-change-group">
                <summary>
                  <input
                    type="checkbox"
                    checked={stagedFiles.every((f) => selectedPaths.has(f.path))}
                    onChange={() => toggleGroup(stagedFiles)}
                  />
                  <span>Changes to be committed</span>
                  <span className="vcs-count-badge">{stagedFiles.length}</span>
                  <button
                    type="button"
                    className="vcs-rollback-btn"
                    title="Unstage all"
                    onClick={(e) => {
                      e.stopPropagation()
                      void runAction('unstage', { files: stagedFiles.map((f) => f.path) })
                    }}
                  >
                    Unstage
                  </button>
                </summary>
                <div className="vcs-file-list">
                  {stagedFiles.map((f) => {
                    const name = f.path.split('/').pop()
                    const dir = f.path.includes('/') ? f.path.slice(0, f.path.lastIndexOf('/')) : ''
                    const icon = fileIconName(name)
                    return (
                      <div key={f.path} className={`vcs-file-row ${diffFile === f.path ? 'on' : ''}`}>
                        <input
                          type="checkbox"
                          checked={selectedPaths.has(f.path)}
                          onChange={() => togglePath(f.path)}
                        />
                        <button
                          type="button"
                          className={`vcs-file-btn status-${f.status}`}
                          onClick={() => void loadDiff(f.path)}
                          onDoubleClick={() => onOpenFile(f.path)}
                          title={`${f.path} (Click for preview, Double-click to open file)`}
                        >
                          <span className={`project-tree-icon ${icon}`}><TreeIcon name={icon} /></span>
                          <span className="vcs-file-name">{name}</span>
                          {dir && <small className="vcs-file-dir">{dir}</small>}
                          <span className={`vcs-status-letter status-${f.status}`}>{f.status}</span>
                        </button>
                      </div>
                    )
                  })}
                </div>
              </details>
            )}

            {unstagedFiles.length > 0 && (
              <details open className="vcs-change-group">
                <summary>
                  <input
                    type="checkbox"
                    checked={unstagedFiles.every((f) => selectedPaths.has(f.path))}
                    onChange={() => toggleGroup(unstagedFiles)}
                  />
                  <span>Changes</span>
                  <span className="vcs-count-badge">{unstagedFiles.length}</span>
                  <button
                    type="button"
                    className="vcs-rollback-btn"
                    title="Rollback selected files"
                    onClick={(e) => {
                      e.stopPropagation()
                      const targets = unstagedFiles.filter((f) => selectedPaths.has(f.path)).map((f) => f.path)
                      if (!targets.length) return
                      if (window.confirm(`Discard unstaged changes in ${targets.length} file(s)?`)) {
                        void runAction('discard', { files: targets })
                      }
                    }}
                  >
                    Rollback…
                  </button>
                </summary>
                <div className="vcs-file-list">
                  {unstagedFiles.map((f) => {
                    const name = f.path.split('/').pop()
                    const dir = f.path.includes('/') ? f.path.slice(0, f.path.lastIndexOf('/')) : ''
                    const icon = fileIconName(name)
                    return (
                      <div key={f.path} className={`vcs-file-row ${diffFile === f.path ? 'on' : ''}`}>
                        <input
                          type="checkbox"
                          checked={selectedPaths.has(f.path)}
                          onChange={() => togglePath(f.path)}
                        />
                        <button
                          type="button"
                          className={`vcs-file-btn status-${f.status}`}
                          onClick={() => void loadDiff(f.path)}
                          onDoubleClick={() => onOpenFile(f.path)}
                          title={`${f.path} (Click for preview, Double-click to open file)`}
                        >
                          <span className={`project-tree-icon ${icon}`}><TreeIcon name={icon} /></span>
                          <span className="vcs-file-name">{name}</span>
                          {dir && <small className="vcs-file-dir">{dir}</small>}
                          <span className={`vcs-status-letter status-${f.status}`}>{f.status}</span>
                        </button>
                      </div>
                    )
                  })}
                </div>
              </details>
            )}

            {untrackedFiles.length > 0 && (
              <details open className="vcs-change-group">
                <summary>
                  <input
                    type="checkbox"
                    checked={untrackedFiles.every((f) => selectedPaths.has(f.path))}
                    onChange={() => toggleGroup(untrackedFiles)}
                  />
                  <span>Untracked Files</span>
                  <span className="vcs-count-badge">{untrackedFiles.length}</span>
                </summary>
                <div className="vcs-file-list">
                  {untrackedFiles.map((f) => {
                    const name = f.path.split('/').pop()
                    const dir = f.path.includes('/') ? f.path.slice(0, f.path.lastIndexOf('/')) : ''
                    const icon = fileIconName(name)
                    return (
                      <div key={f.path} className={`vcs-file-row ${diffFile === f.path ? 'on' : ''}`}>
                        <input
                          type="checkbox"
                          checked={selectedPaths.has(f.path)}
                          onChange={() => togglePath(f.path)}
                        />
                        <button
                          type="button"
                          className="vcs-file-btn status-U"
                          onClick={() => void loadDiff(f.path)}
                          onDoubleClick={() => onOpenFile(f.path)}
                          title={`${f.path} (Click for preview, Double-click to open file)`}
                        >
                          <span className={`project-tree-icon ${icon}`}><TreeIcon name={icon} /></span>
                          <span className="vcs-file-name">{name}</span>
                          {dir && <small className="vcs-file-dir">{dir}</small>}
                          <span className="vcs-status-letter status-U">U</span>
                        </button>
                      </div>
                    )
                  })}
                </div>
              </details>
            )}
          </>
        )}
      </div>

      {diffFile && (
        <div className="vcs-inline-diff">
          <header>
            <strong title={diffFile}>{diffFile.split('/').pop()}</strong>
            <div style={{ display: 'flex', gap: 4 }}>
              <button type="button" className="ghost tiny" onClick={() => onOpenFile(diffFile)}>Open File</button>
              <button type="button" className="ghost tiny" onClick={() => setDiffFile(null)}>×</button>
            </div>
          </header>
          <pre className="vcs-diff-pre">
            {diffText.split('\n').map((line, idx) => {
              const cls = line.startsWith('+') && !line.startsWith('+++') ? 'diff-add'
                : line.startsWith('-') && !line.startsWith('---') ? 'diff-del'
                : line.startsWith('@@') ? 'diff-hunk' : ''
              return <div key={idx} className={cls}>{line || ' '}</div>
            })}
          </pre>
        </div>
      )}

      <div className="vcs-commit-box">
        <div className="vcs-commit-options">
          <label>
            <input type="checkbox" checked={amend} onChange={(e) => setAmend(e.target.checked)} />
            Amend
          </label>
          <span className="vcs-selected-count">{selectedPaths.size} selected</span>
        </div>
        <textarea
          className="vcs-commit-input"
          placeholder="Commit Message (Ctrl+Enter to commit)"
          value={commitMessage}
          onChange={(e) => setCommitMessage(e.target.value)}
          onKeyDown={(e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
              e.preventDefault()
              if (selectedPaths.size > 0 || amend) {
                void runAction('commit', { files: [...selectedPaths], message: commitMessage, amend })
              }
            }
          }}
        />
        <div className="vcs-commit-actions">
          <button
            type="button"
            className="primary tiny"
            disabled={busy || (selectedPaths.size === 0 && !amend) || (!commitMessage.trim() && !amend)}
            onClick={() => void runAction('commit', { files: [...selectedPaths], message: commitMessage, amend })}
          >
            Commit
          </button>
          <button
            type="button"
            className="ghost tiny"
            disabled={busy || (selectedPaths.size === 0 && !amend) || (!commitMessage.trim() && !amend)}
            onClick={() => void runAction('commitAndPush', { files: [...selectedPaths], message: commitMessage, amend })}
          >
            Commit and Push…
          </button>
        </div>
        {statusMsg && <div className="vcs-status-inline" role="status">{statusMsg}</div>}
      </div>
    </div>
  )
}

export default function VcsLogPanel({
  workspace,
  vcsState,
  visible,
  onHide,
  onRefreshStatus,
  onOpenFile,
  onOpenCommit,
  isResizing,
  onResizeStart,
  onTouchResizeStart,
  onResizeReset
}) {
  const [tab, setTab] = useState('log') // 'log' | 'console'
  const [commits, setCommits] = useState([])
  const [branchFilter, setBranchFilter] = useState('--all')
  const [branchSearch, setBranchSearch] = useState('')
  const [search, setSearch] = useState('')
  const [authorFilter, setAuthorFilter] = useState('')
  const [regexMode, setRegexMode] = useState(false)
  const [matchCase, setMatchCase] = useState(false)
  const [branchDropdownOpen, setBranchDropdownOpen] = useState(false)
  const [userDropdownOpen, setUserDropdownOpen] = useState(false)
  const [selectedCommit, setSelectedCommit] = useState(null)
  const [commitDetail, setCommitDetail] = useState(null)
  const [selectedFile, setSelectedFile] = useState(null)
  const [diffText, setDiffText] = useState('')
  const [diffLoading, setDiffLoading] = useState(false)
  const [detailTab, setDetailTab] = useState('files') // 'files' | 'diff'
  const [consoleLog, setConsoleLog] = useState([])
  const [busy, setBusy] = useState(false)
  const [showNewBranchInput, setShowNewBranchInput] = useState(false)
  const [newBranchName, setNewBranchName] = useState('')
  const [branchesWidth, setBranchesWidth] = useState(() => {
    try { return Math.max(150, Math.min(420, parseInt(localStorage.getItem('aether.vcs_branches_w') || '240', 10))) } catch { return 240 }
  })
  const [detailWidth, setDetailWidth] = useState(() => {
    try { return Math.max(200, Math.min(650, parseInt(localStorage.getItem('aether.vcs_detail_w') || '360', 10))) } catch { return 360 }
  })

  const appendConsole = useCallback((cmd, out) => {
    const time = new Date().toLocaleTimeString()
    setConsoleLog((prev) => [...prev, `[${time}] $ git ${cmd}\n${out || 'OK'}`])
  }, [])

  const fetchLog = useCallback(async () => {
    if (!visible) return
    try {
      const params = new URLSearchParams({ branch: branchFilter, limit: '100' })
      if (search.trim()) params.set('search', search.trim())
      if (authorFilter.trim()) params.set('author', authorFilter.trim())
      const res = await fetch(`/api/vcs/log?${params}`)
      const data = await res.json()
      if (Array.isArray(data.commits)) {
        setCommits(data.commits)
        setSelectedCommit((prev) => {
          if (!prev && data.commits.length > 0) return data.commits[0]
          if (prev && !data.commits.some((c) => c.hash === prev.hash)) return data.commits[0] || null
          return prev
        })
      }
    } catch {}
  }, [visible, branchFilter, search, authorFilter])

  useEffect(() => {
    if (visible) void fetchLog()
  }, [visible, fetchLog])

  // Load commit details and reset diff states on commit selection change
  useEffect(() => {
    if (!selectedCommit?.hash || !visible) {
      setCommitDetail(null)
      setSelectedFile(null)
      setDiffText('')
      return
    }
    let cancelled = false
    setSelectedFile(null)
    setDiffText('')
    fetch(`/api/vcs/commit-detail?hash=${encodeURIComponent(selectedCommit.hash)}`)
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled) setCommitDetail(data)
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [selectedCommit?.hash, visible])

  const loadCommitDiff = useCallback(async (hash, filePath = '') => {
    if (!hash) return
    setDiffLoading(true)
    try {
      const url = filePath
        ? `/api/vcs/commit-diff?hash=${encodeURIComponent(hash)}&file=${encodeURIComponent(filePath)}`
        : `/api/vcs/commit-diff?hash=${encodeURIComponent(hash)}`
      const res = await fetch(url)
      const data = await res.json()
      setDiffText(data.diff || 'No diff content available.')
      setDetailTab('diff')
    } catch {
      setDiffText('Failed to load git diff.')
    } finally {
      setDiffLoading(false)
    }
  }, [])

  const executeGitAction = async (action, extra = {}, label = action) => {
    setBusy(true)
    try {
      const res = await fetch('/api/vcs/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ...extra })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Git command failed')
      appendConsole(label, data.output)
      await onRefreshStatus?.()
      await fetchLog()
    } catch (err) {
      appendConsole(label, `Error: ${err.message}`)
    } finally {
      setBusy(false)
    }
  }

  const startResizeBranches = (e) => {
    e.preventDefault()
    const container = e.currentTarget.closest('.vcs-log-layout')
    document.body.classList.add('resizing-col')
    const onMove = (ev) => {
      const rect = container?.getBoundingClientRect()
      const leftEdge = rect ? rect.left + 32 : 32
      const w = Math.max(150, Math.min(ev.clientX - leftEdge, 420))
      setBranchesWidth(w)
    }
    const onUp = () => {
      document.body.classList.remove('resizing-col')
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      setBranchesWidth((w) => {
        try { localStorage.setItem('aether.vcs_branches_w', String(w)) } catch {}
        return w
      })
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  const startResizeDetail = (e) => {
    e.preventDefault()
    const container = e.currentTarget.closest('.vcs-log-layout')
    document.body.classList.add('resizing-col')
    const onMove = (ev) => {
      const rect = container?.getBoundingClientRect()
      const rightEdge = rect ? rect.right : window.innerWidth
      const w = Math.max(190, Math.min(rightEdge - ev.clientX, 650))
      setDetailWidth(w)
    }
    const onUp = () => {
      document.body.classList.remove('resizing-col')
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      setDetailWidth((w) => {
        try { localStorage.setItem('aether.vcs_detail_w', String(w)) } catch {}
        return w
      })
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  const localBranches = vcsState?.branches || []
  const remoteBranches = vcsState?.remoteBranches || []
  const tags = vcsState?.tags || []

  const filteredLocalBranches = localBranches.filter((b) =>
    !branchSearch.trim() || b.name.toLowerCase().includes(branchSearch.trim().toLowerCase())
  )
  const filteredRemoteBranches = remoteBranches.filter((b) =>
    !branchSearch.trim() || b.name.toLowerCase().includes(branchSearch.trim().toLowerCase())
  )
  const filteredTags = tags.filter((t) =>
    !branchSearch.trim() || t.toLowerCase().includes(branchSearch.trim().toLowerCase())
  )

  const uniqueAuthors = useMemo(() => {
    const set = new Set()
    for (const c of commits) {
      if (c.author) set.add(c.author)
    }
    return Array.from(set).sort()
  }, [commits])

  const displayCommits = useMemo(() => {
    return commits.filter((c) => {
      if (authorFilter && c.author !== authorFilter) return false
      if (!search.trim()) return true
      const q = search.trim()
      if (regexMode) {
        try {
          const re = new RegExp(q, matchCase ? '' : 'i')
          return re.test(c.subject) || re.test(c.hash) || re.test(c.shortHash) || re.test(c.author)
        } catch {
          return true
        }
      }
      const target = matchCase ? (c.subject + ' ' + c.hash + ' ' + c.author) : (c.subject + ' ' + c.hash + ' ' + c.author).toLowerCase()
      const queryStr = matchCase ? q : q.toLowerCase()
      return target.includes(queryStr)
    })
  }, [commits, authorFilter, search, regexMode, matchCase])

  const graphColors = ['#3574f0', '#a855f7', '#10b981', '#f59e0b', '#ec4899']

  return (
    <section className="maven-panel vcs-bottom-panel" aria-label="Git Version Control" hidden={!visible}>
      <div
        className={`resizer-handle top ${isResizing ? 'active' : ''}`}
        onMouseDown={onResizeStart}
        onTouchStart={onTouchResizeStart}
        onDoubleClick={onResizeReset}
        title="Drag to resize Git tool window (Double-click to reset)"
      />
      {/* IntelliJ Git Header Bar */}
      <div className="vcs-bottom-header">
        <div className="vcs-bottom-tabs" role="tablist">
          <strong className="vcs-header-title">Git</strong>
          <button
            type="button"
            role="tab"
            className={`vcs-tab-pill ${tab === 'log' ? 'active' : ''}`}
            aria-selected={tab === 'log'}
            onClick={() => setTab('log')}
          >
            Log
          </button>
          <button
            type="button"
            role="tab"
            className={`vcs-tab-pill ${tab === 'console' ? 'active' : ''}`}
            aria-selected={tab === 'console'}
            onClick={() => setTab('console')}
          >
            <span>Console</span>
            {consoleLog.length > 0 && <span className="vcs-console-badge">{consoleLog.length}</span>}
          </button>
          <button type="button" className="vcs-header-icon-btn" title="Refresh Git Log" onClick={() => void fetchLog()}><PopIcon name="refresh" size={14} /></button>
        </div>

        <div className="vcs-header-right-actions">
          <button type="button" className="vcs-header-icon-btn" title="Fetch All Remotes" onClick={() => void executeGitAction('fetch', {}, 'fetch --all --prune')}><PopIcon name="swap" size={14} /></button>
          <button type="button" className="vcs-header-icon-btn" onClick={onHide} title="Hide Git Window" aria-label="Hide Git panel"><PopIcon name="minus" size={14} /></button>
        </div>
      </div>

      {tab === 'console' ? (
        <pre className="vcs-console-pre">
          {consoleLog.length ? consoleLog.join('\n\n') : 'Git console output will appear here when you run Fetch, Pull, Push, Checkout, or Commit actions.'}
        </pre>
      ) : (
        <div
          className="vcs-log-layout"
          style={{ '--vcs-br-w': `${branchesWidth}px`, '--vcs-det-w': `${detailWidth}px` }}
        >
          {/* Far-left vertical action rail */}
          <div className="vcs-left-rail" aria-label="Branches actions">
            <button type="button" title="Toggle Branches Pane" onClick={() => setBranchesWidth(branchesWidth > 160 ? 150 : 240)}>‹</button>
            <button type="button" title="New Branch…" onClick={() => setShowNewBranchInput(!showNewBranchInput)}>＋</button>
            <button type="button" title="Checkout Selected Branch" disabled={branchFilter === '--all'} onClick={() => branchFilter !== '--all' && void executeGitAction('checkout', { branch: branchFilter }, `checkout ${branchFilter}`)}><PopIcon name="tag" size={14} /></button>
            <button type="button" title="Update / Pull Current Branch" disabled={busy} onClick={() => void executeGitAction('pull', {}, 'pull')}><PopIcon name="download" size={14} /></button>
            <button type="button" title="Fetch All Remotes" disabled={busy} onClick={() => void executeGitAction('fetch', {}, 'fetch --all --prune')}><PopIcon name="swap" size={14} /></button>
            <button type="button" title="Filter by Current Branch" onClick={() => setBranchFilter(vcsState?.branch || '--all')}><PopIcon name="star" size={14} /></button>
          </div>

          {/* Left: Branches tree */}
          <aside className="vcs-branches-pane" aria-label="Git Branches">
            <div
              className="resizer-handle left"
              onMouseDown={startResizeBranches}
              onDoubleClick={() => setBranchesWidth(240)}
              title="Drag to resize Branches pane (Double-click to reset)"
            />
            <div className="vcs-branch-search-bar">
              <span><PopIcon name="search" size={14} /></span>
              <input
                type="text"
                placeholder="Search branches…"
                aria-label="Filter branches"
                value={branchSearch}
                onChange={(e) => setBranchSearch(e.target.value)}
              />
              {branchSearch && (
                <button type="button" className="ghost tiny" onClick={() => setBranchSearch('')} style={{ border: 0, padding: '0 4px', color: '#8c919d' }}><PopIcon name="close" size={14} /></button>
              )}
            </div>

            {showNewBranchInput && (
              <form
                className="vcs-new-branch-form"
                onSubmit={(e) => {
                  e.preventDefault()
                  if (!newBranchName.trim()) return
                  const name = newBranchName.trim()
                  setNewBranchName('')
                  setShowNewBranchInput(false)
                  void executeGitAction('checkout', { branch: name, create: true }, `checkout -b ${name}`)
                }}
              >
                <input
                  type="text"
                  autoFocus
                  placeholder="New branch name (Enter)…"
                  value={newBranchName}
                  onChange={(e) => setNewBranchName(e.target.value)}
                />
              </form>
            )}

            <div className="vcs-branches-tree-list">
              <button
                type="button"
                className={`vcs-branch-tree-item ${branchFilter === '--all' ? 'on' : ''}`}
                onClick={() => setBranchFilter('--all')}
                title="Show all branches (HEAD & remotes)"
              >
                <span>HEAD (All Branches)</span>
              </button>

              {/* Local branches */}
              <details open className="vcs-branch-group">
                <summary>Local ({filteredLocalBranches.length})</summary>
                {filteredLocalBranches.map((b) => (
                  <button
                    key={b.name}
                    type="button"
                    className={`vcs-branch-tree-item is-branch ${branchFilter === b.name || (branchFilter === '--all' && b.current) ? 'on' : ''}`}
                    onClick={() => setBranchFilter(b.name)}
                    onDoubleClick={() => !b.current && void executeGitAction('checkout', { branch: b.name }, `checkout ${b.name}`)}
                    title={b.current ? `${b.name} (Current branch)` : `${b.name} (Double-click to checkout)`}
                  >
                    <span className="vcs-tag-ico" aria-hidden="true">{b.current ? <PopIcon name="check" size={14} /> : <PopIcon name="tag" size={14} />}</span>
                    <strong style={{ fontWeight: b.current ? 700 : 400 }}>{b.name}</strong>
                    {b.current && <small style={{ marginLeft: 'auto', color: '#6897bb', fontSize: 10 }}>HEAD</small>}
                  </button>
                ))}
              </details>

              {/* Remote branches */}
              {filteredRemoteBranches.length > 0 && (
                <details open className="vcs-branch-group">
                  <summary>Remote ({filteredRemoteBranches.length})</summary>
                  {filteredRemoteBranches.map((rb) => (
                    <button
                      key={rb.name}
                      type="button"
                      className={`vcs-branch-tree-item is-branch ${branchFilter === rb.name ? 'on' : ''}`}
                      onClick={() => setBranchFilter(rb.name)}
                      onDoubleClick={() => void executeGitAction('checkout', { branch: rb.name }, `checkout ${rb.name}`)}
                      title={`${rb.name} (Double-click to checkout local tracking branch)`}
                    >
                      <span className="vcs-tag-ico" aria-hidden="true" style={{ color: 'var(--ui-accent)' }}><PopIcon name="cloud" size={14} /></span>
                      <span>{rb.name}</span>
                    </button>
                  ))}
                </details>
              )}

              {/* Tags */}
              {filteredTags.length > 0 && (
                <details className="vcs-branch-group">
                  <summary>Tags ({filteredTags.length})</summary>
                  {filteredTags.map((t) => (
                    <button
                      key={t}
                      type="button"
                      className={`vcs-branch-tree-item is-branch ${branchFilter === t ? 'on' : ''}`}
                      onClick={() => setBranchFilter(t)}
                      onDoubleClick={() => void executeGitAction('checkout', { branch: t }, `checkout ${t}`)}
                      title={`Tag: ${t}`}
                    >
                      <span className="vcs-tag-ico" aria-hidden="true"><PopIcon name="tag" size={14} /></span>
                      <span>{t}</span>
                    </button>
                  ))}
                </details>
              )}
            </div>
          </aside>

          {/* Center: Filter Bar + Commit Log Table */}
          <div className="vcs-commits-pane" role="region" aria-label="Commit history">
            <div className="vcs-commits-filter-bar">
              <div className="vcs-text-search-box">
                <span className="vcs-search-loupe"><PopIcon name="search" size={14} /></span>
                <input
                  type="text"
                  placeholder="Filter commits by text or hash…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
                {search && (
                  <button type="button" className="ghost tiny" onClick={() => setSearch('')} style={{ border: 0, padding: '0 4px', color: '#8c919d' }}><PopIcon name="close" size={14} /></button>
                )}
                <button
                  type="button"
                  className={`vcs-filter-toggle ${regexMode ? 'active' : ''}`}
                  onClick={() => setRegexMode(!regexMode)}
                  title="Regular Expression"
                >
                  .*
                </button>
                <button
                  type="button"
                  className={`vcs-filter-toggle ${matchCase ? 'active' : ''}`}
                  onClick={() => setMatchCase(!matchCase)}
                  title="Match Case"
                >
                  Cc
                </button>
              </div>

              <div className="vcs-dropdown-filters">
                <div className="vcs-filter-dropdown-wrap">
                  <button
                    type="button"
                    className="vcs-dropdown-pill"
                    onClick={() => {
                      setBranchDropdownOpen(!branchDropdownOpen)
                      setUserDropdownOpen(false)
                    }}
                  >
                    Branch: {branchFilter === '--all' ? 'All' : branchFilter} <PopIcon name="chevronDown" size={14} />
                  </button>
                  {branchDropdownOpen && (
                    <div className="vcs-filter-menu" role="menu">
                      <button
                        type="button"
                        className={`vcs-filter-menu-item ${branchFilter === '--all' ? 'active' : ''}`}
                        onClick={() => { setBranchFilter('--all'); setBranchDropdownOpen(false) }}
                      >
                        <span>All Branches</span>
                      </button>
                      {vcsState?.branch && (
                        <button
                          type="button"
                          className={`vcs-filter-menu-item ${branchFilter === vcsState.branch ? 'active' : ''}`}
                          onClick={() => { setBranchFilter(vcsState.branch); setBranchDropdownOpen(false) }}
                        >
                          <span>Current ({vcsState.branch})</span>
                        </button>
                      )}
                      {localBranches.map((b) => (
                        <button
                          key={b.name}
                          type="button"
                          className={`vcs-filter-menu-item ${branchFilter === b.name ? 'active' : ''}`}
                          onClick={() => { setBranchFilter(b.name); setBranchDropdownOpen(false) }}
                        >
                          <span>{b.name}</span>
                        </button>
                      ))}
                      {remoteBranches.map((rb) => (
                        <button
                          key={rb.name}
                          type="button"
                          className={`vcs-filter-menu-item ${branchFilter === rb.name ? 'active' : ''}`}
                          onClick={() => { setBranchFilter(rb.name); setBranchDropdownOpen(false) }}
                        >
                          <span>{rb.name}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                <div className="vcs-filter-dropdown-wrap">
                  <button
                    type="button"
                    className="vcs-dropdown-pill"
                    onClick={() => {
                      setUserDropdownOpen(!userDropdownOpen)
                      setBranchDropdownOpen(false)
                    }}
                  >
                    User: {authorFilter || 'All'} <PopIcon name="chevronDown" size={14} />
                  </button>
                  {userDropdownOpen && (
                    <div className="vcs-filter-menu" role="menu">
                      <button
                        type="button"
                        className={`vcs-filter-menu-item ${!authorFilter ? 'active' : ''}`}
                        onClick={() => { setAuthorFilter(''); setUserDropdownOpen(false) }}
                      >
                        <span>All Users</span>
                      </button>
                      {uniqueAuthors.map((author) => (
                        <button
                          key={author}
                          type="button"
                          className={`vcs-filter-menu-item ${authorFilter === author ? 'active' : ''}`}
                          onClick={() => { setAuthorFilter(author); setUserDropdownOpen(false) }}
                        >
                          <span>{author}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              <div className="vcs-commits-toolbar-icons">
                <button type="button" title="Refresh Git Log" onClick={() => void fetchLog()}><PopIcon name="refresh" size={14} /></button>
                <button type="button" title="Fetch All Remotes" onClick={() => void executeGitAction('fetch', {}, 'fetch --all --prune')}><PopIcon name="swap" size={14} /></button>
              </div>
            </div>

            {displayCommits.length === 0 ? (
              <div className="vcs-empty-log-state">
                <p>No commits found for the current branch/filter.</p>
                <p>
                  <button type="button" className="vcs-link-btn" onClick={onOpenCommit}>
                    Commit local changes
                  </button>
                  <span className="vcs-shortcut-muted"> (Ctrl+K)</span>
                </p>
              </div>
            ) : (
              <div className="vcs-commit-list">
                {displayCommits.map((c, idx) => {
                  const color = graphColors[idx % graphColors.length]
                  const selected = selectedCommit?.hash === c.hash
                  return (
                    <button
                      type="button"
                      key={c.hash}
                      className={`vcs-commit-row ${selected ? 'on' : ''}`}
                      onClick={() => setSelectedCommit(c)}
                    >
                      <span className="vcs-graph-cell" aria-hidden="true">
                        <span className="vcs-graph-line" style={{ background: color }} />
                        <span className="vcs-graph-dot" style={{ borderColor: color, background: selected ? color : '#1e1f22' }} />
                      </span>
                      <span className="vcs-commit-subject">
                        {c.refs?.map((ref) => (
                          <span key={ref} className={`vcs-ref-badge ${ref.includes('HEAD') ? 'is-head' : ''}`}>
                            {ref}
                          </span>
                        ))}
                        <span>{c.subject}</span>
                      </span>
                      <span className="vcs-commit-author">{c.author}</span>
                      <span className="vcs-commit-date">{c.date ? c.date.slice(0, 16) : ''}</span>
                      <code className="vcs-commit-hash">{c.shortHash}</code>
                    </button>
                  )
                })}
              </div>
            )}
          </div>

          {/* Right: Commit Changes & Git Diff Split Pane */}
          <aside className="vcs-detail-pane" aria-label="Commit details and diff">
            <div
              className="resizer-handle right"
              onMouseDown={startResizeDetail}
              onDoubleClick={() => setDetailWidth(360)}
              title="Drag to resize Commit Details pane (Double-click to reset)"
            />

            <div className="vcs-detail-toolbar">
              <button
                type="button"
                className={`vcs-tab-btn-pill ${detailTab === 'files' ? 'active' : ''}`}
                onClick={() => setDetailTab('files')}
                title="View changed files list"
              >
                Files {commitDetail?.files ? `(${commitDetail.files.length})` : ''}
              </button>
              <button
                type="button"
                className={`vcs-tab-btn-pill ${detailTab === 'diff' ? 'active' : ''}`}
                onClick={() => {
                  if (detailTab === 'diff') {
                    setDetailTab('files')
                  } else {
                    void loadCommitDiff(selectedCommit?.hash, selectedFile || '')
                  }
                }}
                disabled={!selectedCommit}
                title="View previous commit git diff (⇄)"
              >
                Diff <PopIcon name="swap" size={14} />
              </button>

              {selectedCommit && (
                <button
                  type="button"
                  style={{ marginLeft: 'auto', width: 'auto', padding: '0 6px', fontSize: 11 }}
                  title="Copy Commit Hash"
                  onClick={() => {
                    navigator.clipboard?.writeText(selectedCommit.hash)
                    appendConsole('copy', `Copied commit hash ${selectedCommit.hash}`)
                  }}
                >
                  <code>{selectedCommit.shortHash}</code> <PopIcon name="copy" size={14} />
                </button>
              )}
            </div>

            {selectedCommit ? (
              <div className="vcs-detail-split">
                {detailTab === 'diff' ? (
                  <div className="vcs-detail-diff-pane">
                    <div className="vcs-detail-diff-header">
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, overflow: 'hidden' }}>
                        <button
                          type="button"
                          className="ghost tiny"
                          onClick={() => setDetailTab('files')}
                          title="Back to file list"
                          style={{ padding: '2px 5px', fontSize: 11 }}
                        >
                          ‹ Files
                        </button>
                        <strong title={selectedFile || `Commit ${selectedCommit.shortHash} diff`}>
                          {selectedFile ? selectedFile.split('/').pop() : `Commit ${selectedCommit.shortHash} Diff`}
                        </strong>
                      </div>
                      <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                        {selectedFile && (
                          <button
                            type="button"
                            className="ghost tiny"
                            onClick={() => onOpenFile(selectedFile)}
                            title="Open file in editor"
                            style={{ padding: '2px 5px', fontSize: 11 }}
                          >
                            Open
                          </button>
                        )}
                        <button
                          type="button"
                          className="ghost tiny"
                          onClick={() => setDetailTab('files')}
                          style={{ padding: '2px 5px', fontSize: 11 }}
                        >
                          <PopIcon name="close" size={14} />
                        </button>
                      </div>
                    </div>

                    <div className="vcs-detail-diff-body">
                      {diffLoading ? (
                        <div className="vcs-diff-empty-notice">Loading git diff…</div>
                      ) : diffText ? (
                        diffText.split('\n').map((line, idx) => {
                          const cls = line.startsWith('+') && !line.startsWith('+++') ? 'diff-add'
                            : line.startsWith('-') && !line.startsWith('---') ? 'diff-del'
                            : line.startsWith('@@') ? 'diff-hunk' : ''
                          return (
                            <div key={idx} className={`vcs-diff-line ${cls}`}>
                              {line || ' '}
                            </div>
                          )
                        })
                      ) : (
                        <div className="vcs-diff-empty-notice">No diff available.</div>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="vcs-detail-files">
                    {commitDetail?.files?.length ? (
                      commitDetail.files.map((f) => {
                        const name = f.path.split('/').pop()
                        const icon = fileIconName(name)
                        const isSelected = selectedFile === f.path
                        return (
                          <button
                            key={f.path}
                            type="button"
                            className={`vcs-detail-file-row ${isSelected ? 'on' : ''}`}
                            onClick={() => {
                              setSelectedFile(f.path)
                              void loadCommitDiff(selectedCommit.hash, f.path)
                            }}
                            onDoubleClick={() => onOpenFile(f.path)}
                            title={`${f.path} (Click to view git diff, Double-click to open in editor)`}
                          >
                            <span className={`vcs-status-letter status-${f.status[0]}`}>{f.status[0]}</span>
                            <span className={`project-tree-icon ${icon}`}><TreeIcon name={icon} /></span>
                            <span className="vcs-file-name">{name}</span>
                            <small className="vcs-file-dir">{f.path}</small>
                          </button>
                        )
                      })
                    ) : (
                      <div className="vcs-empty-changes">No file changes recorded for this commit.</div>
                    )}
                  </div>
                )}

                <div className="vcs-detail-meta-pane">
                  <strong>{selectedCommit.subject}</strong>
                  <div className="vcs-detail-meta">
                    <code>{selectedCommit.shortHash}</code> · <span>{selectedCommit.author}</span> · <small>{selectedCommit.date}</small>
                  </div>
                </div>
              </div>
            ) : (
              <div className="vcs-detail-empty-split">
                <div className="vcs-detail-empty-top">Select commit to view changes and git diff</div>
                <div className="vcs-detail-empty-bottom">Commit details</div>
              </div>
            )}
          </aside>
        </div>
      )}
    </section>
  )
}
