const { execFile } = require('node:child_process')
const { promisify } = require('node:util')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')

const run = promisify(execFile)

function collectDiagnostics(stderr, diagnostics, name) {
  const lines = stderr.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const match = /^(.+\.java):(\d+): (error|warning): (.+)$/.exec(lines[i])
    if (!match) continue
    const [, origin, line, severity, message] = match
    const caret = /^([\t ]*)\^/.exec(lines[i + 2] || '')
    const details = []
    for (let j = i + 3; /^\s+(?:symbol|location|required|found|reason|where):/.test(lines[j] || ''); j++) {
      details.push(lines[j].trim())
    }
    diagnostics.push({
      line: origin === name ? Number(line) : null,
      column: caret ? caret[1].length + 1 : 1,
      severity,
      message: (origin === name ? '' : path.basename(origin) + ':' + line + ': ') + [message, ...details].join(' · ')
    })
  }
}


function jdkMethodRequests(diagnostics, source) {
  const imports = [...source.matchAll(/^\s*import\s+([\w$.]+(?:\.\*)?)\s*;/gm)].map((entry) => entry[1])
  return diagnostics.flatMap((entry, index) => {
    if (!entry.line) return []
    const symbol = entry.message.match(/symbol:\s+method\s+([\w$]+)\(([^)]*)\)/)
    const receiver = entry.message.match(/location:\s+(?:variable\s+[\w$]+\s+of type\s+|class\s+)([\w$.]+)/)
    if (!symbol || !receiver || symbol[1].length > 128 || receiver[1].length > 256) return []
    const type = receiver[1]
    const [base, ...nested] = type.split('.')
    const simple = nested.length ? '.' + nested.join('.') : ''
    const explicit = imports.find((item) => item.endsWith('.' + base))
    const declaredTypes = [...source.matchAll(/\b(?:class|interface|enum|record)\s+([\w$]+)/g)]
    if (!type.includes('.') && !explicit && declaredTypes.some((entry) => entry[1] === type)) return []
    const candidates = /^(?:java|javax|jdk)\./.test(type) ? [type] : explicit ? [explicit + simple] : [
      'java.lang.' + type,
      ...imports.filter((item) => item.endsWith('.*')).map((item) => item.slice(0, -1) + type),
    ]
    let nesting = 0
    let arity = symbol[2].trim() ? 1 : 0
    for (const character of symbol[2]) {
      if (character === '<') nesting++
      else if (character === '>') nesting--
      else if (character === ',' && nesting === 0) arity++
    }
    return [[String(index), candidates.filter((item) => item.length <= 256).slice(0, 12).join(','), symbol[1], String(arity), String(receiver[0].includes('location: class'))]]
  }).slice(0, 12)
}

async function collectJdkMethodHints(diagnostics, source, env) {
  const requests = jdkMethodRequests(diagnostics, source)
  if (!requests.length) return
  const backend = __dirname.replace(/([\\/])app\.asar(?=[\\/])/, '$1app.asar.unpacked')
  const helper = path.join(backend, 'JdkMethodHints.java')
  const java = env.JAVA_HOME ? path.join(env.JAVA_HOME, 'bin', process.platform === 'win32' ? 'java.exe' : 'java') : 'java'
  // The helper reads the installed JDK's public API. It does not load project classes.
  const { stdout } = await run(java, ['-Dfile.encoding=UTF-8', helper, ...requests.flat()], {
    env, timeout: 3500, maxBuffer: 64 * 1024, windowsHide: true
  })
  for (const row of stdout.trim().split(/\r?\n/)) {
    const [index, name, signature, docPath] = row.split('\t')
    const diagnostic = diagnostics[Number(index)]
    if (!diagnostic || !name || !signature || !docPath) continue
    diagnostic.methodSuggestions ||= []
    diagnostic.methodSuggestions.push({ name, signature, docPath })
  }
}

function mountJavaValidation(app, { root }) {
  let active = 0
  app.post('/api/java/validate', async (req, res) => {
    const { file, source, workspace } = req.body ?? {}
    const name = typeof file === 'string' ? path.basename(file.replace(/\\/g, '/')) : ''
    if (!/^(?:[\p{L}_$][\p{L}\p{N}_$]*|package-info|module-info)\.java$/iu.test(name) ||
        typeof source !== 'string' || Buffer.byteLength(source) > 256 * 1024) {
      return res.status(400).json({ error: 'Validation requires a named Java source file under 256 KB.' })
    }
    if (active >= 2) return res.status(429).json({ error: 'Java validator is busy. Try again shortly.' })
    active++
    let temp
    try {
      temp = await fs.mkdtemp(path.join(os.tmpdir(), 'aether-javac-'))
      await fs.writeFile(path.join(temp, name), source, 'utf8')
      const sourceRoots = [temp]
      const classRoots = [temp]
      // Only look up project types for the server workspace backing this editor.
      if (workspace && workspace === root() && !path.isAbsolute(file)) {
        const normalized = file.replace(/\\/g, '/')
        const module = /^(?:(.*)\/)?src\/(?:main|test)\/java\//.exec(normalized)
        const segments = (module?.[1] || '').split('/')
        if (module && !segments.some((part) => part === '..' || part === '.' || part.includes(':'))) {
          const base = path.resolve(workspace, ...segments)
          const realWorkspace = await fs.realpath(workspace)
          for (const relative of ['src/main/java', ...(normalized.includes('src/test/java/') ? ['src/test/java'] : [])]) {
            const candidate = await fs.realpath(path.join(base, relative)).catch(() => null)
            if (candidate && candidate.startsWith(realWorkspace + path.sep) && !candidate.includes(path.delimiter)) sourceRoots.push(candidate)
          }
          for (const relative of ['target/classes', 'target/test-classes']) {
            const candidate = await fs.realpath(path.join(base, relative)).catch(() => null)
            if (candidate && candidate.startsWith(realWorkspace + path.sep) && !candidate.includes(path.delimiter)) classRoots.push(candidate)
          }
        }
      }
      const env = { ...process.env }
      for (const key of Object.keys(env)) {
        if (/^(?:JDK_JAVAC_OPTIONS|JDK_JAVA_OPTIONS|JAVA_TOOL_OPTIONS|_JAVA_OPTIONS)$/i.test(key)) delete env[key]
      }
      const executable = env.JAVA_HOME ? path.join(env.JAVA_HOME, 'bin', process.platform === 'win32' ? 'javac.exe' : 'javac') : 'javac'
      const diagnostics = []
      try {
        const { stderr } = await run(executable, [
          '-J-Duser.language=en', '-J-Duser.country=US', '-encoding', 'UTF-8', '-proc:none', '-implicit:none',
          '-classpath', classRoots.join(path.delimiter), '-sourcepath', sourceRoots.join(path.delimiter),
          '-d', temp, '-Xlint:rawtypes,unchecked', '-Xmaxwarns', '30', '-Xmaxerrs', '30', name
        ], { cwd: temp, env, timeout: 12000, maxBuffer: 128 * 1024, windowsHide: true })
        if (stderr) collectDiagnostics(stderr, diagnostics, name)
      } catch (error) {
        if (error.code === 'ENOENT') return res.status(503).json({ error: 'Install a JDK and set JAVA_HOME or put javac on PATH.' })
        if (error.killed) return res.status(503).json({ error: 'Java validation timed out.' })
        const lines = (error.stderr || '').split(/\r?\n/)
        collectDiagnostics(error.stderr || '', diagnostics, name)
        if (!diagnostics.length) {
          const message = lines.find((line) => /^(?:error|warning):/.test(line))
          if (message) diagnostics.push({ line: null, severity: 'error', message })
          else return res.status(503).json({ error: 'The Java compiler could not complete validation.' })
        }
      }
      await collectJdkMethodHints(diagnostics, source, env).catch(() => {})
      res.json({ diagnostics })
    } catch {
      res.status(503).json({ error: 'The Java validator could not prepare the source file.' })
    } finally {
      if (temp) await fs.rm(temp, { recursive: true, force: true }).catch(() => {})
      active--
    }
  })
}

module.exports = { mountJavaValidation }
