const { spawn } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { randomUUID } = require('node:crypto')

const goals = new Set(['clean', 'validate', 'compile', 'test', 'package', 'verify', 'install', 'site', 'clean install', 'compiler:compile', 'jar:jar', '--version'])

function discoverApplications(workspace) {
  const applications = []
  function visit(directory, pom = null, inSources = false) {
    if (fs.existsSync(path.join(directory, 'pom.xml'))) pom = path.relative(workspace, path.join(directory, 'pom.xml')).split(path.sep).join('/')
    inSources ||= directory.endsWith(path.join('src', 'main', 'java'))
    let entries
    try {
      entries = fs.readdirSync(directory, { withFileTypes: true })
    } catch (err) {
      if (directory === workspace) throw err
      return
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.') || ['target', 'build', 'dist', 'node_modules'].includes(entry.name)) continue
      const file = path.join(directory, entry.name)
      if (entry.isDirectory()) visit(file, pom, inSources)
      if ((pom && !inSources) || !entry.isFile() || !entry.name.endsWith('.java')) continue
      let source
      try {
        if (fs.statSync(file).size > 512000) continue
        source = fs.readFileSync(file, 'utf8').replace(/"(?:\\.|[^"\\])*"|\/\*[\s\S]*?\*\/|\/\/[^\r\n]*/g, '')
      } catch {
        continue
      }
      if (!/\b(?:public\s+static|static\s+public)\s+void\s+main\s*\(\s*(?:final\s+)?(?:java\.lang\.)?String\s*(?:(?:\[\s*\]|\.\.\.)\s*[\w$]+|[\w$]+\s*\[\s*\])\s*\)/.test(source)) continue
      const pkg = source.match(/\bpackage\s+([\w.]+)\s*;/)?.[1]
      const className = [pkg, entry.name.slice(0, -5)].filter(Boolean).join('.')
      applications.push({
        className, pom, path: path.relative(workspace, file).split(path.sep).join('/'),
        spring: Boolean(pom) && /@(?:[\w.]+\.)?SpringBootApplication\b/.test(source)
      })
    }
  }
  visit(workspace)
  return applications
}

function findJdks() {
  const homes = new Set()
  if (process.env.JAVA_HOME) homes.add(path.resolve(process.env.JAVA_HOME))
  const programFiles = process.env.ProgramFiles
  const directories = process.platform === 'win32' && programFiles
    ? ['Java', 'Eclipse Adoptium', 'Microsoft', 'Amazon Corretto'].map((vendor) => path.join(programFiles, vendor))
    : process.platform === 'darwin'
      ? ['/Library/Java/JavaVirtualMachines', path.join(os.homedir(), 'Library', 'Java', 'JavaVirtualMachines')]
      : ['/usr/lib/jvm']
  for (const directory of directories) {
    try {
      for (const entry of fs.readdirSync(directory)) {
        const entryPath = path.join(directory, entry)
        homes.add(process.platform === 'darwin' && entry.endsWith('.jdk')
          ? path.join(entryPath, 'Contents', 'Home') : entryPath)
      }
    } catch {}
  }
  const executable = process.platform === 'win32' ? 'javac.exe' : 'javac'
  return [...homes].flatMap((home) => {
    if (!fs.existsSync(path.join(home, 'bin', executable))) return []
    try {
      const version = fs.readFileSync(path.join(home, 'release'), 'utf8').match(/^JAVA_VERSION="([^"]+)"/m)?.[1]
      return [{ home, label: version ? `JDK ${version}` : path.basename(home) }]
    } catch {
      return [{ home, label: path.basename(home) }]
    }
  })
}

function stopProcess(child) {
  if (!child.pid || child.exitCode !== null) return
  if (process.platform === 'win32') {
    const killer = spawn('taskkill.exe', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true })
    killer.on('error', () => child.kill())
  } else {
    try { process.kill(-child.pid, 'SIGTERM') } catch {}
  }
}

function mountMaven(app, { root, safeJoin }) {
  const debugSessions = new Map()
  const actions = { resume: 'cont', over: 'next', into: 'step', out: 'step up' }
  app.post('/api/java/debug/action', (req, res) => {
    const { id, action, breakpoints, frame, expression } = req.body || {}
    const session = debugSessions.get(id)
    if (!session || req.get('x-aether-build') !== 'maven' || req.get('origin') !== session.origin) {
      return res.status(404).json({ error: 'Debug session is no longer available.' })
    }
    if (!Object.hasOwn(actions, action) && action !== 'mute' && action !== 'breakpoints' && action !== 'frame' && action !== 'evaluate') return res.sendStatus(400)
    if (!session.act(action, action === 'frame' ? frame : action === 'evaluate' ? expression : breakpoints)) return res.status(409).json({ error: 'Wait for the debugger to pause.' })
    res.sendStatus(204)
  })
  let active = null
  const loopbackHost = /^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i
  const localBuildRequest = (req) => {
    try {
      return loopbackHost.test(req.get('host')) && loopbackHost.test(new URL(req.get('origin')).host) &&
        req.get('x-aether-build') === 'maven'
    } catch { return false }
  }
  const describeRun = ({ id, goal, project, application, startedAt, pid }) =>
    ({ id, goal, project, application, startedAt, pid })
  app.post('/api/maven/stop', (req, res) => {
    if (!localBuildRequest(req)) return res.sendStatus(403)
    if (!active || active.id !== req.body?.id || active.origin !== req.get('origin')) {
      return res.status(404).json({ error: 'That run has already ended or belongs to a different session.' })
    }
    active.stop()
    res.sendStatus(204)
  })
  app.get('/api/maven/applications', (req, res) => {
    try {
      if (req.query?.project && req.query.project !== root()) {
        return res.status(409).json({ error: 'The active workspace changed. Reopen this project to load its Java main classes.' })
      }
      res.json({ applications: root() ? discoverApplications(root()) : [], jdks: findJdks() })
    } catch {
      res.status(400).json({ error: 'Could not scan the active workspace for Java applications.' })
    }
  })
  function run(req, res, javaOnly) {
    if (!localBuildRequest(req)) {
      return res.status(403).json({ error: 'Open Aether on localhost to run Maven.' })
    }

    const { goal, project, application, pom = 'pom.xml', offline, skipTests, configuration } = req.body || {}
    if (javaOnly && goal !== 'application') {
      return res.status(400).json({ error: 'Use the Maven tool window to run a Maven goal.' })
    }
    if (!javaOnly && goal === 'application') {
      return res.status(400).json({ error: 'Reload Aether to use the Java runner.' })
    }
    const standalone = goal === 'application' && pom === null
    if ((!goals.has(goal) && goal !== 'application') || (!standalone && (typeof pom !== 'string' || path.basename(pom) !== 'pom.xml'))) {
      return res.status(400).json({ error: 'Select a Maven goal and a pom.xml file.' })
    }
    if (!root() || project !== root()) return res.status(409).json({ error: 'The active server workspace changed.' })
    if (active) return res.status(409).json({
      error: 'Ather Studio already has a Maven or Java run active.',
      activeRun: active.origin === req.get('origin') ? describeRun(active) : undefined
    })

    let cwd
    let applicationCwd
    let programArgs = []
    let vmOptions = []
    let inputFile
    let logFile
    let sourceFile
    try {
      const file = fs.realpathSync(safeJoin(standalone ? application : pom))
      const relative = path.relative(fs.realpathSync(root()), file)
      if (path.isAbsolute(relative) || relative.split(path.sep)[0] === '..' || !fs.statSync(file).isFile()) {
        return res.status(400).json({ error: 'The POM must be inside the workspace.' })
      }
      cwd = standalone ? root() : path.dirname(file)
      if (standalone) sourceFile = file
    } catch {
      return res.status(400).json({ error: 'The selected pom.xml could not be opened.' })
    }

    const env = { ...process.env }
    let debugAddress
    let debugClass
    let singleClass
    let springJar
    const windows = process.platform === 'win32'
    if (goal === 'application') {
      let target
      try {
        target = discoverApplications(root()).find((item) => item.path === application && item.pom === pom)
      } catch {}
      if (!target || !/^[\w.$]+$/.test(target.className)) return res.status(400).json({ error: 'Select a detected Java main class.' })
      if (target.spring) {
        const output = path.join(cwd, 'target')
        let jars = []
        try {
          jars = fs.readdirSync(output, { withFileTypes: true })
            .filter((entry) => entry.isFile() && entry.name.endsWith('.jar'))
            .map((entry) => entry.name)
          // Spring Boot's default repackage goal leaves the original jar beside the executable.
          jars = jars.filter((name) => fs.existsSync(path.join(output, name + '.original')))
        } catch {}
        if (jars.length !== 1) {
          return res.status(409).json({ error: 'Build this Spring Boot module explicitly from the Maven tool window or run mvn clean install. Run and Debug need one Spring Boot executable jar in target/.' })
        }
        springJar = path.join(output, jars[0])
      } else {
        let realWorkspace
        try {
          sourceFile ||= fs.realpathSync(safeJoin(target.path))
          realWorkspace = fs.realpathSync(root())
        } catch {
          return res.status(400).json({ error: 'The selected Java source could not be opened.' })
        }
        const relative = path.relative(realWorkspace, sourceFile)
        if (path.isAbsolute(relative) || relative.split(path.sep)[0] === '..') {
          return res.status(400).json({ error: 'The Java source must be inside the workspace.' })
        }
        const packageDepth = target.className.split('.').length - 1
        let sourceRoot = path.dirname(sourceFile)
        for (let depth = 0; depth < packageDepth && sourceRoot !== realWorkspace; depth++) sourceRoot = path.dirname(sourceRoot)
        singleClass = { name: target.className, sourceRoot }
      }
      const { javaHome, variables = {}, debug = false, debugPort = 5005,
        arguments: args = [], vmOptions: options = [], workingDirectory, redirectInput, consoleOutput } = configuration || {}
      const validArgs = (values) => Array.isArray(values) && values.length <= 100 &&
        values.every((value) => typeof value === 'string' && value.length <= 2048 && !value.includes('\0'))
      if (!validArgs(args) || !validArgs(options) || options.some((option) =>
        !/^(?:-D[^=\s]+(?:=.*)?|-Xm[sx]\d+[kKmMgG]?|-(?:ea|da))$/.test(option))) {
        return res.status(400).json({ error: 'Check program arguments and VM options. Supported VM options include -D, -Xms, -Xmx, -ea, and -da.' })
      }
      const workspace = fs.realpathSync(root())
      const resolveWorkspaceItem = (value, directory) => {
        const resolved = fs.realpathSync(path.resolve(workspace, value))
        const relative = path.relative(workspace, resolved)
        if (path.isAbsolute(relative) || relative.split(path.sep)[0] === '..') throw Error('outside workspace')
        if (directory ? !fs.statSync(resolved).isDirectory() : !fs.statSync(resolved).isFile()) throw Error('wrong file type')
        return resolved
      }
      try {
        applicationCwd = workingDirectory ? resolveWorkspaceItem(workingDirectory, true) : cwd
        inputFile = redirectInput ? resolveWorkspaceItem(redirectInput, false) : null
        if (consoleOutput) {
          if (typeof consoleOutput !== 'string' || !/\.log$/i.test(consoleOutput)) throw Error('not a log file')
          const directory = resolveWorkspaceItem(path.dirname(consoleOutput), true)
          logFile = path.join(directory, path.basename(consoleOutput))
        }
      } catch {
        return res.status(400).json({ error: 'Choose project paths for the working directory, input file, and a .log output file.' })
      }
      programArgs = args
      vmOptions = options
      if (javaHome) {
        if (!findJdks().some(({ home }) => home === javaHome)) return res.status(400).json({ error: 'Select an installed JDK.' })
        env.JAVA_HOME = javaHome
      }
      if (!variables || typeof variables !== 'object' || Array.isArray(variables) || Object.entries(variables).some(([key, value]) =>
        !/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) ||
        /^(PATH|PATHEXT|COMSPEC|SYSTEMROOT|WINDIR|HOME|USERPROFILE|CLASSPATH|SHELL|NODE_OPTIONS|JAVA.*|JDK.*|_JAVA.*|MAVEN.*|M2.*|LD_.*|DYLD_.*)$/i.test(key) ||
        typeof value !== 'string' || value.includes('\0') || value.length > 8192
      )) return res.status(400).json({ error: 'Check environment variable names and values. Java and Maven runtime settings are managed separately.' })
      Object.assign(env, variables)
      if (debug === true) {
        if (!Number.isInteger(debugPort) || debugPort < 1024 || debugPort > 65535) {
          return res.status(400).json({ error: 'Use a debugger port between 1024 and 65535.' })
        }
        debugAddress = `127.0.0.1:${debugPort}`
        debugClass = target.className
      }
    }
    const args = goal === '--version' ? [goal] : [
      '-B', '-Dstyle.color=never', ...goal.split(' '),
      ...(offline === true ? ['-o'] : []),
      ...(skipTests === true ? ['-DskipTests'] : [])
    ]
    const wrapper = windows ? 'mvnw.cmd' : 'mvnw'
    const executable = goal !== '--version' && fs.existsSync(path.join(cwd, wrapper))
      ? (windows ? '.\\mvnw.cmd' : './mvnw')
      : windows ? 'mvn.cmd' : 'mvn'
    let outputDir
    if (singleClass) {
      try { outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aether-run-')) }
      catch { return res.status(503).json({ error: 'Could not create the Java compiler output directory.' }) }
    }
    let logHandle
    try {
      if (logFile) logHandle = fs.openSync(logFile, 'wx')
    } catch {
      if (outputDir) fs.promises.rm(outputDir, { recursive: true, force: true }).catch(() => {})
      return res.status(400).json({ error: 'Choose a new .log file. Existing files are preserved.' })
    }
    const run = {
      id: randomUUID(), goal, project, application, origin: req.get('origin'),
      startedAt: Date.now(), pid: null, stop: () => requestStop()
    }
    active = run
    res.type('application/x-ndjson')
    res.set?.('Cache-Control', 'no-cache, no-transform')
    res.flushHeaders()
    const emit = (event) => {
      if (event.type === 'output' && logHandle !== undefined) {
        try { fs.writeFileSync(logHandle, event.text) }
        catch {
          fs.closeSync(logHandle)
          logHandle = undefined
          if (!res.destroyed) res.write(JSON.stringify({ type: 'output', text: 'Unable to continue writing the console log.\n' }) + '\n')
        }
      }
      if (!res.destroyed) res.write(JSON.stringify(event) + '\n')
    }
    let child
    let debuggerProcess
    let startupTimer
    let stopTimer
    let stopping = false
    let finishing = false
    const debugId = randomUUID()
    const validLines = (lines) => Array.isArray(lines)
      ? [...new Set(lines.filter((line) => Number.isSafeInteger(line) && line > 0))].slice(0, 200) : []
    function attach(command) {
      let lines = validLines(configuration?.breakpoints)
      const className = singleClass?.name || debugClass
      let muted = configuration?.muted === true
      let paused = false
      let atLocation = false
      let initialized = false
      let transcript = ''
      let selectedFrame = 0
      let frames = []
      let thread = ''
      let variables = []
      let inspectionPending = false
      let expressionPending = null
      const arraysRequested = new Set()
      const arrayQueue = []
      let arrayInFlight = null
      const startArrayPreview = () => {
        if (!arrayInFlight && arrayQueue.length) {
          arrayInFlight = arrayQueue.shift()
          send(['dump ' + arrayInFlight])
        }
      }
      const clearArrayPreviews = () => {
        arraysRequested.clear()
        arrayQueue.length = 0
        arrayInFlight = null
      }
      const send = (commands) => debuggerProcess.stdin.write(commands.join('\n') + '\n')
      const breakpointCommands = (verb) => lines.map((line) => `${verb} ${className}:${line}`)
      debuggerProcess = spawn(command, ['-J-Duser.language=en', '-J-Duser.country=US', '-connect', `com.sun.jdi.SocketAttach:hostname=127.0.0.1,port=${debugAddress.split(':').at(-1)}`], { windowsHide: true, env })
      debuggerProcess.stdin.on('error', () => {})
      debuggerProcess.on('error', () => {
        emit({ type: 'debug-error', message: 'Could not start jdb from the selected JDK.' })
        stopProcess(child)
      })
      debuggerProcess.stderr.setEncoding('utf8').on('data', (message) => emit({ type: 'debug-error', message }))
      debugSessions.set(debugId, { origin: req.get('origin'), act(action, breakpoints) {
        if (action === 'evaluate') {
          if (!paused || inspectionPending || arrayInFlight || expressionPending || typeof breakpoints !== 'string' ||
            !/^[A-Za-z_$][\w$]*(?:\s*\[\s*(?:\d+|[A-Za-z_$][\w$]*)\s*\]|\.[A-Za-z_$][\w$]*)*$/.test(breakpoints) ||
            breakpoints.length > 128) return false
          expressionPending = breakpoints
          send(['print ' + expressionPending])
          return true
        }
        if (action === 'frame') {
          if (!paused || inspectionPending || arrayInFlight || expressionPending || !Number.isInteger(breakpoints) || !frames[breakpoints]) return false
          const delta = breakpoints - selectedFrame
          if (!delta) return true
          selectedFrame = breakpoints
          variables = []
          clearArrayPreviews()
          inspectionPending = true
          send([delta > 0 ? 'up ' + delta : 'down ' + -delta, 'locals'])
          return true
        }
        if (action === 'breakpoints' && initialized) {
          const next = validLines(breakpoints)
          const commands = [
            ...lines.filter((line) => !next.includes(line)).map((line) => `clear ${className}:${line}`),
            ...next.filter((line) => !lines.includes(line)).map((line) => `stop at ${className}:${line}`)
          ]
          lines = next
          if (!muted && commands.length) send(commands)
          return true
        }
        if (!paused || (action !== 'resume' && action !== 'mute' && !atLocation)) return false
        if (action === 'mute') {
          muted = !muted
          if (lines.length) send(breakpointCommands(muted ? 'clear' : 'stop at'))
          emit({ type: 'debug-state', paused, muted })
        } else {
          inspectionPending = false
          clearArrayPreviews()
          expressionPending = null
          paused = false
          atLocation = false
          emit({ type: 'debug-state', paused, muted, atLocation })
          send([actions[action]])
        }
        return true
      } })
      debuggerProcess.stdout.setEncoding('utf8').on('data', (chunk) => {
        transcript = (transcript + chunk).slice(-64000)
        if (!/(?:>|\[\d+\])[ \t]*$/.test(transcript)) return
        const report = transcript
        transcript = ''
        if (!initialized) {
          initialized = true
          emit({ type: 'output', text: 'Connected to the Java debugger at ' + debugAddress + '.\n' })
          clearTimeout(startupTimer)
          const commands = muted ? [] : breakpointCommands('stop at')
          if (configuration?.suspend === false || lines.length) commands.push('cont')
          else paused = true
          emit({ type: 'debug-state', id: debugId, paused, muted })
          if (commands.length) send(commands)
        } else if (/Breakpoint hit:|Step completed:|Exception occurred:/.test(report)) {
          paused = true
          atLocation = true
          selectedFrame = 0
          frames = []
          variables = []
          clearArrayPreviews()
          inspectionPending = true
          thread = report.match(/thread="([^"]+)"/)?.[1] || report.match(/([\w.$-]+)\[\d+\][ \t]*$/)?.[1] || ''
          emit({ type: 'debug-state', paused, muted, atLocation })
          send(['where', 'locals'])
        } else if (paused && arrayInFlight) {
          const dump = /^\s*(?:[\w.$-]+\[\d+\]\s*)?([\w$]+)\s*=[ \t]*\{([\s\S]*?)\}/m.exec(report)
          if (dump?.[1] === arrayInFlight) {
            const variable = variables.find(({ name }) => name === arrayInFlight)
            if (variable) variable.value = '[' + dump[2].trim().replace(/\s*\r?\n\s*/g, ' ') + ']'
            emit({ type: 'debug-inspection', thread, frames, variables, selectedFrame })
          }
          arrayInFlight = null
          startArrayPreview()
        } else if (paused && expressionPending) {
          const text = report.replace(/^[\w.$-]+\[\d+\] ?/gm, '').trim()
          if (text) {
            emit({ type: 'debug-evaluation', expression: expressionPending, text })
            expressionPending = null
          }
        } else if (paused) {
          const stack = [...report.matchAll(/^\s*(?:[\w.$-]+\[\d+\]\s*)?\[(\d+)\]\s+([^\s(]+)\s*\(([^)]+)\)/gm)]
          if (stack.length) frames = stack.map(([, , method, location]) => {
            const source = /^(.*):([\d,]+)$/.exec(location)
            const declaringType = method.slice(0, method.lastIndexOf('.')).split('$')[0]
            let sourcePath = declaringType === className ? application : null
            if (!sourcePath && source && /^[\w.$]+$/.test(declaringType)) {
              const sourceRoot = singleClass?.sourceRoot || path.join(cwd, 'src', 'main', 'java')
              try {
                const candidate = fs.realpathSync(path.join(sourceRoot, ...declaringType.split('.')) + '.java')
                const relative = path.relative(fs.realpathSync(project), candidate)
                if (!path.isAbsolute(relative) && relative.split(path.sep)[0] !== '..') sourcePath = relative.split(path.sep).join('/')
              } catch {}
            }
            return { method, file: source?.[1] || '', line: source ? Number(source[2].replaceAll(',', '')) : null,
              application: sourcePath }
          })
          const locals = [...report.matchAll(/^\s*(?:[\w.$-]+\[\d+\]\s*)?([\w$]+)\s*=[ \t]*(\{[\s\S]*?\}|[^\r\n]*)/gm)]
          for (const [, name, rawValue] of locals) {
            const length = /^instance of (?:int|long|short|byte|double|float|boolean|char|java\.lang\.String)\[(\d+)\]/.exec(rawValue)?.[1]
            const value = length === '0' ? '[]' : rawValue
            const existing = variables.find((item) => item.name === name)
            if (existing) existing.value = value
            else variables.push({ name, value })
            if (Number(length) > 0 && Number(length) <= 24 && !arraysRequested.has(name) && arraysRequested.size < 4) {
              arraysRequested.add(name)
              arrayQueue.push(name)
            }
          }
          startArrayPreview()
          if (locals.length || stack.length || /Method arguments:|Local variables:|Local variable information not available|No local variables/i.test(report)) {
            if (locals.length || /Local variables:|information not available|No local variables/i.test(report)) inspectionPending = false
            emit({ type: 'debug-inspection', thread, frames, variables, selectedFrame })
          }
        }
      })
      debuggerProcess.on('close', (code) => {
        debugSessions.delete(debugId)
        if (finishing) return
        emit({ type: 'debug-state', paused: false, id: null })
        if (code !== 0 || !initialized) stopProcess(child)
      })
    }
    function requestStop() {
      if (stopping || finishing) return
      stopping = true
      debuggerProcess?.kill()
      if (!child) return
      stopProcess(child)
      if (!windows && child.pid && child.exitCode === null) {
        const processGroup = -child.pid
        stopTimer = setTimeout(() => {
          try { process.kill(processGroup, 'SIGKILL') } catch {}
        }, 3000)
        stopTimer.unref()
      }
    }
    function finish(code) {
      finishing = true
      clearTimeout(startupTimer)
      clearTimeout(stopTimer)
      if (logHandle !== undefined) fs.closeSync(logHandle)
      logHandle = undefined
      debugSessions.delete(debugId)
      debuggerProcess?.kill()
      if (active === run) active = null
      if (outputDir) fs.promises.rm(outputDir, { recursive: true, force: true }).catch(() => {})
      if (debugAddress) emit({ type: 'output', text: '\nJava process finished with ' + (code === null ? 'no exit code' : 'exit code ' + code) + '.\n' })
      emit({ type: 'exit', code })
      res.end()
    }
    function launch(command, argumentsToRun, next, batch = false, debuggerCommand, appProcess = false) {
      if (!javaOnly || (debuggerCommand && appProcess)) emit({ type: 'output', text: '$ ' + command + ' ' + argumentsToRun.join(' ') + '\n' })
      let input
      try {
        input = appProcess && inputFile ? fs.openSync(inputFile, 'r') : undefined
        child = batch && windows
        ? spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/c', command, ...argumentsToRun], { cwd, env, windowsHide: true })
        : spawn(command, argumentsToRun, {
          cwd: appProcess ? applicationCwd : cwd, env, detached: !windows, windowsHide: true,
          ...(input === undefined ? {} : { stdio: [input, 'pipe', 'pipe'] }),
        })
      } catch (error) {
        emit({ type: 'output', text: error.message + '\n' })
        finish(1)
        return
      } finally {
        if (input !== undefined) fs.closeSync(input)
      }
      run.pid = child.pid ?? null
      if (debuggerCommand) startupTimer = setTimeout(() => {
        emit({ type: 'debug-error', message: 'The Java debugger did not connect within 15 seconds. Check the selected JDK and debugger port, then rerun.' })
        stopProcess(child)
      }, 15000)
      for (const stream of [child.stdout, child.stderr]) {
        let startup = ''
        stream.setEncoding('utf8').on('data', (text) => {
          if (!debuggerCommand || debuggerProcess) {
            emit({ type: 'output', text })
            return
          }
          const lines = (startup + text).split('\n')
          startup = lines.pop()
          for (const line of lines) {
            if (!debuggerProcess && /^\s*Listening for transport dt_socket at address:/.test(line)) attach(debuggerCommand)
            else emit({ type: 'output', text: line + '\n' })
          }
          if (debuggerProcess && startup) emit({ type: 'output', text: startup })
        })
        stream.on('end', () => {
          if (!debuggerProcess && startup) emit({ type: 'output', text: startup })
        })
      }
      child.on('error', (error) => emit({ type: 'output', text: error.message + '\n' }))
      child.on('close', (code) => code === 0 && next && !stopping && !res.destroyed ? next() : finish(code))
    }
    res.on('close', requestStop)
    if (goal !== 'application') return launch(executable, args, null, true)
    const javaTool = (tool) => {
      const name = windows ? tool + '.exe' : tool
      return env.JAVA_HOME ? path.join(env.JAVA_HOME, 'bin', name) : name
    }
    const debugArgs = debugAddress ? [`-agentlib:jdwp=transport=dt_socket,server=y,suspend=y,address=${debugAddress}`] : []
    const debuggerCommand = debugAddress && javaTool('jdb')
    if (springJar) {
      return launch(javaTool('java'), [...vmOptions, ...debugArgs, '-jar', springJar, ...programArgs], null, false, debuggerCommand, true)
    }
    const classpath = outputDir
    launch(javaTool('javac'), ['-encoding', 'UTF-8', ...(debugAddress ? ['-g'] : []), '-proc:none', '-classpath', classpath,
      '-sourcepath', singleClass.sourceRoot, '-d', outputDir, sourceFile],
    () => launch(javaTool('java'), [...vmOptions, ...debugArgs, '-cp', classpath, singleClass.name, ...programArgs], null, false, debuggerCommand, true))
  }
  app.post('/api/java/run', (req, res) => run(req, res, true))
  app.post('/api/maven/run', (req, res) => run(req, res, false))
}

module.exports = { mountMaven }
