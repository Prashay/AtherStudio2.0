const { contextBridge, ipcRenderer, webFrame } = require('electron')

// Expose safe, rich desktop features to the renderer process
contextBridge.exposeInMainWorld('electronAPI', {
  isElectron: true,
  pulse: {
    select: (mode) => ipcRenderer.send('ather:pulse-select', mode),
    setTop: (top) => ipcRenderer.send('ather:pulse-top', top),
    onMode: (callback) => {
      const listener = (_event, mode) => callback(mode)
      ipcRenderer.on('ather:pulse-mode', listener)
      return () => ipcRenderer.removeListener('ather:pulse-mode', listener)
    },
  },
  platform: process.platform,

  // Window Controls & Platform
  getVersion: () => ipcRenderer.invoke('get-app-version'),
  getPlatform: () => ipcRenderer.invoke('get-platform'),
  minimize: () => ipcRenderer.invoke('window-minimize'),
  maximize: () => ipcRenderer.invoke('window-maximize'),
  close: () => ipcRenderer.invoke('window-close'),
  fullscreen: () => ipcRenderer.invoke('window-fullscreen'),
  isMaximized: () => ipcRenderer.invoke('window-is-maximized'),
  onMaximizedChange: (callback) => {
    const handler = (_event, isMax) => callback(isMax)
    ipcRenderer.on('window-maximized-change', handler)
    return () => ipcRenderer.removeListener('window-maximized-change', handler)
  },
  openExternal: (url) => ipcRenderer.invoke('open-external', url),

  // Native File & Directory Management
  createFile: (filePath, content = '', options = {}) =>
    ipcRenderer.invoke('fs-create-file', { path: filePath, content, ...options }),
  createDirectory: (dirPath) =>
    ipcRenderer.invoke('fs-create-directory', { path: dirPath }),
  readFile: (filePath) =>
    ipcRenderer.invoke('fs-read-file', { path: filePath }),
  writeFile: (filePath, content) =>
    ipcRenderer.invoke('fs-write-file', { path: filePath, content }),
  deleteItem: (itemPath) =>
    ipcRenderer.invoke('fs-delete-item', { path: itemPath }),
  getWorkspaceRoot: () =>
    ipcRenderer.invoke('fs-get-workspace-root'),
  setWorkspaceRoot: (newRoot) =>
    ipcRenderer.invoke('fs-set-workspace-root', newRoot),

  // Native Dialogs & Interactive Prompts
  openFolderDialog: (defaultPath) =>
    ipcRenderer.invoke('dialog-show-open-folder', { defaultPath }),
  openFileDialog: (options) =>
    ipcRenderer.invoke('dialog-show-open-file', options),
  saveFileDialog: (options) =>
    ipcRenderer.invoke('dialog-show-save-file', options),
  prompt: (options) =>
    ipcRenderer.invoke('show-prompt', typeof options === 'string' ? { message: options } : options),

  // Application Menu & Shortcut Events
  onMenuAction: (callback) => {
    const handler = (_event, action, data) => callback(action, data)
    ipcRenderer.on('menu-action', handler)
    return () => ipcRenderer.removeListener('menu-action', handler)
  }
})

// Mark Electron environment in main world
try {
  webFrame.executeJavaScript(`window.isElectronApp = true;`).catch(() => {})
} catch {}

// Automatically route relative /api/... calls to the embedded backend on 127.0.0.1:3090 when loaded from local file://
try {
  const backendPort = 3090
  const originalFetch = window.fetch
  window.fetch = function (input, init) {
    if (typeof input === 'string') {
      if (input.startsWith('/api/') || input.startsWith('api/')) {
        const cleanPath = input.startsWith('/') ? input : '/' + input
        if (!window.location.protocol.startsWith('http')) {
          input = `http://127.0.0.1:${backendPort}${cleanPath}`
        }
      }
    } else if (input instanceof Request) {
      if (input.url.startsWith('file://') && input.url.includes('/api/')) {
        const u = new URL(input.url)
        input = new Request(`http://127.0.0.1:${backendPort}${u.pathname}${u.search}`, input)
      }
    }
    return originalFetch.call(this, input, init)
  }
} catch {}
