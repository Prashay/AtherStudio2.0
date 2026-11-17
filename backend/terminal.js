const { spawn } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { randomUUID } = require('node:crypto')

const sessions = new Map()

function getShell() {
  if (process.platform === 'win32') {
    const powershell = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
    if (fs.existsSync(powershell)) return powershell
    return process.env.COMSPEC || 'cmd.exe'
  }
  return process.env.SHELL || '/bin/bash'
}

function createSession(workingDirectory) {
  const id = randomUUID()
  const shell = getShell()
  const isPwsh = /powershell/i.test(shell)
  const isCmd = /cmd\.exe/i.test(shell)

  const args = isPwsh ? ['-NoExit'] : isCmd ? ['/K'] : ['-i']
  const cwd = workingDirectory && fs.existsSync(workingDirectory) ? path.resolve(workingDirectory) : process.cwd()

  let proc
  try {
    proc = spawn(shell, args, {
      cwd,
      env: {
        ...process.env,
        TERM: 'xterm-256color',
        COLUMNS: '120',
        LINES: '30'
      },
      windowsHide: true
    })
  } catch (err) {
    throw new Error(`Failed to spawn terminal shell (${shell}): ${err.message}`)
  }

  const session = {
    id,
    cwd,
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

  proc.stdout?.on('data', (d) => broadcast(d.toString()))
  proc.stderr?.on('data', (d) => broadcast(d.toString()))

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

      const session = createSession(targetDir)
      res.json({
        ok: true,
        id: session.id,
        shell: session.shell,
        cwd: session.cwd
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

