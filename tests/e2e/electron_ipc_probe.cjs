// R133 probe (docs §197/§198): prove the REAL Electron runtime enforces the
// IPC trust policy that unit specs can only model:
//  1) the real preload's electronAPI.on fires ONLY for allow-listed
//     channels, unsub works, and unknown channels receive nothing;
//  2) electronAPI.send refuses every channel (OUTBOUND allow-list empty,
//     silently — a bridge refusal is not an exception);
//  3) the REAL createSenderGate passes the trusted loopback origin and
//     refuses a file:// frame (the same factory the file-manager and all
//     privileged main handlers now use);
//  4) R134: the gateIpcMainHandle choke point installed on ipcMain makes
//     EVERY subsequently-registered ipcMain.handle channel (controller
//     style, no per-site guard) resolve to undefined for a foreign frame
//     while the trusted origin gets real data.
//
//   node_modules\electron\dist\electron.exe tests/e2e/electron_ipc_probe.cjs
//
// Prints PROBE lines to stdout; exits 0 on all pass, 1 on any failure.
const { app, BrowserWindow, ipcMain } = require('electron')
const http = require('http')
const path = require('path')

const { createSenderGate, gateIpcMainHandle } = require('../../electron/ipcPolicy.cjs')

const PAGE = '<!doctype html><html><body>probe</body></html>'

function startServer() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      res.setHeader('content-type', 'text/html')
      res.end(PAGE)
    })
    srv.listen(0, '127.0.0.1', () => resolve({ srv, port: srv.address().port }))
  })
}

app.whenReady().then(async () => {
  let srv = null
  const results = []
  try {
    const started = await startServer()
    srv = started.srv
    const { port } = started

    // 1) The real gate factory against synthetic frames of both origins —
    // same code path main.cjs and the file-manager guard execute.
    const gate = createSenderGate({ isDev: false, port })
    results.push([gate({ senderFrame: { url: `http://127.0.0.1:${port}/` } }), 'gate trusts the loopback app origin'])
    results.push([!gate({ senderFrame: { url: 'file:///C:/evil/x.html' } }), 'gate refuses a file:// frame'])
    results.push([!gate({ senderFrame: { url: 'http://evil.example/' } }), 'gate refuses a remote origin'])

    // 2) Real preload, real sandbox, real http origin.
    const win = new BrowserWindow({
      width: 640,
      height: 480,
      show: false,
      webPreferences: {
        preload: path.join(__dirname, '..', '..', 'electron', 'preload.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true
      }
    })
    await win.loadURL(`http://127.0.0.1:${port}/`)

    // Measurement sequence, no races (each step is awaited):
    //  a) register listeners via the real preload;
    //  b) push BOTH channels — only the allow-listed one may arrive;
    //  c) unsubscribe;
    //  d) push again — after unsub NOTHING may arrive (leak check);
    //  e) pull the page's counters.
    await win.webContents.executeJavaScript(`(() => {
      window.__probe = { got: 0, unknownFired: false, sendThrew: false }
      window.__unsub = window.electronAPI.on('eventbus:event', () => window.__probe.got++)
      window.__unsubUnknown = window.electronAPI.on('probe:not-allow-listed', () => { window.__probe.unknownFired = true })
      try { window.electronAPI.send('probe:any', {}) } catch (e) { window.__probe.sendThrew = true; window.__probe.sendErr = String(e && e.message ? e.message : e) }
      window.__probe.unsubIsFn = typeof window.__unsubUnknown === 'function'
      return 'registered'
    })()`)
    win.webContents.send('eventbus:event', { event: 'x', payload: 1 })
    win.webContents.send('probe:not-allow-listed', 1)
    await new Promise(r => setTimeout(r, 400))
    await win.webContents.executeJavaScript('window.__unsub(); "unsubbed"')
    win.webContents.send('eventbus:event', { event: 'x2', payload: 2 })
    win.webContents.send('probe:not-allow-listed', 2)
    await new Promise(r => setTimeout(r, 400))
    const outcome = await win.webContents.executeJavaScript('JSON.stringify(window.__probe)')
    const out = JSON.parse(outcome)

    results.push([out.got === 1, `allow-listed on() fires once then unsub works (got=${out.got})`])
    results.push([out.unsubIsFn && !out.unknownFired, 'unknown-channel on() refused (noop unsub, no delivery)'])
    results.push([out.sendThrew === false, `send() refuses silently on empty allow-list${out.sendErr ? ' :: ' + out.sendErr : ''}`])

    // 3) R134 choke point (§198): install the SAME function main.cjs
    // installs, then register a controller-style channel WITHOUT any
    // per-site guard — exactly how the ~150 real handlers register.
    // Drive it from a foreign-frame window (data: origin, raw invoke
    // via the probe preload) and from the trusted window.
    gateIpcMainHandle(ipcMain, gate)
    ipcMain.handle('probe:ctrl-data', () => ({ rows: ['real-data'] }))

    const foreign = new BrowserWindow({
      width: 400,
      height: 300,
      show: false,
      webPreferences: {
        preload: path.join(__dirname, 'probe_preload.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true
      }
    })
    await foreign.loadURL('data:text/html,<body>foreign</body>')
    const foreignData = await foreign.webContents.executeJavaScript('window.probeAPI.invoke("probe:ctrl-data")')
    results.push([foreignData === undefined, `choke point: foreign frame gets undefined via real ipc (got=${JSON.stringify(foreignData)})`])
    foreign.close()

    const trustedProbe = new BrowserWindow({
      width: 400,
      height: 300,
      show: false,
      webPreferences: {
        preload: path.join(__dirname, 'probe_preload.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true
      }
    })
    await trustedProbe.loadURL(`http://127.0.0.1:${port}/`)
    const trustedData = await trustedProbe.webContents.executeJavaScript('window.probeAPI.invoke("probe:ctrl-data")')
    trustedProbe.close()
    results.push([!!trustedData && Array.isArray(trustedData.rows) && trustedData.rows[0] === 'real-data',
      `choke point: trusted origin gets real data via the same raw invoke (got=${JSON.stringify(trustedData)})`])
  } catch (err) {
    results.push([false, `probe crashed: ${err && err.message ? err.message : String(err)}`])
  } finally {
    if (srv) srv.close()
    let failed = 0
    for (const [ok, name] of results) {
      console.log(`PROBE ${ok ? 'PASS' : 'FAIL'} ${name}`)
      if (!ok) failed++
    }
    app.exit(failed === 0 ? 0 : 1)
  }
})
