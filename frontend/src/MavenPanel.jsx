import { debuggerValues } from './debuggerValues.js'
import TreeIcon from './TreeIcon.jsx'
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

const goals = ['clean', 'validate', 'compile', 'test', 'package', 'verify', 'install', 'site', 'clean install', 'compiler:compile', 'jar:jar', '--version']
const defaults = { name: '', javaHome: '', environment: '', programArguments: '', vmOptions: '', workingDirectory: '', redirectInput: '', consoleOutput: '', debugPort: 5005, suspend: true }
const optionFields = [['vmOptions', 'Add VM options'], ['redirectInput', 'Redirect input'], ['consoleOutput', 'Save console output to file'], ['debugger', 'Debugger settings']]
const argumentLines = (value) => value.split(/\r?\n/).filter((arg) => arg.length > 0)

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

export default function MavenPanel({
  project,
  tree,
  visible,
  mode,
  onSessionChange,
  onRunningChange,
  onRegisterStop,
  onHide,
  applications,
  jdks,
  breakpointsByFile = {},
  selectedApplication,
  onSelectApplication,
  launch,
  launchRequest,
  onLaunchHandled,
  onStartApplication,
  onDebugLocation,
  debugSourceLine,
  terminal,
  onToggleTerminal,
  options,
  setOptions,
  isResizing,
  onResizeStart,
  onTouchResizeStart,
  onResizeReset
}) {
  const poms = usePoms(tree)
  const configKey = 'aether.runConfigurations:' + project
  const [configs, setConfigs] = useState(() => {
    try { return JSON.parse(localStorage.getItem(configKey) || '{}') || {} } catch { return {} }
  })
  const [editing, setEditing] = useState(false)
  const [drafts, setDrafts] = useState({})
  const [configError, setConfigError] = useState('')
  const [visibleOptions, setVisibleOptions] = useState({})
  const [launchMode, setLaunchMode] = useState('debug')
  const dialog = useRef(null)
  const lastConfigLaunch = useRef(launch)
  const [command, setCommand] = useState('')
  const [selected, setSelected] = useState('')
  const [goal, setGoal] = useState('compile')
  const [trusted, setTrusted] = useState(false)
  const [status, setStatus] = useState('Ready')
  const [activeRun, setActiveRun] = useState(null)
  const [stoppingRun, setStoppingRun] = useState(false)
  const [output, setOutput] = useState('')
  const [session, setSession] = useState('')
  const [debugView, setDebugView] = useState('console')
  const [debugTarget, setDebugTarget] = useState(null)
  const [running, setRunning] = useState(false)
  const [debugState, setDebugState] = useState({ paused: false, muted: false })
  const [inspection, setInspection] = useState(null)
  const [expression, setExpression] = useState('')
  const [evaluation, setEvaluation] = useState(null)
  const [watches, setWatches] = useState([])
  const [comparison, setComparison] = useState(null)
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
  function saveConfiguration(close = true) {
    const next = { ...configs, [target.path]: config }
    try {
      localStorage.setItem(configKey, JSON.stringify(next))
      setConfigs(next)
      setStatus('Configuration saved for ' + target.className)
      if (close) closeConfiguration()
      else setDrafts((previous) => ({ ...previous, [target.path]: undefined }))
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

  useEffect(() => {
    if (session === 'Debug') onSessionChange?.('debug')
    else if (session === 'Run') onSessionChange?.('run')
    else if (session === 'Build') onSessionChange?.('build')
  }, [session, onSessionChange])

  useEffect(() => {
    if (mode === 'build' && session !== 'Build') {
      setGoal('compile')
      setSession('Build')
    } else if (mode === 'run' && session !== 'Run') {
      setGoal('application')
      setSession('Run')
    } else if (mode === 'debug' && session !== 'Debug') {
      setSession('Debug')
    }
  }, [mode])

  useEffect(() => {
    onRunningChange?.(running)
  }, [running, onRunningChange])

  useEffect(() => {
    if (onRegisterStop) {
      onRegisterStop(() => {
        request.current?.abort()
        if (activeRun) void stopActiveRun()
      })
    }
  }, [onRegisterStop, activeRun])

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
    setEvaluation(null)
    setComparison(null)
    if (debug) {
      setDebugView('console')
      const lines = breakpointsByFile[runTarget.path] || []
      setDebugTarget({ application: runTarget.path, name: runTarget.className, lines })
      setDebugState((previous) => ({ muted: previous.muted, paused: false }))
      setInspection(null)
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
    setActiveRun(null)
    const controller = new AbortController()
    request.current = controller
    let startupTimedOut = false
    const startupTimer = debug ? setTimeout(() => {
      startupTimedOut = true
      controller.abort()
    }, 60000) : null
    setRunning(true)
    setStatus(debug ? 'Starting debugger…' : 'Running ' + goalToRun)
    let pendingOutput = ''
    let flushTimer = null
    const flushOutput = () => {
      if (pendingOutput) {
        const chunk = pendingOutput
        pendingOutput = ''
        setOutput((previous) => (previous + chunk).slice(-160000))
      }
    }
    const append = (text) => {
      pendingOutput += text
      if (!flushTimer) {
        flushTimer = setTimeout(() => {
          flushTimer = null
          flushOutput()
        }, 40)
      }
    }
    // Build breakpointsByClass: map file paths to fully-qualified class names
    const breakpointsByClass = {}
    if (debug && breakpointsByFile) {
      for (const [filePath, bpLines] of Object.entries(breakpointsByFile)) {
        if (!bpLines || !bpLines.length) continue
        // Try to find the application entry for this file to get the className
        const appEntry = applications.find(({ path }) => path === filePath)
        if (appEntry) {
          breakpointsByClass[appEntry.className] = bpLines
        } else {
          // Derive class name from file path: src/main/java/com/example/Foo.java -> com.example.Foo
          const javaMatch = filePath.match(/src\/main\/java\/(.+)\.java$/)
          if (javaMatch) {
            const className = javaMatch[1].replace(/\//g, '.')
            breakpointsByClass[className] = bpLines
          }
        }
      }
    }
    try {
      const response = await fetch(applicationRun ? '/api/java/run' : '/api/maven/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Aether-Build': 'maven' },
        body: JSON.stringify({ project, pom: runPom, goal: goalToRun, ...options, application: runTarget?.path,
          configuration: applicationRun ? {
            arguments: argumentLines(runConfig.programArguments), vmOptions: argumentLines(runConfig.vmOptions).map((option) => option.trim()),
            workingDirectory: runConfig.workingDirectory.trim(), redirectInput: runConfig.redirectInput.trim(), consoleOutput: runConfig.consoleOutput.trim(),
            javaHome: runConfig.javaHome, variables: Object.fromEntries(variables), debug, debugPort: Number(runConfig.debugPort), suspend: runConfig.suspend, breakpoints: breakpointsByFile[runTarget.path], breakpointsByClass, muted: debugState.muted } : undefined }),
        signal: controller.signal
      })
      if (!response.ok || !response.headers.get('content-type')?.includes('application/x-ndjson')) {
        const error = await response.json().catch(() => ({}))
        if (response.status === 409 && error.activeRun) setActiveRun(error.activeRun)
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
            if (!event.paused) { setInspection(null); setEvaluation(null) }
            else if (event.atLocation) setDebugView('threads')
          }
          if (event.type === 'debug-inspection') setInspection(event)
          if (event.type === 'debug-evaluation') setEvaluation(event.text)
          if (event.type === 'debug-error') append(event.message + '\n')
          if (event.type === 'exit') {
            finished = true
            if (debug) { setInspection(null); setDebugView('console') }
            setStatus(event.code === 0 ? 'Finished successfully' : `Failed (exit ${event.code ?? 'unknown'})`)
          }
        }
      }
      if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
      flushOutput()
      if (!finished) throw new Error('The process connection ended before reporting an exit code.')
    } catch (error) {
      if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
      flushOutput()
      if (debug) { setInspection(null); setDebugView('console') }
      setStatus(startupTimedOut ? 'Debugger connection timed out' : controller.signal.aborted ? 'Stopped' : 'Failed')
      if (startupTimedOut) append('The backend did not report a debugger connection. Restart Aether and try Debug again.\n')
      else if (!controller.signal.aborted) append(error.message + '\n')
    } finally {
      if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
      flushOutput()
      clearTimeout(startupTimer)
      request.current = null
      setRunning(false)
    }
  }

  const stopActiveRun = async () => {
    setStoppingRun(true)
    try {
      const response = await fetch('/api/maven/stop', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Aether-Build': 'maven' },
        body: JSON.stringify({ id: activeRun.id }),
      })
      if (response.status === 404) setStatus('Previous run already ended. Try Run again.')
      else if (!response.ok) throw new Error('Could not stop the previous run.')
      else setStatus('Stop requested. Try Run again once the previous process exits.')
      setActiveRun(null)
    } catch (error) {
      setStatus(error.message)
    } finally {
      setStoppingRun(false)
    }
  }
  const previousRun = activeRun && (
    <div className="maven-status" role="status">
      {activeRun.application || activeRun.goal} is running in {activeRun.project}
      {activeRun.pid && <span> (PID {activeRun.pid})</span>}
      <button type="button" className="ghost tiny" disabled={stoppingRun} onClick={stopActiveRun}>Stop previous run</button>
    </div>
  )

  const validConfig = Boolean(target) && /^\d+$/.test(String(config.debugPort))
    && Number(config.debugPort) >= 1024 && Number(config.debugPort) <= 65535
    && config.environment.split(/\r?\n/).every((line) => !line.trim() || /^\s*[A-Za-z_][A-Za-z0-9_]*=/.test(line))
  const showDebug = !terminal && session === 'Debug' && debugTarget
  const allBreakpointsByClass = useMemo(() => {
    const map = {}
    if (!breakpointsByFile) return map
    for (const [filePath, lines] of Object.entries(breakpointsByFile)) {
      if (!lines || !lines.length) continue
      const app = applications?.find(({ path }) => path === filePath)
      let className = app?.className
      if (!className) {
        const javaMatch = filePath.match(/(?:src\/(?:main|test)\/java\/)(.+)\.java$/)
        if (javaMatch) className = javaMatch[1].replace(/[/\\]/g, '.')
      }
      if (className) {
        map[className] = lines
      }
    }
    return map
  }, [breakpointsByFile, applications])

  const lastSentBreakpoints = useRef('')
  useEffect(() => {
    if (!running || !debugState.id) return
    const serialized = JSON.stringify(allBreakpointsByClass)
    if (serialized === lastSentBreakpoints.current) return
    lastSentBreakpoints.current = serialized
    const controller = new AbortController()
    fetch('/api/java/debug/action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Aether-Build': 'maven' },
      body: JSON.stringify({ id: debugState.id, action: 'breakpoints', breakpoints: allBreakpointsByClass }),
      signal: controller.signal
    }).then((response) => {
      if (!response.ok) throw new Error('Could not update breakpoints for this session.')
    }).catch((error) => {
      if (!controller.signal.aborted) setStatus(error.message)
    })
    return () => controller.abort()
  }, [running, debugState.id, allBreakpointsByClass])
  useEffect(() => {
    const frame = inspection?.frames?.[inspection.selectedFrame]
    onDebugLocation?.(running && debugState.paused && frame?.application && frame.line
      ? { path: frame.application, line: frame.line, variables: inspection.variables }
      : null)
  }, [debugState.paused, inspection, onDebugLocation, running])

  async function debugAction(action, frame, input) {
    if (action === 'mute' && !running) {
      setDebugState((previous) => ({ ...previous, muted: !previous.muted }))
      return
    }
    try {
      const response = await fetch('/api/java/debug/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Aether-Build': 'maven' },
        body: JSON.stringify({ id: debugState.id, action, frame, expression: input })
      })
      if (!response.ok) throw new Error((await response.json()).error)
    } catch (error) {
      if (action === 'evaluate') setEvaluation('Use a variable, field, or array element in a paused frame.')
      else setStatus(error.message || 'Debugger command failed')
    }
  }
  const canResume = running && debugState.paused && Boolean(debugState.id)
  const canStep = canResume && debugState.atLocation
  const details = debuggerValues(inspection?.variables, debugSourceLine, inspection ? watches : [])
  const compareValue = async (name, value) => {
    try {
      setComparison({ name, value, clipboard: await navigator.clipboard.readText() })
    } catch {
      setStatus('Could not read the clipboard.')
    }
  }
  const resizeHandle = (
    <div
      className={`resizer-handle top ${isResizing ? 'active' : ''}`}
      onMouseDown={onResizeStart}
      onTouchStart={onTouchResizeStart}
      onDoubleClick={onResizeReset}
      title="Drag to resize panel (Double-click to reset)"
    />
  )
  return <>{showDebug ? <section className="maven-panel java-debug-panel" aria-label="Java Debug" hidden={!visible}>
    {resizeHandle}
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
        : <div role="tabpanel" className="java-debug-inspector" aria-label="Threads and variables">
          <div className="java-debug-frames">
            <div className="java-debug-strip">{inspection?.thread ? inspection.thread + ' · Paused' : running ? 'Running' : 'Session ended'}</div>
            {inspection?.frames?.length ? inspection.frames.map((frame, index) => (
              <button key={index} type="button" aria-pressed={inspection.selectedFrame === index}
                title={frame.method} onClick={() => void debugAction('frame', index)}>
                {frame.method.split('.').at(-1)}{frame.line ? ':' + frame.line : ''} <small>{frame.file}</small>
              </button>
            )) : <p>Frames are unavailable.</p>}
          </div>
          <div className="java-debug-variables">
            <form className="java-debug-evaluate" onSubmit={(event) => {
              event.preventDefault()
              if (canStep && expression.trim()) void debugAction('evaluate', undefined, expression.trim())
            }}>
              <input aria-label="Evaluate expression" placeholder="Evaluate expression (Enter)" value={expression}
                disabled={!canStep} onChange={(event) => setExpression(event.target.value)} />
              <button type="submit" className="ghost tiny" disabled={!canStep || !expression.trim()}>Evaluate</button>
              <button type="button" className="ghost tiny" disabled={!canStep || !expression.trim()} onClick={() => {
                const name = expression.replace(/\s/g, '')
                setWatches((previous) => previous.includes(name) ? previous : [...previous, name])
              }}>Add watch</button>
            </form>
            {evaluation && <pre className="java-debug-evaluation" role="status">{evaluation}</pre>}
            {inspection && (inspection.variables?.length || details.watches.length) ? (
              <div className="java-debug-value-list">
                {[
                  ...inspection.variables.map((item) => ({ ...item, kind: 'local' })),
                  ...details.derived.filter(({ name }) => !watches.includes(name)).map((item) => ({ ...item, kind: 'derived' })),
                  ...details.watches.map((item) => ({ ...item, kind: 'watch' })),
                ].map(({ name, value, kind }) => (
                  <div className="java-debug-value-row" key={kind + ':' + name}>
                    <code><span>{name}</span> = {value}</code>
                    {kind === 'watch' && <button type="button" className="ghost tiny" title="Remove watch" aria-label={'Remove watch ' + name}
                      onClick={() => setWatches((previous) => previous.filter((item) => item !== name))}>×</button>}
                    <button type="button" className="ghost tiny" onClick={() => void compareValue(name, value)}>Compare with clipboard</button>
                  </div>
                ))}
              </div>
            ) : <p>{inspection ? 'No variables in this frame.' : 'Pause to inspect variables.'}</p>}
          </div>
        </div>}
      {showBreakpoints && <aside className="java-debug-detail" aria-label="Breakpoints">
        <strong>Breakpoints{debugState.muted ? ' (muted)' : ''}</strong>
        {Object.keys(allBreakpointsByClass).length ? (
          <ul>
            {Object.entries(allBreakpointsByClass).flatMap(([className, lines]) =>
              lines.map((line) => (
                <li key={`${className}:${line}`}>
                  {className.split('.').at(-1)}:{line} <small title={className}>({className})</small>
                </li>
              ))
            )}
          </ul>
        ) : <p>No breakpoints set.</p>}
      </aside>}
    </div>
    {comparison && (
      <div className="java-debug-comparison" role="region" aria-label="Clipboard vs Selected Value">
        <header><strong>Clipboard vs {comparison.name}</strong>
          <span>{comparison.clipboard === comparison.value ? 'Values match' : 'Values differ'}</span>
          <button type="button" className="ghost tiny" onClick={() => setComparison(null)}>Close</button>
        </header>
        <div><section><strong>From clipboard</strong><pre>{comparison.clipboard}</pre></section>
          <section><strong>Selected value</strong><pre>{comparison.value}</pre></section></div>
      </div>
    )}
    <div className="maven-status" role="status">{status}</div>
    {previousRun}
  </section> : <section className={`maven-panel ${terminal ? 'has-run-configuration' : ''}`} aria-label="Maven build tool window" hidden={!visible}>
    {resizeHandle}
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
    {previousRun}
  </section>}
  {editing && createPortal(<dialog ref={dialog} className="java-config-dialog java-run-config-dialog" aria-labelledby="java-config-title" onCancel={(event) => { event.preventDefault(); closeConfiguration() }}>
    <header><strong id="java-config-title">Run/Debug Configurations</strong><button type="button" onClick={closeConfiguration} aria-label="Close configuration">×</button></header>
    <div className="java-config-body">
      <aside aria-label="Applications" className="java-config-tree">
        <strong>⌄ Application</strong>
        {applications.map((item) => <button key={item.path} type="button" title={item.className} aria-pressed={target?.path === item.path}
          onClick={() => onSelectApplication(item.path)}>{configs[item.path]?.name || item.className.split('.').at(-1)}</button>)}
      </aside>
      {target ? <div className="java-config-fields">
        <label className="java-config-row">Name<input value={config.name} placeholder={target.className.split('.').at(-1)} onChange={(event) => update('name', event.target.value)} /></label>
        <section className="java-config-section">
          <div className="java-config-section-heading">
            <strong>Build and run</strong>
            <details className="java-config-options">
              <summary>Modify options</summary>
              <div aria-label="Run options">
                {optionFields.map(([key, label]) => <label key={key}>
                  <input type="checkbox" checked={visibleOptions[key] ?? Boolean(config[key])} onChange={(event) => {
                    setVisibleOptions({ ...visibleOptions, [key]: event.target.checked })
                    if (!event.target.checked && key !== 'debugger') update(key, '')
                  }} />{label}
                </label>)}
              </div>
            </details>
          </div>
          <div className="java-config-runtime">
            <label><span>JDK</span><select value={config.javaHome} onChange={(event) => update('javaHome', event.target.value)}>
              <option value="">System default</option>
              {jdks.map(({ home, label }) => <option key={home} value={home}>{label} · {home}</option>)}
            </select></label>
            <label><span>Main class</span><input readOnly value={target.className} /></label>
          </div>
          <label className="java-config-row">Program arguments<textarea placeholder="One argument per line" value={config.programArguments} onChange={(event) => update('programArguments', event.target.value)} /></label>
          <label className="java-config-row">Working directory<input placeholder={target.pom ? "Maven module directory (default)" : project} value={config.workingDirectory} onChange={(event) => update('workingDirectory', event.target.value)} /></label>
          <label className="java-config-row">Environment variables<textarea placeholder="NAME=value, one per line" value={config.environment} onChange={(event) => update('environment', event.target.value)} /></label>
          {(visibleOptions.vmOptions ?? Boolean(config.vmOptions)) && <label className="java-config-row">VM options<textarea placeholder="-Xmx512m (one option per line)" value={config.vmOptions} onChange={(event) => update('vmOptions', event.target.value)} /></label>}
          {(visibleOptions.redirectInput ?? Boolean(config.redirectInput)) && <label className="java-config-row">Redirect input<input placeholder="Path to a file in the project" value={config.redirectInput} onChange={(event) => update('redirectInput', event.target.value)} /></label>}
          {(visibleOptions.consoleOutput ?? Boolean(config.consoleOutput)) && <label className="java-config-row">Save console output<input placeholder="Path to a new .log file in the project" value={config.consoleOutput} onChange={(event) => update('consoleOutput', event.target.value)} /></label>}
          {visibleOptions.debugger && <div className="java-config-debugger">
            <label className="java-config-row">Debugger port<input type="number" min="1024" max="65535" value={config.debugPort} onChange={(event) => update('debugPort', event.target.value)} /></label>
            <label><input type="checkbox" checked={config.suspend} onChange={(event) => update('suspend', event.target.checked)} /> Wait for Resume when there are no breakpoints</label>
          </div>}
        </section>
        {breakpointLines.length > 0 && <p>Breakpoints in this class · {breakpointLines.join(', ')}</p>}
        {!validConfig && <small role="status">Use a port from 1024 to 65535 and enter one NAME=value per line.</small>}
      </div> : <p>Open a server workspace with a Java main class to configure it.</p>}
    </div>
    <footer>
      {configError && <small role="alert">{configError}</small>}
      <div className="java-config-launch">
        <button type="button" onClick={() => {
          if (!saveConfiguration()) return
          onStartApplication()
          setGoal('application')
          void run(launchMode === 'debug', 'application', undefined, target.path, config)
        }} disabled={!validConfig || running}>{launchMode === 'debug' ? 'Debug' : 'Run'}</button>
        <select aria-label="Launch mode" value={launchMode} onChange={(event) => setLaunchMode(event.target.value)}>
          <option value="run">Run</option><option value="debug">Debug</option>
        </select>
      </div>
      <button type="button" className="primary" onClick={() => saveConfiguration()} disabled={!validConfig || running}>OK</button>
      <button type="button" onClick={closeConfiguration}>Cancel</button>
      <button type="button" onClick={() => saveConfiguration(false)} disabled={!validConfig || running || !drafts[target?.path]}>Apply</button>
    </footer>
  </dialog>, document.body)}</>
}
