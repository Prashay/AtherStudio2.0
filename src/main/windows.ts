import { BrowserWindow, session, type IpcMainInvokeEvent } from 'electron'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const indexPath = join(__dirname, '../renderer/index.html')
const devUrl = process.env.ELECTRON_RENDERER_URL
const rendererUrl = devUrl || pathToFileURL(indexPath).href
const rendererOrigin = new URL(rendererUrl).origin
const trustedWindows = new Set<number>()

export function isRendererFrame(event: IpcMainInvokeEvent): boolean {
  const frame = event.senderFrame
  if (!frame || frame.parent || !trustedWindows.has(event.sender.id)) return false
  const url = new URL(frame.url)
  return devUrl ? url.origin === rendererOrigin : url.href === rendererUrl
}

export function createWindow(): void {
  const policy = [
    "default-src 'none'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    devUrl ? "connect-src 'self' ws://127.0.0.1:*" : "connect-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'"
  ].join('; ')
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({ responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [policy] } })
  })
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
  session.defaultSession.setPermissionCheckHandler(() => false)

  const window = new BrowserWindow({
    frame: false,
    minWidth: 760,
    minHeight: 480,
    width: 1440,
    height: 780,
    backgroundColor: '#1e1f22',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  const id = window.webContents.id
  trustedWindows.add(id)
  window.on('closed', () => trustedWindows.delete(id))
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event) => event.preventDefault())
  window.webContents.on('will-redirect', (event) => event.preventDefault())
  void (devUrl ? window.loadURL(devUrl) : window.loadFile(indexPath)).catch(console.error)
}
