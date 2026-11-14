import { contextBridge, ipcRenderer } from 'electron'
import { channels } from '../shared/ipc'
import type { IdeApi } from '../shared/types'

const ide: IdeApi = {
  app: {
    getInfo: () => ipcRenderer.invoke(channels.app.getInfo),
    windowAction: (action) => ipcRenderer.invoke(channels.app.windowAction, action)
  }
}

contextBridge.exposeInMainWorld('ide', ide)
