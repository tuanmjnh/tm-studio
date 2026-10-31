'use strict'
// R134 probe preload: exposes a raw invoke() so the probe can drive a
// controller-style channel through the REAL renderer → main IPC path.
// The production preload's namespaced bridges are per-channel and would
// not reach a probe-registered channel; the choke point under test is
// origin-based, so a raw invoke is the honest equivalent.
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('probeAPI', {
  invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args)
})
