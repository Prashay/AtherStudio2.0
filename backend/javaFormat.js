const { execFile } = require('node:child_process')
const { promisify } = require('node:util')
const fs = require('node:fs/promises')
const fsSync = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { resolveJavaTool } = require('./maven')

function maskJavaNonCode(source) {
  return source.replace(/\/\*[\s\S]*?(?:\*\/|(?![\s\S]))|\/\/[^\r\n]*|"""[\s\S]*?(?:"""|(?![\s\S]))|"(?:\\.|[^"\\\r\n])*(?:"|(?=\r?$))|'(?:\\.|[^'\\\r\n])*(?:'|(?=\r?$))/gm,
    (token) => token.replace(/[^\r\n]/g, ' '))
}

const run = promisify(execFile)
const physicalBackend = __dirname.replace(/([\\/])app\.asar(?=[\\/])/, '$1app.asar.unpacked')
const jar = path.join(physicalBackend, 'tools', 'google-java-format-1.24.0-all-deps.jar')

function builtinJavaFormat(source) {
  const newline = source.includes('\r\n') ? '\r\n' : '\n'
  const normalized = source.replace(/\r\n?/g, '\n')
  const rawLines = normalized.split('\n')
  const maskedLines = maskJavaNonCode(normalized).split('\n')

  let indentLevel = 0
  const result = []
  let prevBlank = false

  for (let i = 0; i < rawLines.length; i++) {
    const raw = rawLines[i].trim()
    const masked = (maskedLines[i] || '').trim()

    if (!raw) {
      if (!prevBlank && result.length > 0) {
        result.push('')
        prevBlank = true
      }
      continue
    }
    prevBlank = false

    // Count leading closing braces on this line
    let leadingCloses = 0
    for (let c = 0; c < masked.length; c++) {
      if (masked[c] === '}' || masked[c] === ')') leadingCloses++
      else if (masked[c] !== ' ' && masked[c] !== '\t') break
    }

    const lineIndent = Math.max(0, indentLevel - leadingCloses)
    const isCaseOrDefault = /^(?:case\b|default\s*:)/.test(masked)
    const effectiveIndent = isCaseOrDefault ? Math.max(0, lineIndent - 1) : lineIndent

    // Normalize spacing around keywords and braces outside strings/comments
    let formattedLine = raw
      .replace(/^(if|for|while|switch|catch|synchronized)\(/, '$1 (')
      .replace(/\)\{$/, ') {')

    result.push('  '.repeat(effectiveIndent) + formattedLine)

    // Update indentLevel based on net braces/parens in masked line
    let delta = 0
    for (let c = 0; c < masked.length; c++) {
      if (masked[c] === '{' || masked[c] === '(') delta++
      else if (masked[c] === '}' || masked[c] === ')') delta--
    }
    indentLevel = Math.max(0, indentLevel + delta)
  }

  while (result.length && result[result.length - 1] === '') result.pop()
  return result.join(newline) + newline
}

function mountJavaFormat(app) {
  let active = 0
  app.post('/api/java/format', async (req, res) => {
    const { source } = req.body ?? {}
    if (typeof source !== 'string' || Buffer.byteLength(source) > 256 * 1024) {
      return res.status(400).json({ error: 'Select a Java file under 256 KB.' })
    }
    if (active >= 2) return res.status(429).json({ error: 'Java formatter is busy. Try again shortly.' })
    active++
    let temp
    try {
      const hasJar = fsSync.existsSync(jar)
      if (hasJar) {
        const { bin: java, home } = resolveJavaTool('java', 17)
        const env = { ...process.env, ...(home ? { JAVA_HOME: home } : {}) }
        temp = await fs.mkdtemp(path.join(os.tmpdir(), 'ather-java-format-'))
        const file = path.join(temp, 'Editor.java')
        await fs.writeFile(file, source, 'utf8')
        try {
          const { stdout } = await run(java, ['-jar', jar, '--skip-removing-unused-imports', file], {
            env, timeout: 10000, maxBuffer: 1024 * 1024, windowsHide: true
          })
          const formatted = source.includes('\r\n') ? stdout.replace(/\r?\n/g, '\r\n') : stdout
          return res.json({ source: formatted })
        } catch (jarErr) {
          const detail = jarErr.stderr?.split(/\r?\n/).find((line) => line.includes('error:'))
          if (detail) {
            return res.status(422).json({ error: detail.replace(/^.*?(?=\d+:\d+: error:)/, '') })
          }
          // Fall through to built-in formatter if google-java-format couldn't run
        }
      }
      const formatted = builtinJavaFormat(source)
      res.json({ source: formatted })
    } catch (error) {
      res.status(422).json({ error: error.message || 'Could not format this Java file.' })
    } finally {
      active--
      if (temp) await fs.rm(temp, { recursive: true, force: true }).catch(() => {})
    }
  })
}

module.exports = { mountJavaFormat }
