const { app, ipcMain, shell, utilityProcess, WebContentsView } = require('electron')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const fs = require('node:fs')
const registerPulseServices = require('./pulse-services.cjs')

const pulseRoot = path.join(__dirname, '..', 'pulse')
const rendererFile = path.join(pulseRoot, 'dist', 'index.html')
const rendererUrl = pathToFileURL(rendererFile).href
let workspace
let mockServer

function fromMainFrame(event, contents) {
  return event.sender === contents && event.senderFrame === contents.mainFrame
}

const fromPulse = (event) => Boolean(workspace &&
  fromMainFrame(event, workspace.view.webContents) &&
  event.senderFrame.url.split('#')[0] === rendererUrl)

registerPulseServices(fromPulse)

function resize() {
  const { window, view, top } = workspace
  const [width, height] = window.getContentSize()
  const y = Math.min(height, Math.max(0, Math.ceil(top * window.webContents.getZoomFactor())))
  view.setBounds({ x: 0, y, width, height: height - y })
}

function isPulseMode(mode) {
  return mode === 'studio' || mode === 'dashboard'
}

ipcMain.on('ather:pulse-top', (event, top) => {
  if (!workspace || !fromMainFrame(event, workspace.window.webContents) || !Number.isFinite(top)) return
  workspace.top = top
  resize()
})

ipcMain.on('ather:pulse-select', (event, mode) => {
  if (!workspace || !fromMainFrame(event, workspace.window.webContents)) return
  if (mode !== null && !isPulseMode(mode)) return
  const { window, view } = workspace
  workspace.mode = mode
  window.webContents.send('ather:pulse-mode', mode)
  if (mode === null) {
    view.setVisible(false)
    window.webContents.focus()
    return
  }
  resize()
  if (!workspace.overlay) view.setVisible(true)
  if (workspace.rendererReady) view.webContents.send('pulse:select-view', mode)
  if (!workspace.overlay) view.webContents.focus()
})

const THEME_KEYS = ['pulseTheme', 'ideTheme', 'accent', 'accentInk', 'font', 'mono', 'wallpaper']
function cleanTheme(theme) {
  if (!theme || typeof theme !== 'object') return null
  const out = {}
  for (const key of THEME_KEYS) if (typeof theme[key] === 'string' && theme[key].length < 400) out[key] = theme[key]
  return out
}

ipcMain.on('ather:pulse-theme', (event, theme) => {
  if (!workspace || !fromMainFrame(event, workspace.window.webContents)) return
  workspace.theme = cleanTheme(theme)
  if (workspace.rendererReady && workspace.theme) workspace.view.webContents.send('pulse:theme', workspace.theme)
})

// ── One common Settings page: Pulse settings are edited from the IDE's Settings ──
ipcMain.on('pulse:settings-state', (event, state) => {
  if (!fromPulse(event) || !state || typeof state !== 'object') return
  let size = 0
  try { size = JSON.stringify(state).length } catch { return }
  if (size > 50000) return
  workspace.settingsState = state
  workspace.window.webContents.send('ather:pulse-settings-state', state)
})

ipcMain.handle('ather:pulse-settings-get', (event) => {
  if (!workspace || !fromMainFrame(event, workspace.window.webContents)) return null
  return workspace.settingsState || null
})

ipcMain.on('ather:pulse-settings-update', (event, patch) => {
  if (!workspace || !fromMainFrame(event, workspace.window.webContents)) return
  if (!patch || typeof patch !== 'object') return
  if (!workspace.view.webContents.isDestroyed()) workspace.view.webContents.send('pulse:settings-update', patch)
})

ipcMain.on('pulse:open-settings', (event) => {
  if (!fromPulse(event)) return
  workspace.window.webContents.send('ather:pulse-open-settings')
})

// Hide the Pulse view while an IDE overlay (Settings) is open so it isn't covered.
ipcMain.on('ather:pulse-overlay', (event, open) => {
  if (!workspace || !fromMainFrame(event, workspace.window.webContents)) return
  workspace.overlay = Boolean(open)
  if (workspace.overlay) {
    workspace.view.setVisible(false)
    workspace.window.webContents.focus()
  } else if (workspace.mode) {
    resize()
    workspace.view.setVisible(true)
  }
})

ipcMain.on('pulse:ready', (event) => {
  if (!fromPulse(event)) return
  workspace.rendererReady = true
  if (workspace.mode) event.sender.send('pulse:select-view', workspace.mode)
  if (workspace.theme) event.sender.send('pulse:theme', workspace.theme)
})

ipcMain.on('pulse:view-mode', (event, mode) => {
  if (!fromPulse(event) || !workspace.mode || !isPulseMode(mode)) return
  workspace.mode = mode
  workspace.window.webContents.send('ather:pulse-mode', mode)
})

app.on('before-quit', () => mockServer?.kill())

exports.attach = (window) => {
  if (!mockServer) {
    mockServer = utilityProcess.fork(path.join(pulseRoot, 'server.js'), [], {
      env: { ...process.env, PORT: '3001' },
      serviceName: 'Pulse Local API',
    })
    mockServer.once('exit', () => { mockServer = undefined })
  }

  const view = new WebContentsView({
    webPreferences: {
      preload: path.join(pulseRoot, 'preload.cjs'),
      partition: 'persist:pulse-api-studio',
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  })
  workspace = { window, view, top: 44, mode: null, rendererReady: false }
  window.contentView.addChildView(view)
  view.setVisible(false)
  resize()
  window.on('resize', resize)
  window.once('closed', () => {
    if (!view.webContents.isDestroyed()) view.webContents.close()
    workspace = undefined
  })
  view.webContents.on('will-navigate', (event) => event.preventDefault())
  view.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  view.webContents.on('did-start-loading', () => { workspace.rendererReady = false })

  const showLoadError = (message) => {
    if (view.webContents.isDestroyed()) return
    return view.webContents.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(
      '<body style="background:#090d16;color:white;font:16px sans-serif;padding:24px">' + message + '</body>'
    )).catch(() => {})
  }

  if (!fs.existsSync(rendererFile)) {
    console.error('[Pulse] Renderer build is missing:', rendererFile)
    return showLoadError(app.isPackaged
      ? 'This package is missing the Pulse workspace. Reinstall the complete desktop app.'
      : 'Run npm start from the repository root to prepare the Pulse workspace.')
  }
  return view.webContents.loadURL(rendererUrl).catch((error) => {
    console.error('[Pulse] Failed to load workspace:', error.message)
    return showLoadError('Pulse could not start.')
  })
}
