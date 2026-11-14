const { app, BrowserWindow, shell, ipcMain, Menu } = require('electron')
const path = require('path')
const http = require('http')
const fs = require('fs')

const frontendPort = Number(process.env.AETHER_FRONTEND_PORT || 4576)
const backendPort = Number(process.env.AETHER_BACKEND_PORT || 3090)
const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged
const DEV_URL = process.env.VITE_DEV_SERVER_URL || `http://localhost:${frontendPort}`
const PROD_URL = `http://127.0.0.1:${backendPort}`

let mainWindow = null
let splashWindow = null
let backendLoaded = false

// Single instance lock
const gotTheLock = app.requestSingleInstanceLock()
if (!gotTheLock) {
  app.quit()
  process.exit(0)
}
app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  }
})

function getAppIcon() {
  const candidates = [
    path.join(__dirname, 'icon.ico'),
    path.join(__dirname, 'icon.png'),
    path.join(__dirname, '..', 'build', 'icon.ico'),
    path.join(__dirname, '..', 'build', 'icon.png'),
    path.join(__dirname, '..', 'frontend', 'public', 'icon.png'),
    path.join(__dirname, '..', 'frontend', 'public', 'favicon.svg')
  ]
  for (const p of candidates) {
    if (fs.existsSync(p)) return p
  }
  return undefined
}

function getBackendServerPath() {
  const candidates = [
    path.join(__dirname, '..', 'backend', 'server.js'),
    path.join(app.getAppPath(), 'backend', 'server.js'),
    process.resourcesPath ? path.join(process.resourcesPath, 'app.asar.unpacked', 'backend', 'server.js') : null,
    process.resourcesPath ? path.join(process.resourcesPath, 'backend', 'server.js') : null
  ].filter(Boolean)

  for (const p of candidates) {
    if (fs.existsSync(p)) return p
  }
  return path.join(__dirname, '..', 'backend', 'server.js')
}

// Helper: check if a local HTTP endpoint is responsive
function checkPortAlive(port, reqPath, callback) {
  const req = http.request(
    { host: '127.0.0.1', port, method: 'GET', path: reqPath || '/', timeout: 1200 },
    (res) => {
      callback(true)
    }
  )
  req.on('error', () => callback(false))
  req.on('timeout', () => {
    req.destroy()
    callback(false)
  })
  req.end()
}

function waitForPortAlive(port, reqPath, timeoutMs = 8000) {
  const start = Date.now()
  return new Promise((resolve) => {
    function ping() {
      checkPortAlive(port, reqPath, (alive) => {
        if (alive) return resolve(true)
        if (Date.now() - start > timeoutMs) return resolve(false)
        setTimeout(ping, 250)
      })
    }
    ping()
  })
}

// Ensure the local Node.js backend server runs in background
async function ensureBackend() {
  if (backendLoaded) return true

  // 1. Check if backend is already alive (e.g. started by start.js)
  const alreadyRunning = await waitForPortAlive(backendPort, '/api/models', 600)
  if (alreadyRunning) {
    console.log(`[Electron] Backend server already running on port ${backendPort}.`)
    backendLoaded = true
    return true
  }

  // 2. Start embedded backend
  try {
    const serverPath = getBackendServerPath()
    console.log(`[Electron] Initializing embedded backend on port ${backendPort} from: ${serverPath}`)
    process.env.PORT = String(backendPort)
    require(serverPath)
    backendLoaded = true

    const isUp = await waitForPortAlive(backendPort, '/api/models', 10000)
    if (isUp) {
      console.log(`[Electron] Embedded backend active on port ${backendPort}.`)
      return true
    } else {
      console.warn(`[Electron] Warning: Embedded backend started but port ${backendPort} did not respond in time.`)
      return false
    }
  } catch (err) {
    console.error('[Electron] Error starting embedded backend server:', err)
    return false
  }
}

function createSplashWindow() {
  const appIcon = getAppIcon()
  splashWindow = new BrowserWindow({
    width: 420,
    height: 310,
    frame: false,
    transparent: true,
    resizable: false,
    center: true,
    show: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    backgroundColor: '#00000000',
    icon: appIcon,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  const splashHtml = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
          background: transparent;
          font-family: -apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", "Segoe UI", Roboto, sans-serif;
          display: flex;
          align-items: center;
          justify-content: center;
          height: 100vh;
          overflow: hidden;
          user-select: none;
          -webkit-user-select: none;
          -webkit-app-region: drag;
        }
        .apple-card {
          width: 390px;
          height: 280px;
          background: linear-gradient(145deg, rgba(22, 26, 36, 0.96) 0%, rgba(12, 14, 20, 0.98) 100%);
          border: 1px solid rgba(255, 255, 255, 0.12);
          border-radius: 22px;
          box-shadow: 0 25px 60px rgba(0, 0, 0, 0.75), 0 0 0 1px rgba(255, 255, 255, 0.06) inset;
          backdrop-filter: blur(40px);
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          position: relative;
        }
        .apple-card::before {
          content: '';
          position: absolute;
          top: 0; left: 0; right: 0; height: 1px;
          background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.35), transparent);
        }
        .icon-box {
          width: 76px;
          height: 76px;
          border-radius: 18px;
          background: #10131a;
          box-shadow: 0 14px 30px rgba(0, 0, 0, 0.55), 0 0 0 1px rgba(255, 255, 255, 0.1);
          display: flex;
          align-items: center;
          justify-content: center;
          margin-bottom: 16px;
          overflow: hidden;
          animation: floatPulse 2.8s ease-in-out infinite alternate;
        }
        @keyframes floatPulse {
          0% { transform: translateY(0); box-shadow: 0 14px 30px rgba(0, 0, 0, 0.55); }
          100% { transform: translateY(-4px); box-shadow: 0 20px 40px rgba(0, 0, 0, 0.75); }
        }
        .title {
          font-size: 21px;
          font-weight: 600;
          letter-spacing: -0.4px;
          color: #f8fafc;
          margin-bottom: 4px;
        }
        .subtitle {
          font-size: 12px;
          font-weight: 400;
          color: #94a3b8;
          letter-spacing: 0.1px;
          margin-bottom: 22px;
        }
        .apple-progress-bar {
          width: 140px;
          height: 3.5px;
          background: rgba(255, 255, 255, 0.12);
          border-radius: 999px;
          overflow: hidden;
          position: relative;
          margin-bottom: 12px;
        }
        .apple-progress-fill {
          position: absolute;
          top: 0; left: 0; height: 100%; width: 45%;
          background: linear-gradient(90deg, #94a3b8, #ffffff, #94a3b8);
          border-radius: 999px;
          animation: appleIndet 1.4s cubic-bezier(0.4, 0, 0.2, 1) infinite;
        }
        @keyframes appleIndet {
          0% { left: -45%; width: 30%; }
          50% { left: 35%; width: 50%; }
          100% { left: 100%; width: 30%; }
        }
        .status {
          font-size: 11px;
          color: #64748b;
          font-weight: 500;
          letter-spacing: 0.2px;
        }
      </style>
    </head>
    <body>
      <div class="apple-card">
        <div class="icon-box">
          <svg viewBox="0 0 100 100" width="76" height="76">
            <defs>
              <linearGradient id="appleBase" x1="0%" y1="0%" x2="0%" y2="100%">
                <stop offset="0%" stop-color="#242834"/>
                <stop offset="40%" stop-color="#181b24"/>
                <stop offset="100%" stop-color="#0e1017"/>
              </linearGradient>
              <linearGradient id="appleRim" x1="0%" y1="0%" x2="0%" y2="100%">
                <stop offset="0%" stop-color="#ffffff" stop-opacity="0.30"/>
                <stop offset="100%" stop-color="#334155" stop-opacity="0.10"/>
              </linearGradient>
              <linearGradient id="facetL" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stop-color="#ffffff"/>
                <stop offset="50%" stop-color="#e2e8f0"/>
                <stop offset="100%" stop-color="#94a3b8"/>
              </linearGradient>
              <linearGradient id="facetR" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stop-color="#cbd5e1"/>
                <stop offset="50%" stop-color="#64748b"/>
                <stop offset="100%" stop-color="#334155"/>
              </linearGradient>
              <filter id="embShadow" x="-20%" y="-20%" width="140%" height="150%">
                <feDropShadow dx="0" dy="3.5" stdDeviation="3" flood-color="#000000" flood-opacity="0.6"/>
              </filter>
            </defs>
            <rect width="100" height="100" rx="22" fill="url(#appleBase)" stroke="url(#appleRim)" stroke-width="1.2"/>
            <g filter="url(#embShadow)">
              <path d="M 50 24 L 50 36 L 34 72 L 25 72 Z" fill="url(#facetL)"/>
              <path d="M 50 24 L 75 72 L 66 72 L 50 36 Z" fill="url(#facetR)"/>
              <line x1="50" y1="24" x2="50" y2="36" stroke="#ffffff" stroke-width="1.2" stroke-linecap="round"/>
              <path d="M 34 56 L 66 56 L 63 62 L 37 62 Z" fill="#e2e8f0"/>
              <circle cx="50" cy="24" r="1.5" fill="#ffffff"/>
              <polygon points="50,40 53,45 50,50 47,45" fill="#ffffff" opacity="0.9"/>
            </g>
          </svg>
        </div>
        <div class="title">Arther Studio</div>
        <div class="subtitle">Intelligent AI Coding Studio</div>
        <div class="apple-progress-bar">
          <div class="apple-progress-fill"></div>
        </div>
        <div class="status">Starting workspace...</div>
      </div>
    </body>
    </html>
  `
  splashWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(splashHtml))
}

async function loadAppUrl(window) {
  // 1. Check if Vite dev server is running (e.g. from `npm start` or `npm run dev`)
  const isViteUp = await waitForPortAlive(frontendPort, '/', 800)
  if (isViteUp) {
    console.log(`[Electron] Connecting to frontend dev server at ${DEV_URL}`)
    await window.loadURL(DEV_URL).catch((err) => console.error('[Electron] Failed to load DEV_URL:', err))
    if (isDev || process.env.AETHER_DEVTOOLS === 'true') {
      window.webContents.openDevTools({ mode: 'detach' })
    }
    return
  }

  // 2. Production mode: check backend port (which serves frontend/dist statically)
  const isBackendUp = await waitForPortAlive(backendPort, '/api/models', 8000)
  if (isBackendUp) {
    console.log(`[Electron] Loading application through local backend at ${PROD_URL}`)
    await window.loadURL(PROD_URL).catch((err) => console.error('[Electron] Failed to load PROD_URL:', err))
    return
  }

  // 3. Fallback retry loop
  console.log('[Electron] Waiting for application servers to respond...')
  let attempts = 0
  const interval = setInterval(async () => {
    attempts++
    const devReady = await waitForPortAlive(frontendPort, '/', 400)
    if (devReady) {
      clearInterval(interval)
      console.log(`[Electron] Dev server connected at ${DEV_URL}`)
      return window.loadURL(DEV_URL).catch(() => {})
    }

    const backendReady = await waitForPortAlive(backendPort, '/api/models', 400)
    if (backendReady) {
      clearInterval(interval)
      console.log(`[Electron] Backend server connected at ${PROD_URL}`)
      return window.loadURL(PROD_URL).catch(() => {})
    }

    if (attempts >= 15) {
      clearInterval(interval)
      const errorHtml = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <title>Ather Studio - Connecting...</title>
          <style>
            body { background: #0c1016; color: #e2e8f0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; margin: 0; padding: 20px; box-sizing: border-box; text-align: center; }
            h2 { color: #38bdf8; margin-bottom: 12px; }
            p { color: #94a3b8; max-width: 500px; line-height: 1.6; margin-bottom: 24px; }
            .btn { background: #0284c7; color: white; border: none; padding: 10px 24px; border-radius: 6px; font-size: 14px; font-weight: 600; cursor: pointer; transition: background 0.2s; }
            .btn:hover { background: #0369a1; }
          </style>
        </head>
        <body>
          <h2>Connecting to Ather Studio...</h2>
          <p>The workspace server on port ${backendPort} is taking longer than expected to respond.<br/>If starting in development, run <code>npm start</code> in your terminal.</p>
          <button class="btn" onclick="location.reload()">Retry Connection</button>
        </body>
        </html>
      `
      window.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(errorHtml)).catch(() => {})
    }
  }, 1000)
}

function setupApplicationMenu() {
  const isMac = process.platform === 'darwin'
  const template = [
    ...(isMac
      ? [{
          label: app.name,
          submenu: [
            { role: 'about' },
            { type: 'separator' },
            { role: 'services' },
            { type: 'separator' },
            { role: 'hide' },
            { role: 'hideOthers' },
            { role: 'unhide' },
            { type: 'separator' },
            { role: 'quit' }
          ]
        }]
      : []),
    {
      label: 'File',
      submenu: [
        isMac ? { role: 'close' } : { role: 'quit' }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' }
      ]
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        ...(isMac
          ? [
              { type: 'separator' },
              { role: 'front' },
              { type: 'separator' },
              { role: 'window' }
            ]
          : [{ role: 'close' }])
      ]
    }
  ]
  const menu = Menu.buildFromTemplate(template)
  Menu.setApplicationMenu(menu)
}

function createWindow() {
  const appIcon = getAppIcon()
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 960,
    minHeight: 620,
    title: 'Arther Studio',
    icon: appIcon,
    backgroundColor: '#0c1016',
    show: false, // Initially hidden while splash screen is active
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    trafficLightPosition: { x: 16, y: 16 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  // Open external links in user's default OS browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http:') || url.startsWith('https:')) {
      shell.openExternal(url)
    }
    return { action: 'deny' }
  })

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('http://localhost') && !url.startsWith('http://127.0.0.1')) {
      event.preventDefault()
      shell.openExternal(url)
    }
  })

  let windowRevealed = false
  function revealMainWindow() {
    if (windowRevealed) return
    windowRevealed = true

    if (splashWindow && !splashWindow.isDestroyed()) {
      splashWindow.close()
      splashWindow = null
    }

    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show()
      mainWindow.focus()
    }
  }

  // Smoothly transition from splash to main window
  mainWindow.once('ready-to-show', () => {
    setTimeout(revealMainWindow, 400)
  })

  // Fallback safety timeout
  setTimeout(revealMainWindow, 7000)

  loadAppUrl(mainWindow)

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

app.whenReady().then(async () => {
  setupApplicationMenu()
  createSplashWindow()
  await ensureBackend()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// Safe IPC handlers
ipcMain.handle('get-app-version', () => app.getVersion())
ipcMain.handle('get-platform', () => process.platform)
ipcMain.handle('window-minimize', () => mainWindow?.minimize())
ipcMain.handle('window-maximize', () => {
  if (!mainWindow) return
  mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize()
})
ipcMain.handle('window-close', () => mainWindow?.close())
ipcMain.handle('window-is-maximized', () => mainWindow?.isMaximized() || false)
ipcMain.handle('open-external', (_event, url) => {
  if (url && (url.startsWith('http:') || url.startsWith('https:'))) {
    shell.openExternal(url)
  }
})
