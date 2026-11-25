const { spawn } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { randomUUID } = require('node:crypto')
const { StringDecoder } = require('node:string_decoder')

const sessions = new Map()

function getShell() {
  if (process.platform === 'win32') {
    const powershell = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
    if (fs.existsSync(powershell)) return powershell
    return process.env.COMSPEC || 'cmd.exe'
  }
  return process.env.SHELL || '/bin/bash'
}

const PTY_HELPER = path.join(__dirname, 'pty_helper.py')
let pythonCmd

function findPython() {
  if (pythonCmd !== undefined) return pythonCmd
  pythonCmd = null
  if (process.platform === 'win32' || !fs.existsSync(PTY_HELPER)) return pythonCmd
  for (const dir of (process.env.PATH || '/usr/bin:/bin:/usr/local/bin').split(path.delimiter).concat(['/usr/bin', '/usr/local/bin', '/opt/homebrew/bin'])) {
    const candidate = path.join(dir, 'python3')
    try {
      fs.accessSync(candidate, fs.constants.X_OK)
      pythonCmd = candidate
      break
    } catch {}
  }
  return pythonCmd
}

function createSession(workingDirectory, { cols = 120, rows = 30 } = {}) {
  const id = randomUUID()
  const shell = getShell()
  const isPwsh = /powershell/i.test(shell)
  const isCmd = /cmd\.exe/i.test(shell)
  const cwd = workingDirectory && fs.existsSync(workingDirectory) ? path.resolve(workingDirectory) : process.cwd()
  const env = {
    ...process.env,
    TERM: 'xterm-256color',
    COLORTERM: 'truecolor',
    TERM_PROGRAM: 'AetherStudio',
    COLUMNS: String(cols),
    LINES: String(rows)
  }

  // Prefer a real PTY (Linux/macOS) so prompts, colours, Tab completion and full-screen tools work.
  const python = findPython()
  let proc
  let pty = false
  try {
    if (python) {
      proc = spawn(python, [PTY_HELPER, shell, '-l'], { cwd, env, stdio: ['pipe', 'pipe', 'pipe', 'pipe'] })
      pty = true
    } else {
      const args = isPwsh ? ['-NoLogo', '-NoExit'] : isCmd ? ['/K'] : ['-i']
      proc = spawn(shell, args, { cwd, env, windowsHide: true })
    }
  } catch (err) {
    throw new Error(`Failed to spawn terminal shell (${shell}): ${err.message}`)
  }

  const session = {
    id,
    cwd,
    pty,
    shell: path.basename(shell),
    proc,
    buffer: '',
    listeners: new Set(),
    createdAt: Date.now()
  }

  const broadcast = (data) => {
    session.buffer += data
    if (session.buffer.length > 512000) {
      session.buffer = session.buffer.slice(-256000)
    }
    for (const listener of session.listeners) {
      try {
        listener(data)
      } catch {}
    }
  }

  const outDecoder = new StringDecoder('utf8')
  const errDecoder = new StringDecoder('utf8')
  proc.stdout?.on('data', (d) => broadcast(outDecoder.write(d)))
  proc.stderr?.on('data', (d) => broadcast(errDecoder.write(d)))
  proc.stdio[3]?.on?.('error', () => {})
  proc.stdin?.on('error', () => {})

  proc.on('close', (code) => {
    broadcast(`\r\n[Process completed with exit code ${code}]\r\n`)
    sessions.delete(id)
  })

  proc.on('error', (err) => {
    broadcast(`\r\n[Terminal error: ${err.message}]\r\n`)
  })

  sessions.set(id, session)
  return session
}

function mountTerminal(app, { root }) {
  // Create terminal session
  app.post('/api/terminal/session', (req, res) => {
    try {
      const requestedCwd = req.body?.cwd
      let targetDir = requestedCwd && fs.existsSync(requestedCwd) ? path.resolve(requestedCwd) : null
      if (!targetDir) {
        const r = typeof root === 'function' ? root() : root
        if (r && fs.existsSync(r)) targetDir = path.resolve(r)
      }
      if (!targetDir) targetDir = process.cwd()

      const cols = Math.max(20, Math.min(500, parseInt(req.body?.cols, 10) || 120))
      const rows = Math.max(5, Math.min(200, parseInt(req.body?.rows, 10) || 30))
      const session = createSession(targetDir, { cols, rows })
      res.json({
        ok: true,
        id: session.id,
        shell: session.shell,
        cwd: session.cwd,
        pty: session.pty
      })
    } catch (err) {
      res.status(500).json({ error: err.message })
    }
  })

  // Send input to terminal
  app.post('/api/terminal/input', (req, res) => {
    const { id, input } = req.body || {}
    if (!id || typeof input !== 'string') {
      return res.status(400).json({ error: 'Session ID and input required' })
    }
    const session = sessions.get(id)
    if (!session || !session.proc) {
      return res.status(404).json({ error: 'Terminal session not found or already closed' })
    }
    try {
      session.proc.stdin.write(input)
      res.json({ ok: true })
    } catch (err) {
      res.status(500).json({ error: err.message })
    }
  })

  // Resize the PTY (no-op for pipe sessions)
  app.post('/api/terminal/resize', (req, res) => {
    const { id } = req.body || {}
    const session = sessions.get(id)
    if (!session) return res.status(404).json({ error: 'Terminal session not found' })
    const cols = Math.max(20, Math.min(500, parseInt(req.body.cols, 10) || 0))
    const rows = Math.max(5, Math.min(200, parseInt(req.body.rows, 10) || 0))
    if (session.pty && session.proc.stdio[3] && cols && rows) {
      try { session.proc.stdio[3].write(JSON.stringify({ cols, rows }) + '\n') } catch {}
    }
    res.json({ ok: true })
  })

  // Poll terminal buffer
  app.get('/api/terminal/output', (req, res) => {
    const id = req.query.id
    if (!id) return res.status(400).json({ error: 'Session ID required' })
    const session = sessions.get(id)
    if (!session) return res.status(404).json({ error: 'Terminal session not found' })

    const offset = parseInt(req.query.offset || '0', 10)
    const text = session.buffer.slice(offset)
    res.json({
      text,
      nextOffset: session.buffer.length,
      shell: session.shell,
      cwd: session.cwd
    })
  })

  // Stream terminal output via Server-Sent Events (SSE)
  app.get('/api/terminal/stream', (req, res) => {
    const id = req.query.id
    if (!id) return res.status(400).end('Session ID required')
    const session = sessions.get(id)
    if (!session) return res.status(404).end('Session not found')

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive'
    })
    res.flushHeaders?.()

    // Send existing buffer immediately
    if (session.buffer) {
      res.write(`data: ${JSON.stringify({ text: session.buffer })}\n\n`)
    }

    const onData = (data) => {
      res.write(`data: ${JSON.stringify({ text: data })}\n\n`)
    }

    session.listeners.add(onData)

    req.on('close', () => {
      session.listeners.delete(onData)
    })
  })

  // Kill session
  app.delete('/api/terminal/session', (req, res) => {
    const id = req.query.id || req.body?.id
    if (!id) return res.status(400).json({ error: 'Session ID required' })
    const session = sessions.get(id)
    if (session) {
      try {
        if (process.platform === 'win32' && session.proc.pid) {
          spawn('taskkill', ['/pid', String(session.proc.pid), '/T', '/F'])
        } else {
          session.proc.kill()
        }
      } catch {}
      sessions.delete(id)
    }
    res.json({ ok: true })
  })
}

module.exports = { mountTerminal }

