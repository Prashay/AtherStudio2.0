import React, { useEffect, useRef, useState } from 'react'

const GENERATORS = [
  { id: 'java', label: 'Java', hint: 'Plain Java application' },
  { id: 'kotlin', label: 'Kotlin', hint: 'Kotlin/JVM application' },
  { id: 'empty', label: 'Empty Project', hint: 'A folder with nothing but a README' }
]
const BUILD_SYSTEMS = [
  { id: 'base', label: 'Base IDE' },
  { id: 'maven', label: 'Maven' },
  { id: 'gradle', label: 'Gradle' }
]
const JDKS = [21, 17, 11, 8, 25]

export default function NewProjectDialog({ onClose, onCreated }) {
  const dialogRef = useRef(null)
  const [generator, setGenerator] = useState('java')
  const [name, setName] = useState('untitled')
  const [location, setLocation] = useState('')
  const [separator, setSeparator] = useState('/')
  const [buildSystem, setBuildSystem] = useState('maven')
  const [javaVersion, setJavaVersion] = useState(21)
  const [groupId, setGroupId] = useState('org.example')
  const [artifactId, setArtifactId] = useState('untitled')
  const [artifactTouched, setArtifactTouched] = useState(false)
  const [sampleCode, setSampleCode] = useState(true)
  const [git, setGit] = useState(false)
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [error, setError] = useState('')
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    dialogRef.current?.showModal()
    fetch('/api/project/defaults')
      .then((r) => r.json())
      .then((d) => {
        setLocation((prev) => prev || d.location || '')
        if (d.separator) setSeparator(d.separator)
      })
      .catch(() => {})
  }, [])

  const updateName = (value) => {
    setName(value)
    if (!artifactTouched) setArtifactId(value.trim().replace(/\s+/g, '-'))
    setError('')
  }

  const browse = async () => {
    if (!window.electronAPI?.openFolderDialog) return
    try {
      const res = await window.electronAPI.openFolderDialog(location || undefined)
      if (!res.canceled && res.filePaths?.[0]) setLocation(res.filePaths[0])
    } catch {}
  }

  const usesBuildTool = generator !== 'empty'
  const usesCoordinates = usesBuildTool && buildSystem !== 'base'
  const trimmedLocation = location.replace(/[\\/]+$/, '')
  const fullPath = trimmedLocation && name.trim() ? `${trimmedLocation}${separator}${name.trim()}` : ''

  const create = async () => {
    if (creating) return
    setCreating(true)
    setError('')
    try {
      const response = await fetch('/api/project/new', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(), location: location.trim(), generator, buildSystem,
          javaVersion, groupId, artifactId, sampleCode, git
        })
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.error || (response.status === 404 ? 'Project creation is unavailable. Restart the Aether backend.' : 'Could not create the project.'))
      await onCreated(data.path)
    } catch (err) {
      setError(err.message || 'Could not create the project.')
      setCreating(false)
    }
  }

  return (
    <dialog ref={dialogRef} className="java-config-dialog new-project-dialog" aria-labelledby="new-project-title"
      onCancel={(event) => { event.preventDefault(); if (!creating) onClose() }}>
      <header><strong id="new-project-title">New Project</strong></header>
      <form className="java-config-body" onSubmit={(event) => { event.preventDefault(); void create() }}>
        <aside aria-label="Project type">
          {GENERATORS.map((item) => (
            <button type="button" key={item.id} aria-pressed={generator === item.id} title={item.hint}
              onClick={() => { setGenerator(item.id); setError('') }}>{item.label}</button>
          ))}
        </aside>
        <div className="java-config-fields">
          <label>Name
            <input autoFocus value={name} onChange={(e) => updateName(e.target.value)} spellCheck={false} />
          </label>
          <label>Location
            <span className="new-project-location">
              <input value={location} onChange={(e) => { setLocation(e.target.value); setError('') }} spellCheck={false} placeholder="/absolute/folder" />
              {window.electronAPI?.openFolderDialog && <button type="button" onClick={browse} aria-label="Browse for location">…</button>}
            </span>
            {fullPath && <small className="new-project-path">Project will be created in: {fullPath}</small>}
          </label>
          <label className="new-project-check">
            <input type="checkbox" checked={git} onChange={(e) => setGit(e.target.checked)} /> Create Git repository
          </label>
          {usesBuildTool && <>
            <div className="new-project-row">
              <span>Build system</span>
              <div className="new-project-segment" role="radiogroup" aria-label="Build system">
                {BUILD_SYSTEMS.map((item) => (
                  <button type="button" key={item.id} role="radio" aria-checked={buildSystem === item.id}
                    onClick={() => setBuildSystem(item.id)}>{item.label}</button>
                ))}
              </div>
            </div>
            <label>JDK
              <select value={javaVersion} onChange={(e) => setJavaVersion(Number(e.target.value))}>
                {JDKS.map((v) => <option key={v} value={v}>{v}</option>)}
              </select>
            </label>
            <label className="new-project-check">
              <input type="checkbox" checked={sampleCode} onChange={(e) => setSampleCode(e.target.checked)} /> Add sample code
            </label>
            {usesCoordinates && <>
              <button type="button" className="new-project-advanced" aria-expanded={advancedOpen} onClick={() => setAdvancedOpen(!advancedOpen)}>
                {advancedOpen ? '▾' : '▸'} Advanced Settings
              </button>
              {advancedOpen && <>
                <label>GroupId
                  <input value={groupId} onChange={(e) => { setGroupId(e.target.value); setError('') }} spellCheck={false} />
                </label>
                <label>ArtifactId
                  <input value={artifactId} onChange={(e) => { setArtifactId(e.target.value); setArtifactTouched(true); setError('') }} spellCheck={false} />
                </label>
              </>}
            </>}
          </>}
          {error && <p className="new-project-error" role="alert">{error}</p>}
        </div>
      </form>
      <footer>
        <button type="button" onClick={onClose} disabled={creating}>Cancel</button>
        <button type="button" className="primary" onClick={() => void create()} disabled={creating || !name.trim() || !location.trim()}>
          {creating ? 'Creating…' : 'Create'}
        </button>
      </footer>
    </dialog>
  )
}
