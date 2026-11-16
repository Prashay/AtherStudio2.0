const { execFile } = require('node:child_process')
const { promisify } = require('node:util')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')

const run = promisify(execFile)
const physicalBackend = __dirname.replace(/([\\/])app\.asar(?=[\\/])/, '$1app.asar.unpacked')
const jar = path.join(physicalBackend, 'tools', 'google-java-format-1.24.0-all-deps.jar')

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
      const java = process.env.JAVA_HOME
        ? path.join(process.env.JAVA_HOME, 'bin', process.platform === 'win32' ? 'java.exe' : 'java')
        : 'java'
      await fs.access(jar)
      temp = await fs.mkdtemp(path.join(os.tmpdir(), 'ather-java-format-'))
      const file = path.join(temp, 'Editor.java')
      await fs.writeFile(file, source, 'utf8')
      const { stdout } = await run(java, ['-jar', jar, '--skip-removing-unused-imports', file], {
        timeout: 10000, maxBuffer: 1024 * 1024, windowsHide: true
      })
      const formatted = source.includes('\r\n') ? stdout.replace(/\r?\n/g, '\r\n') : stdout
      res.json({ source: formatted })
    } catch (error) {
      if (error.code === 'ENOENT') return res.status(503).json({ error: 'Java formatting needs JDK 17 or newer and the bundled formatter. Run npm run prepare:formatter for a source checkout.' })
      if (error.killed) return res.status(503).json({ error: 'Java formatting timed out.' })
      const detail = error.stderr?.split(/\r?\n/).find((line) => line.includes('error:'))
      res.status(422).json({ error: detail?.replace(/^.*?(?=\d+:\d+: error:)/, '') || 'Google Java Format could not format this file. Check its syntax and JDK version.' })
    } finally {
      active--
      if (temp) await fs.rm(temp, { recursive: true, force: true }).catch(() => {})
    }
  })
}

module.exports = { mountJavaFormat }
