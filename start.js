const { spawn } = require('child_process')
const path = require('path')
const fs = require('fs')
const net = require('net')
const http = require('http')

const ROOT = __dirname
const BACKEND_DIR = path.join(ROOT, 'backend')
const FRONTEND_DIR = path.join(ROOT, 'frontend')

const isWin = process.platform === 'win32'
const npmCmd = isWin ? 'npm.cmd' : 'npm'

function runCommandSync(cmd, args, cwd) {
  return new Promise((resolve, reject) => {
    console.log(`[setup] Running ${cmd} ${args.join(' ')} in ${path.relative(ROOT, cwd) || '.'}...`)
    const child = spawn(cmd, args, { cwd, stdio: 'inherit', shell: isWin })
    child.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`Command ${cmd} exited with code ${code}`))
    })
  })
}

async function ensureInstalled() {
  const backendModules = path.join(BACKEND_DIR, 'node_modules')
  const frontendModules = path.join(FRONTEND_DIR, 'node_modules')

  if (!fs.existsSync(backendModules)) {
    console.log('[setup] Installing backend dependencies...')
    await runCommandSync(npmCmd, ['install'], BACKEND_DIR)
  }

  if (!fs.existsSync(frontendModules)) {
    console.log('[setup] Installing frontend dependencies...')
    await runCommandSync(npmCmd, ['install'], FRONTEND_DIR)
  }
}

function checkPort(port) {
  return new Promise((resolve, reject) => {
    const probe = net.createServer()
    probe.once('error', (error) => reject(new Error(`Port ${port} is unavailable (${error.code}). Set AETHER_FRONTEND_PORT and AETHER_BACKEND_PORT to free ports.`)))
    probe.listen(port, '0.0.0.0', () => probe.close(resolve))
  })
}

function waitForHttp(url, timeoutMs = 25000) {
  const start = Date.now()
  return new Promise((resolve, reject) => {
    function tryConnect() {
      const req = http.get(url, (res) => {
        resolve()
      })
      req.on('error', () => {
        if (Date.now() - start > timeoutMs) {
          reject(new Error(`Timed out waiting for ${url}`))
        } else {
          setTimeout(tryConnect, 300)
        }
      })
      req.setTimeout(1200, () => {
        req.destroy()
        if (Date.now() - start > timeoutMs) {
          reject(new Error(`Timed out waiting for ${url}`))
        } else {
          setTimeout(tryConnect, 300)
        }
      })
    }
    tryConnect()
  })
}

async function main() {
  const frontendPort = Number(process.env.AETHER_FRONTEND_PORT || 4576)
  const backendPort = Number(process.env.AETHER_BACKEND_PORT || 3090)
  const noElectron = process.argv.includes('--no-electron') || process.argv.includes('--web') || process.env.AETHER_MODE === 'web'

  if (![frontendPort, backendPort].every((port) => Number.isInteger(port) && port > 0 && port <= 65535) || frontendPort === backendPort) {
    throw new Error('Set two different valid ports for AETHER_FRONTEND_PORT and AETHER_BACKEND_PORT.')
  }
  await Promise.all([checkPort(frontendPort), checkPort(backendPort)])
  await ensureInstalled()

  console.log('\n==================================================')
  console.log('  🚀 Starting Aether Studio' + (noElectron ? ' (Web Mode)...' : ' (Electron Desktop)...'))
  console.log(`  • App (Frontend) : http://localhost:${frontendPort}`)
  console.log(`  • API (Backend)  : http://localhost:${backendPort}`)
  if (!noElectron) {
    console.log('  • Desktop Shell  : Launching Electron window...')
  }
  console.log('==================================================\n')

  let electronProcess = null
  let isCleaningUp = false

  const backend = spawn('node', ['server.js'], {
    cwd: BACKEND_DIR,
    stdio: 'inherit',
    env: { ...process.env, PORT: String(backendPort) }
  })

  const frontend = spawn(npmCmd, ['run', 'dev'], {
    cwd: FRONTEND_DIR,
    env: { ...process.env, AETHER_BACKEND_PORT: String(backendPort), AETHER_FRONTEND_PORT: String(frontendPort) },
    stdio: 'inherit',
    shell: isWin
  })

  function cleanup() {
    if (isCleaningUp) return
    isCleaningUp = true
    console.log('\n[studio] Shutting down servers...')
    try {
      if (backend && !backend.killed) {
        if (isWin && backend.pid) {
          spawn('taskkill', ['/pid', String(backend.pid), '/T', '/F'])
        } else {
          backend.kill()
        }
      }
    } catch {}

    try {
      if (frontend && !frontend.killed) {
        if (isWin && frontend.pid) {
          spawn('taskkill', ['/pid', String(frontend.pid), '/T', '/F'])
        } else {
          frontend.kill()
        }
      }
    } catch {}

    try {
      if (electronProcess && !electronProcess.killed) {
        if (isWin && electronProcess.pid) {
          spawn('taskkill', ['/pid', String(electronProcess.pid), '/T', '/F'])
        } else {
          electronProcess.kill()
        }
      }
    } catch {}

    process.exit(0)
  }

  process.on('SIGINT', cleanup)
  process.on('SIGTERM', cleanup)

  backend.on('close', (code) => {
    if (code !== 0 && code !== null && !isCleaningUp) {
      console.error(`[backend] exited with code ${code}`)
    }
  })

  frontend.on('close', (code) => {
    if (code !== 0 && code !== null && !isCleaningUp) {
      console.error(`[frontend] exited with code ${code}`)
    }
  })

  if (!noElectron) {
    try {
      // Wait for frontend Vite dev server to be responsive
      await waitForHttp(`http://127.0.0.1:${frontendPort}`, 20000)
      console.log('[studio] Frontend server is ready. Launching Electron window...')

      const electronBin = (() => {
        try {
          return require('electron')
        } catch {
          return null
        }
      })()

      const mainScript = path.join(ROOT, 'electron', 'main.cjs')
      const electronEnv = {
        ...process.env,
        VITE_DEV_SERVER_URL: `http://localhost:${frontendPort}`,
        AETHER_FRONTEND_PORT: String(frontendPort),
        AETHER_BACKEND_PORT: String(backendPort)
      }

      if (electronBin) {
        electronProcess = spawn(electronBin, [mainScript], {
          cwd: ROOT,
          stdio: 'inherit',
          env: electronEnv
        })

        electronProcess.on('error', (err) => {
          console.warn(`\n[electron] Notice: Could not launch Electron desktop process: ${err.message}`)
          if (isWin && (err.code === 'UNKNOWN' || String(err.message).includes('blocked'))) {
            console.warn('[electron] Note: On Windows with Smart App Control (SAC) enabled, unsigned dev binaries in node_modules may be blocked by Windows policy.')
            console.warn(`[electron] Ather Studio web application is active and accessible at: http://localhost:${frontendPort}`)
          }
        })

        electronProcess.on('close', (code) => {
          console.log('\n[electron] Electron window closed.')
          cleanup()
        })
      } else {
        console.warn('[electron] Electron binary not found in node_modules. Continuing in web mode at: http://localhost:' + frontendPort)
      }
    } catch (err) {
      console.warn(`[electron] Could not start Electron shell: ${err.message}`)
      console.warn(`[electron] Ather Studio web application is accessible at: http://localhost:${frontendPort}`)
    }
  }
}

main().catch((err) => {
  console.error('[error]', err)
  process.exit(1)
})
