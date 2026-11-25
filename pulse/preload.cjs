const { contextBridge, ipcRenderer, webFrame } = require("electron");

function workspaceRequest(channel, ...args) {
  const result = ipcRenderer.sendSync(channel, ...args);
  if (!result?.ok) throw new Error(result?.error || "Could not access the saved workspace.");
  return result.data;
}

contextBridge.exposeInMainWorld("pulseDesktop", {
  isDesktop: true,
  reportViewMode: (mode) => ipcRenderer.send("pulse:view-mode", mode),
  onViewMode: (callback) => {
    const listener = (_event, mode) => callback(mode);
    ipcRenderer.on("pulse:select-view", listener);
    ipcRenderer.send("pulse:ready");
    return () => ipcRenderer.removeListener("pulse:select-view", listener);
  },
  sendSettings: (state) => ipcRenderer.send("pulse:settings-state", state),
  onSettingsUpdate: (callback) => {
    const listener = (_event, patch) => callback(patch);
    ipcRenderer.on("pulse:settings-update", listener);
    return () => ipcRenderer.removeListener("pulse:settings-update", listener);
  },
  openSettings: () => ipcRenderer.send("pulse:open-settings"),
  onTheme: (callback) => {
    const listener = (_event, theme) => callback(theme);
    ipcRenderer.on("pulse:theme", listener);
    return () => ipcRenderer.removeListener("pulse:theme", listener);
  },
  platform: process.platform,
  readWorkspace: () => workspaceRequest("pulse:read-workspace"),
  writeWorkspace: (data) => workspaceRequest("pulse:write-workspace", data),
  windowZoom: {
    getFactor: () => webFrame.getZoomFactor(),
    setFactor: (factor) => {
      if (Number.isFinite(factor)) webFrame.setZoomFactor(Math.max(0.5, Math.min(2, factor)));
    },
  },
  proxyRequest: (payload) => ipcRenderer.invoke("pulse:proxy-request", payload),
  cancelProxyRequest: (id) => ipcRenderer.send("pulse:cancel-proxy-request", id),
  checkHealth: () => ipcRenderer.invoke("pulse:health-check"),
});
