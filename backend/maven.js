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
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.name.startsWith('.') || ['target', 'build', 'dist', 'node_modules'].includes(entry.name)) continue
      const file = path.join(directory, entry.name)
      if (entry.isDirectory()) visit(file, pom, inSources)
      if ((pom && !inSources) || !entry.isFile() || !entry.name.endsWith('.java') || fs.statSync(file).size > 512000) continue
      const source = fs.readFileSync(file, 'utf8').replace(/"(?:\\.|[^"\\])*"|\/\*[\s\S]*?\*\/|\/\/[^\r\n]*/g, '')
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
    : ['/usr/lib/jvm']
  for (const directory of directories) {
    try {
      for (const entry of fs.readdirSync(directory)) homes.add(path.join(directory, entry))
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
    const { id, action, breakpoints } = req.body || {}
    const session = debugSessions.get(id)
    if (!session || req.get('x-aether-build') !== 'maven' || req.get('origin') !== session.origin) {
      return res.status(404).json({ error: 'Debug session is no longer available.' })
    }
    if (!Object.hasOwn(actions, action) && action !== 'mute' && action !== 'breakpoints') return res.sendStatus(400)
    if (!session.act(action, breakpoints)) return res.status(409).json({ error: 'Wait for the debugger to pause.' })
    res.sendStatus(204)
  })
  let active = false
  app.get('/api/maven/applications', (_req, res) => {
    try {
      res.json({ applications: root() ? discoverApplications(root()) : [], jdks: findJdks() })
    } catch {
      res.status(400).json({ error: 'Could not scan the active workspace for Java applications.' })
    }
  })
  function run(req, res, javaOnly) {
    const loopbackHost = /^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i
    let originHost
    try { originHost = new URL(req.get('origin')).host } catch {}
    if (!loopbackHost.test(req.get('host')) || !loopbackHost.test(originHost) || req.get('x-aether-build') !== 'maven') {
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
    if (active) return res.status(409).json({ error: 'A Maven build is already running.' })

    let cwd
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
      const { javaHome, variables = {}, debug = false, debugPort = 5005 } = configuration || {}
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
    active = true
    res.type('application/x-ndjson')
    res.set?.('Cache-Control', 'no-cache, no-transform')
    res.flushHeaders()
    const emit = (event) => { if (!res.destroyed) res.write(JSON.stringify(event) + '\n') }
    let child
    let debuggerProcess
    let startupTimer
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
          clearTimeout(startupTimer)
          const commands = muted ? [] : breakpointCommands('stop at')
          if (configuration?.suspend === false || lines.length) commands.push('cont')
          else paused = true
          emit({ type: 'debug-state', id: debugId, paused, muted })
          if (commands.length) send(commands)
        } else if (/Breakpoint hit:|Step completed:|Exception occurred:/.test(report)) {
          paused = true
          atLocation = true
          emit({ type: 'debug-state', paused, muted, atLocation })
          send(['threads', 'where', 'locals'])
        } else if (paused && /\[\d+\] /.test(report)) {
          emit({ type: 'debug-inspection', text: report })
        }
      })
      debuggerProcess.on('close', (code) => {
        debugSessions.delete(debugId)
        if (finishing) return
        emit({ type: 'debug-state', paused: false, id: null })
        if (code !== 0 || !initialized) stopProcess(child)
      })
    }
    function finish(code) {
      finishing = true
      clearTimeout(startupTimer)
      debugSessions.delete(debugId)
      debuggerProcess?.kill()
      active = false
      if (outputDir) fs.promises.rm(outputDir, { recursive: true, force: true }).catch(() => {})
      emit({ type: 'exit', code })
      res.end()
    }
    function launch(command, argumentsToRun, next, batch = false, debuggerCommand) {
      if (!javaOnly) emit({ type: 'output', text: '$ ' + command + ' ' + argumentsToRun.join(' ') + '\n' })
      child = batch && windows
        ? spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/c', command, ...argumentsToRun], { cwd, env, windowsHide: true })
        : spawn(command, argumentsToRun, { cwd, env, detached: !windows, windowsHide: true })
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
      child.on('close', (code) => code === 0 && next && !res.destroyed ? next() : finish(code))
    }
    res.on('close', () => { if (child) stopProcess(child) })
    if (goal !== 'application') return launch(executable, args, null, true)
    const javaTool = (tool) => {
      const name = windows ? tool + '.exe' : tool
      return env.JAVA_HOME ? path.join(env.JAVA_HOME, 'bin', name) : name
    }
    const debugArgs = debugAddress ? [`-agentlib:jdwp=transport=dt_socket,server=y,suspend=y,address=${debugAddress}`] : []
    const debuggerCommand = debugAddress && javaTool('jdb')
    if (springJar) {
      return launch(javaTool('java'), [...debugArgs, '-jar', springJar], null, false, debuggerCommand)
    }
    const classpath = outputDir
    launch(javaTool('javac'), ['-encoding', 'UTF-8', ...(debugAddress ? ['-g'] : []), '-proc:none', '-classpath', classpath,
      '-sourcepath', singleClass.sourceRoot, '-d', outputDir, sourceFile],
    () => launch(javaTool('java'), [...debugArgs, '-cp', classpath, singleClass.name], null, false, debuggerCommand))
  }
  app.post('/api/java/run', (req, res) => run(req, res, true))
  app.post('/api/maven/run', (req, res) => run(req, res, false))
}

module.exports = { mountMaven }

