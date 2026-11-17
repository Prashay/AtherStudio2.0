const { execFile, spawn } = require('node:child_process')
const { promisify } = require('node:util')
const fs = require('node:fs/promises')
const fsSync = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { createHash } = require('node:crypto')
const { resolveJavaTool } = require('./maven')

const run = promisify(execFile)

// Cache resolved Maven dependency classpaths by module pom.xml path + mtime
const mavenClasspathCache = new Map()

async function resolveMavenClasspath(moduleDir, env) {
  const pomPath = path.join(moduleDir, 'pom.xml')
  let stat
  try {
    stat = await fs.stat(pomPath)
  } catch {
    return []
  }

  const cacheKey = pomPath
  const cached = mavenClasspathCache.get(cacheKey)
  if (cached && cached.mtimeMs === stat.mtimeMs) {
    if (cached.promise) return cached.promise
    return cached.jars || []
  }

  const cpFileHash = createHash('sha1').update(pomPath).digest('hex').slice(0, 16)
  const cpCacheFile = path.join(os.tmpdir(), `aether-mvn-cp-${cpFileHash}.txt`)

  // Check if a cached classpath file on disk is still fresh
  try {
    const cpStat = await fs.stat(cpCacheFile)
    if (cpStat.mtimeMs >= stat.mtimeMs) {
      const content = (await fs.readFile(cpCacheFile, 'utf8')).trim()
      if (content) {
        const jars = content.split(path.delimiter).filter((p) => p && fsSync.existsSync(p))
        mavenClasspathCache.set(cacheKey, { mtimeMs: stat.mtimeMs, jars })
        return jars
      }
    }
  } catch {}

  const isWin = process.platform === 'win32'
  const wrapper = isWin ? 'mvnw.cmd' : 'mvnw'
  const hasWrapper = fsSync.existsSync(path.join(moduleDir, wrapper))
  const mvnCmd = hasWrapper
    ? path.join(moduleDir, wrapper)
    : (isWin ? 'mvn.cmd' : 'mvn')

  const promise = new Promise((resolve) => {
    const args = [
      '-B', '-q',
      'dependency:build-classpath',
      `-Dmdep.outputFile=${cpCacheFile}`,
      '-Dmdep.includeScope=test'
    ]
    const child = spawn(mvnCmd, args, {
      cwd: moduleDir,
      env,
      shell: isWin,
      windowsHide: true
    })
    const timer = setTimeout(() => {
      try { child.kill() } catch {}
      resolve([])
    }, 25000)

    child.on('error', () => {
      clearTimeout(timer)
      resolve([])
    })
    child.on('close', async () => {
      clearTimeout(timer)
      try {
        const content = (await fs.readFile(cpCacheFile, 'utf8')).trim()
        const jars = content ? content.split(path.delimiter).filter((p) => p && fsSync.existsSync(p)) : []
        mavenClasspathCache.set(cacheKey, { mtimeMs: stat.mtimeMs, jars })
        resolve(jars)
      } catch {
        const fallbackJars = await scanLocalM2Repository(pomPath)
        mavenClasspathCache.set(cacheKey, { mtimeMs: stat.mtimeMs, jars: fallbackJars })
        resolve(fallbackJars)
      }
    })
  })

  mavenClasspathCache.set(cacheKey, { mtimeMs: stat.mtimeMs, promise })
  return promise
}

// Fast fallback scan of ~/.m2/repository for common dependencies if mvn command is offline/unavailable
async function scanLocalM2Repository(pomPath) {
  const m2Repo = path.join(os.homedir(), '.m2', 'repository')
  if (!fsSync.existsSync(m2Repo)) return []
  const jars = []
  let pomContent = ''
  try {
    pomContent = await fs.readFile(pomPath, 'utf8')
  } catch {}

  // Pick newest jar per artifact directory inside ~/.m2/repository (capped for speed)
  const maxJars = 350
  async function walk(dir, depth = 0) {
    if (depth > 7 || jars.length >= maxJars) return
    let entries
    try {
      entries = await fs.readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    const jarFiles = entries.filter((e) => e.isFile() && e.name.endsWith('.jar') && !e.name.endsWith('-sources.jar') && !e.name.endsWith('-javadoc.jar'))
    if (jarFiles.length > 0) {
      jarFiles.sort((a, b) => b.name.localeCompare(a.name, undefined, { numeric: true }))
      jars.push(path.join(dir, jarFiles[0].name))
      return
    }
    for (const entry of entries) {
      if (entry.isDirectory() && !entry.name.startsWith('.')) {
        await walk(path.join(dir, entry.name), depth + 1)
      }
    }
  }

  // Prioritize common roots (org/springframework, org/slf4j, org/projectlombok, jakarta, javax, com/fasterxml, etc.)
  const priorityRoots = [
    ['org', 'springframework'],
    ['org', 'slf4j'],
    ['ch', 'qos', 'logback'],
    ['org', 'projectlombok'],
    ['jakarta'],
    ['javax'],
    ['com', 'fasterxml'],
    ['org', 'apache'],
    ['org', 'junit'],
    ['org', 'mockito'],
    ['io']
  ]
  for (const parts of priorityRoots) {
    const candidate = path.join(m2Repo, ...parts)
    if (fsSync.existsSync(candidate)) {
      await walk(candidate, parts.length)
    }
  }
  if (pomContent && jars.length < maxJars) {
    await walk(m2Repo, 0)
  }
  return jars
}

// Check if a diagnostic is a false-positive caused by Lombok annotations when -proc:none is used
function isLombokGeneratedFalsePositive(diagMessage, source) {
  const hasSlf4j = /@(?:lombok\.extern\.(?:slf4j\.Slf4j|log4j\.Log4j2|java\.Log)|Slf4j|Log4j2|Log|CommonsLog)\b/.test(source)
  if (hasSlf4j && /cannot find symbol.*symbol:\s+variable\s+log\b/i.test(diagMessage)) {
    return true
  }
  const hasLombokConstructors = /@(?:lombok\.)?(?:RequiredArgsConstructor|AllArgsConstructor|NoArgsConstructor|Data|Value|Builder|SuperBuilder)\b/.test(source)
  if (hasLombokConstructors) {
    if (/variable\s+\w+\s+(?:not initialized in the default constructor|might not have been initialized)/i.test(diagMessage)) {
      return true
    }
    if (/cannot find symbol.*symbol:\s+constructor\s+\w+/i.test(diagMessage)) {
      return true
    }
    if (/constructor\s+\w+\s+in class\s+\w+\s+cannot be applied to given types/i.test(diagMessage)) {
      return true
    }
  }
  const hasLombokDataOrAccessors = /@(?:lombok\.)?(?:Data|Getter|Setter|Value|Builder|SuperBuilder|RequiredArgsConstructor|AllArgsConstructor|NoArgsConstructor)\b/.test(source)
  if (hasLombokDataOrAccessors) {
    if (/cannot find symbol.*symbol:\s+method\s+(?:get[A-Z]\w*|set[A-Z]\w*|is[A-Z]\w*|builder|toBuilder|equals|hashCode|toString)\(/i.test(diagMessage)) {
      return true
    }
    if (/cannot find symbol.*symbol:\s+class\s+\w+Builder\b/i.test(diagMessage)) {
      return true
    }
    if (/variable\s+\w+\s+(?:not initialized in the default constructor|might not have been initialized)/i.test(diagMessage)) {
      return true
    }
  }
  return false
}


const packageTypos = [
  [/org\.springframework\.steriotype\b/g, 'org.springframework.stereotype'],
  [/org\.springframework\.stereotype\.component\b/g, 'org.springframework.stereotype.Component'],
  [/org\.springframework\.stereotype\.service\b/g, 'org.springframework.stereotype.Service'],
  [/org\.springframework\.stereotype\.repository\b/g, 'org.springframework.stereotype.Repository'],
  [/org\.springframework\.stereotype\.controller\b/g, 'org.springframework.stereotype.Controller'],
  [/org\.springframework\.beans\.factory\.annotation\.autowired\b/g, 'org.springframework.beans.factory.annotation.Autowired'],
  [/lombok\.extern\.slf4j\.slf4j\b/g, 'lombok.extern.slf4j.Slf4j'],
]

function enrichTypoHint(fullMessage, sourceLine = '') {
  for (const [pattern, replacement] of packageTypos) {
    if (pattern.test(sourceLine) || pattern.test(fullMessage)) {
      return `${fullMessage} (Did you mean '${replacement}'?)`
    }
  }
  if (/symbol:\s+class\s+Autowire\b/.test(fullMessage)) {
    return `${fullMessage} (Did you mean '@Autowired' from org.springframework.beans.factory.annotation.Autowired?)`
  }
  if (/symbol:\s+class\s+slf4j\b/.test(fullMessage)) {
    return `${fullMessage} (Did you mean '@Slf4j' from lombok.extern.slf4j.Slf4j?)`
  }
  return fullMessage
}

function collectDiagnostics(stderr, diagnostics, name, source = '') {
  const sourceLines = source.split(/\r?\n/)
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
    const isSameFile = origin === name || path.basename(origin) === name || path.basename(origin).replace(/^aether-javac-[^/\\]+[-_]/, '') === name
    const rawMessage = (isSameFile ? '' : path.basename(origin) + ':' + line + ': ') + [message, ...details].join(' · ')
    if (isLombokGeneratedFalsePositive(rawMessage, source)) continue
    const lineNum = isSameFile ? Number(line) : null
    const fullMessage = enrichTypoHint(rawMessage, lineNum ? sourceLines[lineNum - 1] : '')
    diagnostics.push({
      line: lineNum,
      column: caret ? caret[1].length + 1 : 1,
      severity,
      message: fullMessage
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
  const { bin: java } = resolveJavaTool('java', 17)
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

      const { bin: executable, home: detectedHome } = resolveJavaTool('javac', 17)
      const env = { ...process.env }
      if (detectedHome) env.JAVA_HOME = detectedHome
      for (const key of Object.keys(env)) {
        if (/^(?:JDK_JAVAC_OPTIONS|JDK_JAVA_OPTIONS|JAVA_TOOL_OPTIONS|_JAVA_OPTIONS)$/i.test(key)) delete env[key]
      }

      const activeWorkspace = root() || workspace
      if (activeWorkspace && typeof file === 'string') {
        const normalized = file.replace(/\\/g, '/')
        const module = /^(?:(.*)\/)?src\/(?:main|test)\/java\//.exec(normalized)
        const segments = (module?.[1] || '').split('/').filter(Boolean)
        const realWorkspace = await fs.realpath(activeWorkspace).catch(() => null)
        if (realWorkspace && !segments.some((part) => part === '..' || part === '.' || part.includes(':'))) {
          const base = module ? path.resolve(realWorkspace, ...segments) : realWorkspace
          for (const relative of ['src/main/java', ...(normalized.includes('src/test/java/') ? ['src/test/java'] : []), 'target/generated-sources/annotations']) {
            const candidate = await fs.realpath(path.join(base, relative)).catch(() => null)
            if (candidate && candidate.startsWith(realWorkspace) && !sourceRoots.includes(candidate)) sourceRoots.push(candidate)
          }
          for (const relative of ['target/classes', 'target/test-classes', 'build/classes/java/main', 'build/classes/java/test']) {
            const candidate = await fs.realpath(path.join(base, relative)).catch(() => null)
            if (candidate && candidate.startsWith(realWorkspace) && !classRoots.includes(candidate)) classRoots.push(candidate)
          }
          // Include Maven dependency jars from pom.xml
          const pomDir = fsSync.existsSync(path.join(base, 'pom.xml')) ? base : realWorkspace
          if (fsSync.existsSync(path.join(pomDir, 'pom.xml'))) {
            const mavenJars = await resolveMavenClasspath(pomDir, env).catch(() => [])
            for (const jarPath of mavenJars) {
              if (!classRoots.includes(jarPath)) classRoots.push(jarPath)
            }
          }
        }
      }

      // Write javac arguments to an @argfile so long Maven classpaths never exceed OS command-line limits (especially on Windows)
      const argFile = path.join(temp, 'javac.args')
      const escapeArg = (val) => `"${String(val).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
      const javacArgs = [
        '-encoding', 'UTF-8',
        '-proc:none',
        '-implicit:none',
        '-classpath', escapeArg(classRoots.join(path.delimiter)),
        '-sourcepath', escapeArg(sourceRoots.join(path.delimiter)),
        '-d', escapeArg(temp),
        '-Xlint:rawtypes,unchecked',
        '-Xmaxwarns', '30',
        '-Xmaxerrs', '30',
        escapeArg(path.join(temp, name))
      ]
      await fs.writeFile(argFile, javacArgs.join('\n'), 'utf8')

      const diagnostics = []
      try {
        const { stderr } = await run(executable, [
          '-J-Duser.language=en', '-J-Duser.country=US', `@${argFile}`
        ], { cwd: temp, env, timeout: 15000, maxBuffer: 256 * 1024, windowsHide: true })
        if (stderr) collectDiagnostics(stderr, diagnostics, name, source)
      } catch (error) {
        if (error.code === 'ENOENT') return res.status(503).json({ error: 'Install a JDK and set JAVA_HOME or put javac on PATH.' })
        if (error.killed) return res.status(503).json({ error: 'Java validation timed out.' })
        const lines = (error.stderr || '').split(/\r?\n/)
        collectDiagnostics(error.stderr || '', diagnostics, name, source)
        if (!diagnostics.length && !(error.stderr || '').includes('error:')) {
          const message = lines.find((line) => /^(?:error|warning):/.test(line))
          if (message) diagnostics.push({ line: null, severity: 'error', message })
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
