import TreeIcon from './TreeIcon.jsx'
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

const goals = ['clean', 'validate', 'compile', 'test', 'package', 'verify', 'install', 'site', 'clean install', 'compiler:compile', 'jar:jar', '--version']
const defaults = { javaHome: '', environment: '', debugPort: 5005, suspend: true }

function usePoms(tree) {
  return useMemo(() => {
    const paths = []
    const visit = (node) => {
      if (node.type === 'file' && node.name === 'pom.xml') paths.push(node.path)
      node.children?.forEach(visit)
    }
    if (tree) visit(tree)
    return paths.sort()
  }, [tree])
}

function PomSection({ file, section, revision }) {
  const [expanded, setExpanded] = useState(false)
  const [result, setResult] = useState(null)
  useEffect(() => {
    setResult(null)
    if (!expanded) return
    const controller = new AbortController()
    const children = (node, name) => [...(node?.children || [])].filter((child) => child.localName === name)
    const first = (node, name) => children(node, name)[0]
    const value = (node, name) => first(node, name)?.textContent.trim()
    fetch(`/api/file?path=${encodeURIComponent(file)}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error()
        const { content } = await response.json()
        const xml = new DOMParser().parseFromString(content, 'application/xml')
        const pom = xml.documentElement
        if (pom.localName !== 'project') throw new Error()
        const entries = section === 'Plugins'
          ? children(first(first(pom, 'build'), 'plugins'), 'plugin').map((node) => [value(node, 'artifactId'), value(node, 'version')].filter(Boolean).join(' · '))
          : children(first(pom, 'repositories'), 'repository').map((node) => [value(node, 'id'), value(node, 'url')].filter(Boolean).join(' · '))
        if (!controller.signal.aborted) setResult(entries.filter(Boolean))
      })
      .catch(() => { if (!controller.signal.aborted) setResult(false) })
    return () => controller.abort()
  }, [expanded, file, section, revision])
  return <details onToggle={(event) => setExpanded(event.currentTarget.open)}>
    <summary><TreeIcon name="package" />{section}</summary>
    {result === null ? <p>Loading…</p> : result === false ? <p>Could not read POM.</p> : result.length
      ? <ul>{result.map((item, index) => <li key={index}>{item}</li>)}</ul>
      : <p>None declared in this POM.</p>}
  </details>
}

export function MavenLifecycle({ tree, project, onRun, onReload, onOpenPom, options, setOptions }) {
  const poms = usePoms(tree)
  const branches = useRef(null)
  const pickerTrigger = useRef(null)
  const highlightedGoal = useRef(null)
  const [command, setCommand] = useState(null)
  const [scope, setScope] = useState('')
  const [index, setIndex] = useState(0)
  const [selectedGoal, setSelectedGoal] = useState(null)
  const [status, setStatus] = useState('')
  const [revision, setRevision] = useState(0)
  const pom = poms.includes(scope) ? scope : poms[0]
  const query = command?.trim().replace(/^mvn(?:\s+|$)/, '') || ''
  const matches = [...goals].sort().filter((goal) => goal.toLowerCase().includes(query.toLowerCase()))
  useEffect(() => {
    highlightedGoal.current?.scrollIntoView({ block: 'nearest' })
  }, [index, command])
  const closePicker = () => {
    setCommand(null)
    pickerTrigger.current?.focus()
  }
  const execute = (goal) => {
    if (!pom || !goal) return
    closePicker()
    onRun(pom, goal)
  }
  async function reload() {
    setStatus('Reloading…')
    try {
      await onReload()
      setRevision((previous) => previous + 1)
      setStatus('Workspace reloaded')
    }
    catch { setStatus('Could not reload the workspace.') }
  }
  return <div className="maven-lifecycle">
    <div className="maven-tool-actions" aria-label="Maven actions">
      {[
        { icon: 'reload', label: 'Reload Maven projects', action: reload, disabled: !tree || status === 'Reloading…' },
        { icon: 'file', label: 'Open selected POM', action: () => onOpenPom(pom), disabled: !pom },
        { icon: 'play', label: 'Run selected goal', action: () => onRun(selectedGoal.file, selectedGoal.goal), disabled: !selectedGoal || !poms.includes(selectedGoal.file) },
        { icon: 'execute', label: 'Execute Maven goal', action: () => { setIndex(0); setCommand('mvn ') }, disabled: !pom },
        { icon: 'offline', label: 'Toggle offline mode', pressed: options.offline, action: () => setOptions((prev) => ({ ...prev, offline: !prev.offline })) },
        { icon: 'skip', label: 'Toggle Skip Tests mode', pressed: options.skipTests, action: () => setOptions((prev) => ({ ...prev, skipTests: !prev.skipTests })) },
        ...[true, false].map((open) => ({
          icon: open ? 'expand' : 'collapse',
          label: open ? 'Expand all Maven groups' : 'Collapse all Maven groups',
          action: () => branches.current.querySelectorAll('details').forEach((item) => { item.open = open })
        }))
      ].map(({ icon, label, pressed, action, disabled }) =>
        <button key={icon} ref={icon === 'execute' ? pickerTrigger : undefined} type="button" className="ghost tiny" title={label} aria-label={label} aria-pressed={pressed} onClick={action} disabled={disabled}><TreeIcon name={icon} /></button>
      )}
    </div>
    {status && <p role="status">{status}</p>}
    <div ref={branches}>
      {!poms.length && <p>Open a Maven project to see lifecycle goals.</p>}
      {poms.map((file) => <details key={file} open={file === poms[0]}>
        <summary onClick={() => setScope(file)}><TreeIcon name="maven" />{file === 'pom.xml' ? project : file.replace(/\/pom\.xml$/, '')}</summary>
        <details><summary><TreeIcon name="package" />Lifecycle</summary>
          {goals.filter((goal) => !goal.includes(':') && goal !== '--version').map((goal) => (
            <button key={goal} type="button" className="maven-goal-row" aria-pressed={selectedGoal?.file === file && selectedGoal.goal === goal}
              onClick={() => { setScope(file); setSelectedGoal({ file, goal }) }}
              onDoubleClick={() => onRun(file, goal)}
              onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); onRun(file, goal) } }}
            ><TreeIcon name="play" />{goal}</button>
          ))}
        </details>
        <PomSection file={file} revision={revision} section="Plugins" />
        <PomSection file={file} revision={revision} section="Repositories" />
      </details>)}
    </div>
    {command !== null && createPortal(<div className="modal-back maven-command-backdrop" onClick={closePicker}>
      <section className="modal maven-command-picker" role="dialog" aria-modal="true" aria-label="Run Anything" onClick={(event) => event.stopPropagation()} onKeyDown={(event) => {
        if (event.key === 'Escape') { event.stopPropagation(); closePicker() }
      }}>
        <header><strong>Run Anything</strong><select aria-label="Maven module" value={pom} onChange={(event) => setScope(event.target.value)}>
          {poms.map((file) => <option key={file} value={file}>{file === 'pom.xml' ? 'Project' : file.replace(/\/pom\.xml$/, '')}</option>)}
        </select></header>
        <label className="maven-command-input"><TreeIcon name="maven" /><input autoFocus aria-label="Maven command" value={command} onChange={(event) => { setCommand(event.target.value); setIndex(0) }} onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault()
            setIndex((current) => Math.max(0, Math.min(matches.length - 1, current + (event.key === 'ArrowDown' ? 1 : -1))))
          }
          if (event.key === 'Enter' && !event.nativeEvent.isComposing) execute(matches[index])
        }} /></label>
        <div className="maven-command-results">
          <div className="maven-command-group">Maven Goals</div>
          {matches.map((goal, position) => <button key={goal} ref={position === index ? highlightedGoal : undefined} className={position === index ? 'on' : ''} onClick={() => execute(goal)}><TreeIcon name="maven" />mvn {goal}</button>)}
          {!matches.length && <p>No supported Maven goal matches.</p>}
        </div>
        <footer>↑ ↓ Navigate · Enter Run · Esc Close</footer>
      </section>
    </div>, document.body)}
  </div>
}

export default function MavenPanel({ project, tree, visible, onHide, applications, jdks, breakpointsByFile = {}, selectedApplication, onSelectApplication, launch, launchRequest, onLaunchHandled, onStartDebug, terminal, onToggleTerminal, options, setOptions }) {
  const poms = usePoms(tree)
  const configKey = 'aether.runConfigurations:' + project
  const [configs, setConfigs] = useState(() => {
    try { return JSON.parse(localStorage.getItem(configKey) || '{}') || {} } catch { return {} }
  })
  const [editing, setEditing] = useState(false)
  const [drafts, setDrafts] = useState({})
  const [configError, setConfigError] = useState('')
  const dialog = useRef(null)
  const lastConfigLaunch = useRef(launch)
  const [command, setCommand] = useState('')
  const [selected, setSelected] = useState('')
  const [goal, setGoal] = useState('compile')
  const [trusted, setTrusted] = useState(false)
  const [status, setStatus] = useState('Ready')
  const [output, setOutput] = useState('')
  const [session, setSession] = useState('')
  const [debugView, setDebugView] = useState('console')
  const [debugTarget, setDebugTarget] = useState(null)
  const [running, setRunning] = useState(false)
  const [debugState, setDebugState] = useState({ paused: false, muted: false })
  const [inspection, setInspection] = useState('')
  const [showBreakpoints, setShowBreakpoints] = useState(false)
  const request = useRef(null)
  const consoleRef = useRef(null)
  const target = applications.find(({ path }) => path === selectedApplication) || applications[0]
  const breakpointLines = breakpointsByFile[target?.path] || []
  const config = { ...defaults, ...configs[target?.path], ...drafts[target?.path] }
  const pom = poms.includes(selected) ? selected : poms[0]
  const update = (field, value) => setDrafts((previous) => ({
    ...previous, [target.path]: { ...previous[target.path], [field]: value }
  }))
  function closeConfiguration() {
    setEditing(false)
    setDrafts({})
    setConfigError('')
  }
  function saveConfiguration() {
    const next = { ...configs, [target.path]: config }
    try {
      localStorage.setItem(configKey, JSON.stringify(next))
      setConfigs(next)
      setStatus('Configuration saved for ' + target.className)
      closeConfiguration()
      return true
    } catch {
      setConfigError('Could not save configuration in this browser.')
      return false
    }
  }

  useEffect(() => {
    if (lastConfigLaunch.current === launch) return
    lastConfigLaunch.current = launch
    setEditing(true)
  }, [launch])
  useEffect(() => {
    if (editing) dialog.current?.showModal()
  }, [editing])
  useEffect(() => () => request.current?.abort(), [])
  useEffect(() => {
    if (visible && consoleRef.current) consoleRef.current.scrollTop = consoleRef.current.scrollHeight
  }, [output, visible, debugView])

  const handledLaunch = useRef(null)
  useEffect(() => {
    if (!launchRequest || handledLaunch.current === launchRequest) return
    if (launchRequest.goal === 'application' && !applications.some(({ path }) => path === launchRequest.application)) return
    handledLaunch.current = launchRequest
    onLaunchHandled((pending) => pending === launchRequest ? null : pending)
    setGoal(launchRequest.goal)
    setEditing(false)
    if (launchRequest.pom) setSelected(launchRequest.pom)
    void run(launchRequest.debug, launchRequest.goal, launchRequest.pom, launchRequest.application)
  })

  async function run(debug = false, goalToRun = goal, modulePom, application, configuration) {
    const applicationRun = goalToRun === 'application'
    const runTarget = application ? applications.find(({ path }) => path === application) : target
    const runConfig = configuration || { ...defaults, ...configs[runTarget?.path] }
    const runPom = modulePom || (applicationRun ? runTarget?.pom : pom)
    if (!project || (applicationRun ? !runTarget : !runPom) || request.current) return
    setSession(debug ? 'Debug' : applicationRun ? 'Run' : 'Build')
    setOutput('')
    if (debug) {
      setDebugView('console')
      const lines = breakpointsByFile[runTarget.path] || []
      setDebugTarget({ application: runTarget.path, name: runTarget.className, lines })
      setDebugState((previous) => ({ muted: previous.muted, paused: false }))
      setInspection('')
      setShowBreakpoints(false)
      setStatus('Preparing debug session…')
    }
    const variables = []
    if (applicationRun) {
      for (const line of runConfig.environment.split(/\r?\n/)) {
        if (!line.trim()) continue
        const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/)
        if (!match) {
          setEditing(true)
          setStatus('Enter environment variables as NAME=value, one per line.')
          return
        }
        variables.push([match[1], match[2]])
      }
    }
    if (goalToRun !== '--version' && !trusted) {
      if (!window.confirm(applicationRun
        ? 'Trust this project and run its Java code?'
        : 'Trust this project and allow Maven to run its build plugins?')) {
        setStatus('Launch cancelled')
        return
      }
      setTrusted(true)
    }
    const controller = new AbortController()
    request.current = controller
    let startupTimedOut = false
    const startupTimer = debug ? setTimeout(() => {
      startupTimedOut = true
      controller.abort()
    }, 30000) : null
    setRunning(true)
    setStatus(debug ? 'Starting debugger…' : 'Running ' + goalToRun)
    const append = (text) => setOutput((previous) => (previous + text).slice(-160000))
    try {
      const response = await fetch(applicationRun ? '/api/java/run' : '/api/maven/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Aether-Build': 'maven' },
        body: JSON.stringify({ project, pom: runPom, goal: goalToRun, ...options, application: runTarget?.path,
          configuration: applicationRun ? { javaHome: runConfig.javaHome, variables: Object.fromEntries(variables), debug, debugPort: Number(runConfig.debugPort), suspend: runConfig.suspend, breakpoints: breakpointsByFile[runTarget.path], muted: debugState.muted } : undefined }),
        signal: controller.signal
      })
      if (!response.ok || !response.headers.get('content-type')?.includes('application/x-ndjson')) {
        const error = await response.json().catch(() => ({}))
        throw new Error(error.error || (applicationRun
          ? 'The Java runner is unavailable. Restart Aether from the current checkout.'
          : 'The local Maven backend is unavailable.'))
      }
      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let finished = false
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        const lines = (buffer + decoder.decode(value, { stream: true })).split('\n')
        buffer = lines.pop()
        for (const line of lines) {
          const event = JSON.parse(line)
          if (event.type === 'output') append(event.text)
          if (event.type === 'debug-state') {
            if (event.id) clearTimeout(startupTimer)
            setDebugState((previous) => ({ ...previous, ...event }))
            if (event.id !== null) setStatus(event.paused ? 'Paused' : 'Running')
            if (!event.paused) setInspection('')
          }
          if (event.type === 'debug-inspection') setInspection((previous) => (previous + event.text).slice(-32000))
          if (event.type === 'debug-error') append(event.message + '\n')
          if (event.type === 'exit') {
            finished = true
            setStatus(event.code === 0 ? 'Finished successfully' : `Failed (exit ${event.code ?? 'unknown'})`)
          }
        }
      }
      if (!finished) throw new Error('The process connection ended before reporting an exit code.')
    } catch (error) {
      setStatus(startupTimedOut ? 'Debugger connection timed out' : controller.signal.aborted ? 'Stopped' : 'Failed')
      if (startupTimedOut) append('The backend did not report a debugger connection. Restart Aether and try Debug again.\n')
      else if (!controller.signal.aborted) append(error.message + '\n')
    } finally {
      clearTimeout(startupTimer)
      request.current = null
      setRunning(false)
    }
  }

  const validConfig = Boolean(target) && /^\d+$/.test(String(config.debugPort))
    && Number(config.debugPort) >= 1024 && Number(config.debugPort) <= 65535
    && config.environment.split(/\r?\n/).every((line) => !line.trim() || /^\s*[A-Za-z_][A-Za-z0-9_]*=/.test(line))
  const showDebug = !terminal && session === 'Debug' && debugTarget
  const activeBreakpointLines = breakpointsByFile[debugTarget?.application]
  useEffect(() => {
    if (!running || !debugState.id || !debugTarget || activeBreakpointLines === debugTarget.lines) return
    const lines = activeBreakpointLines || []
    const controller = new AbortController()
    fetch('/api/java/debug/action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Aether-Build': 'maven' },
      body: JSON.stringify({ id: debugState.id, action: 'breakpoints', breakpoints: lines }),
      signal: controller.signal
    }).then((response) => {
      if (!response.ok) throw new Error('Could not update breakpoints for this session.')
    }).catch((error) => {
      if (!controller.signal.aborted) setStatus(error.message)
    })
    return () => controller.abort()
  }, [running, debugState.id, debugTarget, activeBreakpointLines])
  async function debugAction(action) {
    if (action === 'mute' && !running) {
      setDebugState((previous) => ({ ...previous, muted: !previous.muted }))
      return
    }
    try {
      const response = await fetch('/api/java/debug/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Aether-Build': 'maven' },
        body: JSON.stringify({ id: debugState.id, action })
      })
      if (!response.ok) throw new Error((await response.json()).error)
    } catch (error) { setStatus(error.message || 'Debugger command failed') }
  }
  const canResume = running && debugState.paused && Boolean(debugState.id)
  const canStep = canResume && debugState.atLocation
  return <>{showDebug ? <section className="maven-panel java-debug-panel" aria-label="Java Debug" hidden={!visible}>
    <header className="java-debug-header">
      <strong>Debug</strong>
      <span className="java-debug-target" title={debugTarget.name}>{debugTarget.name.split('.').at(-1)}</span>
      <button type="button" className="ghost tiny" onClick={onHide} aria-label="Hide Debug panel">−</button>
    </header>
    <div className="java-debug-toolbar">
      {[
        ['Rerun', 'reload', running, () => run(true, 'application', undefined, debugTarget.application)],
        ['Stop', 'stop', !running, () => request.current?.abort()],
        ['Resume Program', 'play', !canResume, () => debugAction('resume')],
        ['Step Over', 'next', !canStep, () => debugAction('over')],
        ['Step Into', 'into', !canStep, () => debugAction('into')],
        ['Step Out', 'out', !canStep, () => debugAction('out')],
        ['View Breakpoints', 'breakpoint', false, () => setShowBreakpoints(!showBreakpoints), showBreakpoints],
        ['Mute Breakpoints', 'skip', running && !canResume, () => debugAction('mute'), debugState.muted]
      ].map(([label, icon, disabled, action, pressed]) =>
        <button key={label} type="button" className="ghost tiny java-debug-icon" title={label} aria-label={label}
          aria-pressed={pressed} disabled={disabled} onClick={action}><TreeIcon name={icon} /></button>
      )}
      <div role="tablist" aria-label="Debug views">
        <button type="button" role="tab" className="ghost tiny" aria-selected={debugView === 'threads'} onClick={() => setDebugView('threads')}>Threads &amp; Variables</button>
        <button type="button" role="tab" className="ghost tiny" aria-selected={debugView === 'console'} onClick={() => setDebugView('console')}>Console</button>
      </div>
    </div>
    <div className="java-debug-content">
      {debugView === 'console' ? <pre ref={consoleRef} role="tabpanel" aria-label="Debug console" tabIndex={0}>{output}</pre>
        : <pre role="tabpanel" aria-label="Threads and variables" tabIndex={0}>{inspection || 'Pause at a breakpoint to inspect threads, frames, and local variables.'}</pre>}
      {showBreakpoints && <aside className="java-debug-detail" aria-label="Breakpoints">
        <strong>Breakpoints{debugState.muted ? ' (muted)' : ''}</strong>
        {activeBreakpointLines?.length ? <ul>{activeBreakpointLines.map((line) => <li key={line}>{debugTarget.name}:{line}</li>)}</ul> : <p>No breakpoints for this class.</p>}
      </aside>}
    </div>
    <div className="maven-status" role="status">{status}</div>
  </section> : <section className={`maven-panel ${terminal ? 'has-run-configuration' : ''}`} aria-label="Maven build tool window" hidden={!visible}>
    <div className="maven-toolbar">
      <strong>{terminal ? 'Maven Terminal' : session || (goal === 'application' ? 'Run / Debug' : 'Build')}</strong>
      {goal === 'application' && !terminal
        ? <select aria-label="Java main class" value={target?.path || ''} onChange={(event) => onSelectApplication(event.target.value)} disabled={running || !target}>
          {!target && <option value="">No Java main class detected</option>}
          {applications.map((item) => <option key={item.path} value={item.path}>{item.className}</option>)}
        </select>
        : <select aria-label="Maven module" value={pom || ''} onChange={(event) => setSelected(event.target.value)} disabled={running || !pom}>
          {!pom && <option value="">No Maven project</option>}
          {poms.map((file) => <option key={file} value={file}>{file === 'pom.xml' ? 'Root project' : file.replace(/\/pom\.xml$/, '')}</option>)}
        </select>}
      {!terminal && <>
        <select aria-label="Maven goal" value={goal} onChange={(event) => setGoal(event.target.value)} disabled={running}>
          <option value="application">Java application</option>
          {goals.map((item) => <option key={item}>{item}</option>)}
        </select>
        <button className="primary tiny" onClick={() => run()} disabled={!project || !(goal === 'application' ? target : pom) || running}>Run</button>
      </>}
      {['offline', 'skipTests'].map((key) => <label key={key}><input type="checkbox" checked={options[key]} onChange={(event) => {
        const checked = event.target.checked
        setOptions((previous) => ({ ...previous, [key]: checked }))
      }} disabled={running} /> {key === 'offline' ? 'Offline' : 'Skip tests'}</label>)}
      {goal === 'application' && !terminal && <>
        <button className="ghost tiny" onClick={() => setEditing(!editing)} disabled={!target || running}>Edit configuration</button>
        <button className="ghost tiny" onClick={() => run(true)} disabled={!target || running}>Debug</button>
      </>}
      <button className="ghost tiny" onClick={() => request.current?.abort()} disabled={!running}>Stop</button>
      <button className="ghost tiny" onClick={onHide} aria-label="Hide Maven console">×</button>
    </div>
    {terminal ? <form className="run-configuration" onSubmit={(event) => {
      event.preventDefault()
      const phase = command.trim().replace(/^mvn\s+/, '').replace(/\s+/g, ' ')
      if (goals.includes(phase)) void run(false, phase)
      else setStatus('Supported Maven commands: ' + goals.join(', '))
    }}>
      <label>Maven command<input value={command} placeholder="mvn compile" onChange={(event) => setCommand(event.target.value)} disabled={running} /></label>
      <button className="primary tiny" disabled={!project || !pom || running}>Execute</button>
      <button className="ghost tiny" type="button" onClick={onToggleTerminal}>Close terminal</button>
    </form> : null}
    <pre ref={consoleRef} aria-label={goal === 'application' ? 'Program output' : 'Maven output'} tabIndex={0}>{goal === 'application' ? output : output || (project ? 'Select a Maven goal or Java application.' : 'Open a project through Server Browser to run Maven.')}</pre>
    <div className="maven-status" role="status">{status}</div>
  </section>}
  {editing && createPortal(<dialog ref={dialog} className="java-config-dialog" aria-labelledby="java-config-title" onCancel={(event) => { event.preventDefault(); closeConfiguration() }}>
    <header><strong id="java-config-title">Run/Debug Configurations</strong><button type="button" onClick={closeConfiguration} aria-label="Close configuration">×</button></header>
    <div className="java-config-body">
      <aside aria-label="Applications">Applications
        {applications.map((item) => <button key={item.path} type="button" title={item.className} aria-pressed={target?.path === item.path} onClick={() => onSelectApplication(item.path)}>{item.className.split('.').at(-1)}</button>)}
      </aside>
      {target ? <div className="java-config-fields">
      <label>Main class<input readOnly value={target.className} /></label>
      <label>JDK<select value={config.javaHome} onChange={(event) => update('javaHome', event.target.value)} disabled={running}>
        <option value="">System default</option>
        {jdks.map(({ home, label }) => <option key={home} value={home}>{label} · {home}</option>)}
      </select></label>
      <label>Debugger port<input type="number" min="1024" max="65535" value={config.debugPort} onChange={(event) => update('debugPort', event.target.value)} disabled={running} /></label>
      <label><input type="checkbox" checked={config.suspend} onChange={(event) => update('suspend', event.target.checked)} disabled={running} /> Wait for Resume when there are no breakpoints</label>
      {breakpointLines.length > 0 && <div className="java-breakpoint-commands">
        <strong>Breakpoints in this class</strong>
        <pre>{breakpointLines.join(', ')}</pre>
      </div>}
      <label>Environment variables<textarea placeholder="SPRING_PROFILES_ACTIVE=dev" value={config.environment} onChange={(event) => update('environment', event.target.value)} disabled={running} /></label>
      {!validConfig && <small role="status">Use a port from 1024 to 65535 and enter one NAME=value per line.</small>}
      </div> : <p>Open a server workspace with a Java main class to configure it.</p>}
    </div>
    <footer>
      {configError && <small role="alert">{configError}</small>}
      <button type="button" onClick={() => setDrafts((previous) => ({ ...previous, [target.path]: defaults }))} disabled={!target || running}>Reset</button>
      <button type="button" onClick={closeConfiguration}>Cancel</button>
      <button type="button" className="primary" onClick={saveConfiguration} disabled={!validConfig || running}>Save</button>
      <button type="button" className="primary" onClick={() => {
        if (!saveConfiguration()) return
        onStartDebug()
        setGoal('application')
        void run(true, 'application', undefined, target.path, config)
      }} disabled={!validConfig || running}>Start Debug</button>
    </footer>
  </dialog>, document.body)}</>
}
