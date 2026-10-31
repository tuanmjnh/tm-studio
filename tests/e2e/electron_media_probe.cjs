// R126 probe: prove the REAL Electron runtime plays media:// with
// webSecurity:true and answers CORS for the app origin — the exact
// configuration main.cjs now ships. Loads a page from a loopback http
// server (same shape as dev/prod: http origin + media:// resources).
//
//   node_modules\electron\dist\electron.exe tests/e2e/electron_media_probe.cjs
//
// Prints PROBE lines to stdout; exits 0 on all pass, 1 on any failure.
const { app, BrowserWindow, protocol } = require('electron')
const http = require('http')
const fs = require('fs')
const os = require('os')
const path = require('path')

const { mediaSchemePrivileges, createMediaHandler } = require('../../electron/media-protocol.cjs')

protocol.registerSchemesAsPrivileged([mediaSchemePrivileges()])

// --- fixtures ------------------------------------------------------------
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tmcut-eprobe-'))
const wavPath = path.join(dir, 'tone.wav')
;(function writeWavFile() {
  const rate = 8000
  const secs = 2
  const n = rate * secs
  const data = Buffer.alloc(n * 2)
  for (let i = 0; i < n; i++) {
    data.writeInt16LE(Math.round(12000 * Math.sin(2 * Math.PI * 440 * i / rate)), i * 2)
  }
  const h = Buffer.alloc(44)
  h.write('RIFF', 0)
  h.writeUInt32LE(36 + data.length, 4)
  h.write('WAVE', 8)
  h.write('fmt ', 12)
  h.writeUInt32LE(16, 16)
  h.writeUInt16LE(1, 20)
  h.writeUInt16LE(1, 22)
  h.writeUInt32LE(rate, 24)
  h.writeUInt32LE(rate * 2, 28)
  h.writeUInt16LE(2, 32)
  h.writeUInt16LE(16, 34)
  h.write('data', 36)
  h.writeUInt32LE(data.length, 40)
  fs.writeFileSync(wavPath, Buffer.concat([h, data]))
})()
const wavePath = path.join(dir, 'wave.json')
fs.writeFileSync(wavePath, JSON.stringify({ buckets: [1, 2, 3] }))

// --- loopback "app" server ------------------------------------------------
const PAGE = `<!doctype html><html><body>
<audio id="a" muted preload="auto"></audio>
<script>
  const mediaBase = 'media://local?file='
  const results = []
  function ok(name, cond, detail) {
    results.push((cond ? 'PASS' : 'FAIL') + ' ' + name + (detail ? ' :: ' + detail : ''))
    if (results.length === 3) finish()
  }
  function finish() {
    fetch('/report?r=' + encodeURIComponent(results.join('|'))).finally(() => {})
  }
  // 1) media tag loads + plays from media:// under webSecurity:true
  const a = document.getElementById('a')
  a.src = mediaBase + encodeURIComponent(${JSON.stringify(wavPath)})
  a.muted = true
  a.onloadedmetadata = async () => {
    ok('metadata', Math.abs(a.duration - 2) < 0.2, 'dur=' + a.duration)
    try { await a.play() } catch (e) { ok('play', false, String(e)); return }
    setTimeout(() => ok('playback clock advanced', a.currentTime > 0.05, 't=' + a.currentTime), 400)
  }
  a.onerror = () => ok('metadata', false, 'audio error code=' + a.error?.code)
  // 2) fetch() from the http page origin needs CORS — the handler echoes
  // ACAO for app origins only, so this proves the R126 CORS wiring.
  fetch(mediaBase + encodeURIComponent(${JSON.stringify(wavePath)}))
    .then(r => r.ok ? r.json() : Promise.reject(new Error('http ' + r.status)))
    .then(j => ok('cors fetch waveform', Array.isArray(j.buckets), JSON.stringify(j)))
    .catch(e => ok('cors fetch waveform', false, String(e)))
</script></body></html>`

let reportResolve = null
const reportPromise = new Promise((resolve) => {
  reportResolve = resolve
})

function startServer() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      const u = new URL(req.url, 'http://x')
      if (u.pathname === '/report') {
        reportResolve(u.searchParams.get('r') || '')
        res.statusCode = 204
        res.end()
        return
      }
      res.setHeader('content-type', 'text/html')
      res.end(PAGE)
    })
    srv.listen(0, '127.0.0.1', () => resolve({ srv, port: srv.address().port }))
  })
}

function cleanup() {
  try {
    fs.rmSync(dir, { recursive: true, force: true })
  } catch { /* ignore */ }
}

app.whenReady().then(async () => {
  const { srv, port } = await startServer()
  const origins = [`http://127.0.0.1:${port}`, `http://localhost:${port}`]
  protocol.handle('media', createMediaHandler(() => origins))

  const win = new BrowserWindow({
    width: 640, height: 480, show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      autoplayPolicy: 'no-user-gesture-required'
    }
  })
  await win.loadURL(`http://127.0.0.1:${port}/`)

  const report = await Promise.race([
    reportPromise,
    new Promise(resolve => setTimeout(() => resolve(''), 15000))
  ])
  srv.close()
  cleanup()
  const lines = report ? report.split('|') : ['FAIL report-timeout']
  let failed = 0
  for (const line of lines) {
    console.log('PROBE ' + line)
    if (line.startsWith('FAIL')) failed++
  }
  if (lines.length < 3) {
    failed++
    console.log('PROBE FAIL missing-results (' + lines.length + '/3)')
  }
  app.exit(failed === 0 ? 0 : 1)
})
