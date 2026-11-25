const { app, BrowserWindow, shell, ipcMain, Menu, nativeImage, dialog } = require('electron')
const path = require('path')
const http = require('http')
const net = require('net')
const fs = require('fs')
const os = require('os')
const pulse = require('./pulse-view.cjs')

// Prevent black screen & occlusion compositing bugs on macOS Apple Silicon (M1/M2/M3)
if (process.platform === 'darwin') {
  app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion')
  app.commandLine.appendSwitch('force-color-profile', 'srgb')
}

const frontendPort = Number(process.env.AETHER_FRONTEND_PORT || 4576)
const backendPort = Number(process.env.AETHER_BACKEND_PORT || 3090)
const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged
const DEV_URL = process.env.VITE_DEV_SERVER_URL || `http://127.0.0.1:${frontendPort}`
const PROD_URL = `http://127.0.0.1:${backendPort}`

let mainWindow = null
let splashWindow = null
let backendLoaded = false
let currentWorkspaceRoot = process.env.AETHER_ROOT || (isDev ? path.resolve(__dirname, '..') : process.cwd())

function resolveWorkspacePath(targetPath) {
  if (!targetPath) return currentWorkspaceRoot
  if (path.isAbsolute(targetPath)) return targetPath
  return path.resolve(currentWorkspaceRoot || process.cwd(), targetPath)
}

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
  const isMac = process.platform === 'darwin'
  const candidates = isMac
    ? [
        path.join(__dirname, 'icon.png'),
        path.join(__dirname, '..', 'build', 'icon.png'),
        path.join(__dirname, '..', 'frontend', 'public', 'icon.png'),
        path.join(__dirname, 'icon.ico'),
        path.join(__dirname, '..', 'build', 'icon.ico')
      ]
    : [
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

function setMacDockIcon() {
  if (process.platform === 'darwin' && app.dock) {
    const candidates = [
      path.join(__dirname, 'icon.png'),
      path.join(__dirname, '..', 'build', 'icon.png'),
      path.join(__dirname, '..', 'frontend', 'public', 'icon.png'),
      path.join(__dirname, 'icon.icns'),
      path.join(__dirname, '..', 'build', 'icon.icns')
    ]
    for (const p of candidates) {
      if (fs.existsSync(p)) {
        try {
          const image = nativeImage.createFromPath(p)
          if (!image.isEmpty()) {
            app.dock.setIcon(image)
            break
          }
        } catch (err) {
          console.error('[macOS] Failed to set dock icon:', err)
        }
      }
    }
  }
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

// Ultra-fast TCP port check (connects or fails in 1-2ms, eliminates 10-18s delay on Mac)
function checkPortOpen(port, timeoutMs = 250) {
  return new Promise((resolve) => {
    const socket = new net.Socket()
    let resolved = false
    socket.setTimeout(timeoutMs)
    socket.once('connect', () => {
      resolved = true
      socket.destroy()
      resolve(true)
    })
    socket.once('timeout', () => {
      if (!resolved) {
        resolved = true
        socket.destroy()
        resolve(false)
      }
    })
    socket.once('error', () => {
      if (!resolved) {
        resolved = true
        socket.destroy()
        resolve(false)
      }
    })
    socket.connect(port, '127.0.0.1')
  })
}

// Ensure the local Node.js backend server runs in background
async function ensureBackend() {
  if (backendLoaded) return true

  // 1. Check if backend is already alive (e.g. started by start.js)
  const alreadyRunning = await checkPortOpen(backendPort, 150)
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

    const isUp = await checkPortOpen(backendPort, 1200)
    if (isUp) {
      console.log(`[Electron] Embedded backend active on port ${backendPort}.`)
      return true
    }
    return false
  } catch (err) {
    console.error('[Electron] Error starting embedded backend server:', err)
    return false
  }
}

function createSplashWindow() {
  const appIcon = getAppIcon()
  const winIcon = appIcon ? nativeImage.createFromPath(appIcon) : undefined
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
    icon: winIcon || appIcon,
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
  if (!window || window.isDestroyed()) return

  // 1. Fast check for Vite dev server (quick 180ms TCP check for development)
  const isViteUp = isDev && await checkPortOpen(frontendPort, 180)
  if (isViteUp) {
    console.log(`[Electron] Connecting to frontend dev server at ${DEV_URL}`)
    try {
      await window.loadURL(DEV_URL)
      if (process.env.AETHER_DEVTOOLS === 'true') {
        window.webContents.openDevTools({ mode: 'detach' })
      }
      return
    } catch (err) {
      console.warn('[Electron] Failed to load the dev server:', err.message)
    }
  }

  // Serve the UI and its relative /api requests from the same local origin.
  if (await ensureBackend() && !window.isDestroyed()) {
    console.log(`[Electron] Loading via backend server at ${PROD_URL}`)
    try {
      await window.loadURL(PROD_URL)
      return
    } catch (err) {
      console.warn('[Electron] Failed to load the local workspace:', err.message)
    }
  }

  if (window.isDestroyed()) return
  const errorHtml = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <title>Arther Studio</title>
      <style>
        body { background: #0c1016; color: #f8fafc; font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; margin: 0; text-align: center; }
        h2 { color: #38bdf8; margin-bottom: 8px; }
        p { color: #94a3b8; max-width: 460px; line-height: 1.5; font-size: 13px; margin-bottom: 20px; }
        button { background: #0284c7; color: white; border: none; padding: 9px 22px; border-radius: 6px; font-size: 13px; font-weight: 600; cursor: pointer; }
        button:hover { background: #0369a1; }
      </style>
    </head>
    <body>
      <h2>Starting Arther Studio...</h2>
      <p>The application workspace is initializing. Click below to refresh.</p>
      <button onclick="location.href='${PROD_URL}'">Reload Workspace</button>
    </body>
    </html>
  `
  window.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(errorHtml)).catch(() => {})
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
        {
          label: 'New Project…',
          click: () => mainWindow?.webContents.send('menu-action', 'new-project')
        },
        {
          label: 'New File…',
          accelerator: 'CmdOrCtrl+N',
          click: () => mainWindow?.webContents.send('menu-action', 'new-file')
        },
        {
          label: 'New Java Class…',
          accelerator: 'CmdOrCtrl+Shift+J',
          click: () => mainWindow?.webContents.send('menu-action', 'new-java')
        },
        {
          label: 'New Directory…',
          accelerator: 'CmdOrCtrl+Shift+N',
          click: () => mainWindow?.webContents.send('menu-action', 'new-directory')
        },
        { type: 'separator' },
        {
          label: 'Open Project / Folder…',
          accelerator: 'CmdOrCtrl+O',
          click: () => mainWindow?.webContents.send('menu-action', 'open-folder')
        },
        {
          label: 'Save',
          accelerator: 'CmdOrCtrl+S',
          click: () => mainWindow?.webContents.send('menu-action', 'save')
        },
        { type: 'separator' },
        { label: 'Run Java File', click: () => mainWindow?.webContents.send('menu-action', 'run-java') },
        { label: 'Debug Java File', click: () => mainWindow?.webContents.send('menu-action', 'debug-java') },
        { type: 'separator' },
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
        { role: 'selectAll' },
        { type: 'separator' },
        {
          label: 'Find in File…',
          accelerator: 'CmdOrCtrl+F',
          click: () => mainWindow?.webContents.send('menu-action', 'find-file')
        },
        {
          label: 'Search Everywhere…',
          accelerator: 'CmdOrCtrl+Shift+F',
          click: () => mainWindow?.webContents.send('menu-action', 'search-everywhere')
        }
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
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'hidden',
    trafficLightPosition: { x: 16, y: 16 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  const pulseLoaded = pulse.attach(mainWindow)

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
    revealMainWindow()
  })

  mainWindow.webContents.once('dom-ready', () => {
    revealMainWindow()
  })

  // Fallback safety timeout (reduced from 7000ms to 1800ms)
  setTimeout(revealMainWindow, 1800)

  loadAppUrl(mainWindow)

  mainWindow.on('maximize', () => {
    mainWindow?.webContents?.send('window-maximized-change', true)
  })
  mainWindow.on('unmaximize', () => {
    mainWindow?.webContents?.send('window-maximized-change', false)
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

app.whenReady().then(async () => {
  setMacDockIcon()
  setupApplicationMenu()
  createSplashWindow()
  
  createWindow()
  setMacDockIcon()

  app.on('activate', () => {
    setMacDockIcon()
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
ipcMain.handle('window-fullscreen', () => {
  if (!mainWindow) return
  mainWindow.setFullScreen(!mainWindow.isFullScreen())
})
ipcMain.handle('window-is-maximized', () => mainWindow?.isMaximized() || false)
ipcMain.handle('open-external', (_event, url) => {
  if (url && (url.startsWith('http:') || url.startsWith('https:'))) {
    shell.openExternal(url)
  }
})

// Desktop Native File & Directory Operations
ipcMain.handle('fs-create-file', async (_event, { path: filePath, content = '', overwrite = false }) => {
  try {
    if (!filePath) return { ok: false, error: 'File path is required.' }
    const target = resolveWorkspacePath(filePath)
    const parentDir = path.dirname(target)
    if (!fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true })
    }
    if (!overwrite && fs.existsSync(target)) {
      return { ok: false, error: 'That file already exists.', code: 'EEXIST' }
    }
    fs.writeFileSync(target, content, 'utf8')
    const rel = currentWorkspaceRoot ? path.relative(currentWorkspaceRoot, target).replace(/\\/g, '/') : target
    return { ok: true, path: rel, absPath: target }
  } catch (err) {
    console.error('[Electron] fs-create-file error:', err)
    return { ok: false, error: err.message }
  }
})

ipcMain.handle('fs-create-directory', async (_event, { path: dirPath }) => {
  try {
    if (!dirPath) return { ok: false, error: 'Directory path is required.' }
    const target = resolveWorkspacePath(dirPath)
    if (fs.existsSync(target)) {
      return { ok: false, error: 'That directory already exists.', code: 'EEXIST' }
    }
    fs.mkdirSync(target, { recursive: true })
    const rel = currentWorkspaceRoot ? path.relative(currentWorkspaceRoot, target).replace(/\\/g, '/') : target
    return { ok: true, path: rel, absPath: target }
  } catch (err) {
    console.error('[Electron] fs-create-directory error:', err)
    return { ok: false, error: err.message }
  }
})

ipcMain.handle('fs-read-file', async (_event, { path: filePath }) => {
  try {
    const target = resolveWorkspacePath(filePath)
    const content = fs.readFileSync(target, 'utf8')
    return { ok: true, content, path: target }
  } catch (err) {
    return { ok: false, error: err.message }
  }
})

ipcMain.handle('fs-write-file', async (_event, { path: filePath, content }) => {
  try {
    const target = resolveWorkspacePath(filePath)
    const parentDir = path.dirname(target)
    if (!fs.existsSync(parentDir)) fs.mkdirSync(parentDir, { recursive: true })
    fs.writeFileSync(target, content, 'utf8')
    return { ok: true, path: target }
  } catch (err) {
    return { ok: false, error: err.message }
  }
})

ipcMain.handle('fs-delete-item', async (_event, { path: itemPath }) => {
  try {
    const target = resolveWorkspacePath(itemPath)
    if (!fs.existsSync(target)) return { ok: true }
    const stat = fs.statSync(target)
    if (stat.isDirectory()) {
      fs.rmSync(target, { recursive: true, force: true })
    } else {
      fs.unlinkSync(target)
    }
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err.message }
  }
})

ipcMain.handle('fs-get-workspace-root', () => currentWorkspaceRoot)

ipcMain.handle('fs-set-workspace-root', (_event, newRoot) => {
  if (newRoot && fs.existsSync(newRoot)) {
    currentWorkspaceRoot = newRoot
    process.env.AETHER_ROOT = newRoot
    return { ok: true, root: currentWorkspaceRoot }
  }
  return { ok: false, error: 'Directory does not exist' }
})

// Native Dialogs
ipcMain.handle('dialog-show-open-folder', async (_event, { defaultPath } = {}) => {
  const parent = mainWindow && !mainWindow.isDestroyed() ? mainWindow : null
  const res = await dialog.showOpenDialog(parent, {
    title: 'Open Project Folder',
    defaultPath: defaultPath || currentWorkspaceRoot || os.homedir(),
    properties: ['openDirectory', 'createDirectory']
  })
  if (!res.canceled && res.filePaths.length > 0) {
    currentWorkspaceRoot = res.filePaths[0]
    process.env.AETHER_ROOT = currentWorkspaceRoot
  }
  return res
})

ipcMain.handle('dialog-choose-folder', async (_event, { title, defaultPath } = {}) => {
  const parent = mainWindow && !mainWindow.isDestroyed() ? mainWindow : null
  return dialog.showOpenDialog(parent, {
    title: title || 'Choose Folder',
    buttonLabel: 'Select',
    defaultPath: defaultPath || os.homedir(),
    properties: ['openDirectory', 'createDirectory']
  })
})

ipcMain.handle('dialog-show-open-file', async (_event, options = {}) => {
  const parent = mainWindow && !mainWindow.isDestroyed() ? mainWindow : null
  return await dialog.showOpenDialog(parent, {
    defaultPath: options.defaultPath || currentWorkspaceRoot || os.homedir(),
    properties: ['openFile'],
    filters: options.filters
  })
})

ipcMain.handle('dialog-show-save-file', async (_event, options = {}) => {
  const parent = mainWindow && !mainWindow.isDestroyed() ? mainWindow : null
  return await dialog.showSaveDialog(parent, {
    defaultPath: options.defaultPath || currentWorkspaceRoot || os.homedir(),
    filters: options.filters
  })
})

// Apple-style sleek modal input prompt for Electron
function showPromptDialog({ message = 'Enter name:', title = 'New Item', defaultValue = '', theme = {} } = {}) {
  return new Promise((resolve) => {
    const parent = mainWindow && !mainWindow.isDestroyed() ? mainWindow : null
    const promptWin = new BrowserWindow({
      width: 380,
      height: 178,
      parent: parent,
      modal: Boolean(parent),
      show: false,
      frame: false,
      resizable: false,
      alwaysOnTop: true,
      center: true,
      backgroundColor: /^#[0-9a-f]{6}$/i.test(theme?.bg || '') ? theme.bg : '#211d1c',
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true
      }
    })

    let resolved = false
    function finish(value) {
      if (resolved) return
      resolved = true
      resolve(value)
      if (!promptWin.isDestroyed()) {
        promptWin.close()
      }
    }

    promptWin.on('closed', () => {
      finish(null)
    })

    promptWin.webContents.on('will-navigate', (event, url) => {
      event.preventDefault()
      try {
        const u = new URL(url)
        if (u.protocol === 'prompt-action:') {
          const res = u.searchParams.get('value')
          finish(res === '__CANCELLED__' ? null : decodeURIComponent(res || ''))
        }
      } catch {}
    })

    const esc = (value) => String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
    const safeTitle = esc(title || 'New Item')
    const safeMsg = esc(message || 'Enter name:')
    const safeDef = JSON.stringify(String(defaultValue || '')).replace(/</g, '\\u003c')
    const kind = String(title || '').toLowerCase()
    const iconPaths = kind.includes('java') || kind.includes('kotlin')
      ? 'M6 10h11v4a5 5 0 0 1-5 5h-1a5 5 0 0 1-5-5z|M17 11h1.5a2.5 2.5 0 0 1 0 5H17|M9 3c0 1.5 1.5 1.5 1.5 3S9 7.5 9 9|M13 3c0 1.5 1.5 1.5 1.5 3S13 7.5 13 9'
      : kind.includes('folder') || kind.includes('directory') || kind.includes('package')
        ? 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z|M12 10v6|M9 13h6'
        : kind.includes('rename')
          ? 'M4 20h4L19 9l-4-4L4 16z|M14 6l4 4'
          : 'M7 3h7l5 5v11a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z|M14 3v5h5|M12 11v6|M9 14h6'
    const cssVal = (value, fallback) => (typeof value === 'string' && value && value.length < 300 && !/[<>{};\\]/.test(value) ? value : fallback)
    const t = theme && typeof theme === 'object' ? theme : {}
    const themeVars = [
      `--accent: ${cssVal(t.accent, '#ff7624')}`,
      `--ink: ${cssVal(t.ink, '#ffffff')}`,
      `--font: ${cssVal(t.font, 'Roboto, Arial, sans-serif')}, Roboto, Arial, sans-serif`,
      `--text: ${cssVal(t.text, t.light ? '#1d1d1f' : '#f6f0e9')}`,
      `--muted: ${cssVal(t.muted, t.light ? '#646469' : '#bfb5ad')}`,
      `--card: ${cssVal(t.card, '#3a2f2a')}`,
      `--bg: ${cssVal(t.bg, '#221d1c')}`,
      `--tone: ${t.light ? '#000000' : '#ffffff'}`
    ].join('; ')
    const iconSvg = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' +
      iconPaths.split('|').map((d) => '<path d="' + d + '"/>').join('') + '</svg>'

    const promptHtml = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    :root { ${themeVars}; }
    html, body { height: 100%; overflow: hidden; }
    body {
      display: flex; flex-direction: column; gap: 14px; padding: 16px;
      color: var(--text); font: 400 13px/1.45 var(--font);
      background: radial-gradient(120% 70% at 0% 0%, color-mix(in srgb, var(--accent) 18%, transparent), transparent 60%), linear-gradient(160deg, var(--card), var(--bg) 60%);
      border: 1px solid color-mix(in srgb, var(--accent) 22%, color-mix(in srgb, var(--tone) 10%, transparent));
      user-select: none; -webkit-user-select: none; -webkit-app-region: drag;
      animation: in .18s ease-out both;
    }
    @keyframes in { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
    .head { display: flex; align-items: center; gap: 12px; }
    .badge {
      flex: none; display: grid; place-items: center; width: 38px; height: 38px; border-radius: 11px; color: var(--ink);
      background: linear-gradient(140deg, color-mix(in srgb, var(--accent) 65%, white), var(--accent) 55%, color-mix(in srgb, var(--accent) 75%, black));
      box-shadow: 0 8px 18px color-mix(in srgb, var(--accent) 30%, transparent), inset 0 1px #ffffff59;
    }
    .titles { display: grid; min-width: 0; }
    .title { font-size: 15px; font-weight: 600; letter-spacing: -.01em; }
    .message { color: var(--muted); font-size: 12px; }
    .field {
      display: flex; align-items: center; gap: 8px; height: 36px; padding: 0 10px;
      color: var(--muted); background: color-mix(in srgb, var(--bg) 80%, black); border: 1px solid color-mix(in srgb, var(--tone) 12%, transparent); border-radius: 10px;
      transition: border-color .15s, box-shadow .15s; -webkit-app-region: no-drag;
    }
    .field:focus-within { border-color: var(--accent); box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 22%, transparent); color: var(--accent); }
    input { flex: 1; min-width: 0; height: 100%; color: var(--text); background: transparent; border: 0; outline: 0; font: inherit; user-select: text; }
    .actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: auto; -webkit-app-region: no-drag; }
    button {
      display: inline-flex; align-items: center; gap: 6px; height: 32px; padding: 0 14px;
      font: 500 13px var(--font); border-radius: 10px; cursor: pointer; transition: filter .15s, background .15s, transform .1s;
    }
    button:active { transform: translateY(1px); }
    .cancel { color: var(--text); background: color-mix(in srgb, var(--tone) 6%, transparent); border: 1px solid color-mix(in srgb, var(--tone) 14%, transparent); }
    .cancel:hover { background: color-mix(in srgb, var(--tone) 11%, transparent); }
    .confirm { color: var(--ink); background: linear-gradient(180deg, color-mix(in srgb, var(--accent) 88%, white), color-mix(in srgb, var(--accent) 90%, black)); border: 1px solid color-mix(in srgb, var(--accent) 70%, white); box-shadow: 0 6px 16px color-mix(in srgb, var(--accent) 28%, transparent), inset 0 1px #ffffff40; }
    .confirm:hover { filter: brightness(1.08); }
  </style>
</head>
<body>
  <div class="head">
    <span class="badge">${iconSvg}</span>
    <div class="titles"><div class="title">${safeTitle}</div><div class="message">${safeMsg}</div></div>
  </div>
  <label class="field">
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M14 6l4 4"/></svg>
    <input id="prompt-input" type="text" autofocus autocomplete="off" spellcheck="false" />
  </label>
  <div class="actions">
    <button class="cancel" id="btn-cancel" type="button">Cancel</button>
    <button class="confirm" id="btn-ok" type="button">${kind.startsWith('new') ? 'Create' : 'OK'}
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="M13 6l6 6-6 6"/></svg>
    </button>
  </div>
  <script>
    const input = document.getElementById('prompt-input');
    input.value = ${safeDef};
    setTimeout(() => { input.focus(); input.select(); }, 50);
    function submitVal(val) {
      window.location.href = 'prompt-action://dialog?value=' + encodeURIComponent(val === null ? '__CANCELLED__' : val);
    }
    document.getElementById('btn-ok').onclick = () => submitVal(input.value);
    document.getElementById('btn-cancel').onclick = () => submitVal(null);
    input.onkeydown = (e) => {
      if (e.key === 'Enter') submitVal(input.value);
      if (e.key === 'Escape') submitVal(null);
    };
  </script>
</body>
</html>`

    promptWin.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(promptHtml))
    promptWin.once('ready-to-show', () => promptWin.show())
  })
}

ipcMain.handle('show-prompt', async (_event, options) => {
  return await showPromptDialog(options)
})
