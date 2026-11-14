import { app, BrowserWindow, ipcMain } from 'electron'
import { z } from 'zod'
import { channels } from '../shared/ipc'
import type { AppInfo } from '../shared/types'
import { createWindow, isRendererFrame } from './windows'

const noArguments = z.tuple([])

app.whenReady().then(() => {
  ipcMain.handle(channels.app.getInfo, (event, ...args: unknown[]): AppInfo => {
    if (!isRendererFrame(event)) throw new Error('Untrusted IPC sender')
    noArguments.parse(args)
    return { version: app.getVersion() }
  })
  ipcMain.handle(channels.app.windowAction, (event, ...args: unknown[]) => {
    if (!isRendererFrame(event)) throw new Error('Untrusted IPC sender')
    const [action] = z.tuple([z.enum(['minimize', 'maximize', 'close'])]).parse(args)
    const window = BrowserWindow.fromWebContents(event.sender)
    if (!window) return
    switch (action) {
      case 'minimize': window.minimize(); break
      case 'maximize': window.isMaximized() ? window.unmaximize() : window.maximize(); break
      case 'close': window.close(); break
    }
  })
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
}).catch((error: unknown) => {
  console.error(error)
  app.exit(1)
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
