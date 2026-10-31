const { contextBridge } = require('electron')

contextBridge.exposeInMainWorld('studio', {
  platform: process.platform,
  version: process.versions.electron
})
