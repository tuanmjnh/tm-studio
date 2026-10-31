import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import {
  assertDownloadUrl,
  nameFromUrl,
  sanitizeFilename,
  resolveDownloadTarget
} from './media-download.cjs'
import { downloadMediaToFile, cancelMediaDownload } from './tmcut.controller.cjs'

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'tm-download-'))
}

/** Local server: /ok, /redirect, /missing, /slow. */
async function startServer() {
  const server = http.createServer((req, res) => {
    if (req.url === '/ok' || req.url.startsWith('/ok?')) {
      res.writeHead(200, { 'content-type': 'video/mp4', 'content-length': '11' })
      res.end('hello video')
      return
    }
    if (req.url === '/redirect') {
      res.writeHead(302, { location: '/ok' })
      res.end()
      return
    }
    if (req.url === '/stream') {
      // 20 chunks with a gap: long enough to cancel from onProgress.
      res.writeHead(200, { 'content-type': 'video/mp4', 'content-length': String(20 * 1024) })
      let sent = 0
      const timer = setInterval(() => {
        if (sent >= 20) {
          clearInterval(timer)
          res.end()
          return
        }
        sent++
        res.write(Buffer.alloc(1024, 65))
      }, 20)
      res.on('close', () => clearInterval(timer))
      return
    }
    res.writeHead(404, { 'content-type': 'text/plain' })
    res.end('nope')
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()
  return { server, origin: `http://127.0.0.1:${port}` }
}

test('only http(s) URLs are downloadable', () => {
  assert.equal(assertDownloadUrl('https://cdn.test/a.mp4').ok, true)
  assert.equal(assertDownloadUrl('http://cdn.test/a.mp4').ok, true)
  assert.equal(assertDownloadUrl('HTTPS://CDN.TEST/a.mp4').url, 'https://cdn.test/a.mp4')

  for (const bad of [
    'file:///C:/Windows/System32/config',
    'data:video/mp4;base64,AAAA',
    'javascript:alert(1)',
    'ftp://cdn.test/a.mp4',
    '',
    '   ',
    '/home/me/a.mp4',
    'C:\\clips\\a.mp4',
    undefined,
    null
  ]) {
    const result = assertDownloadUrl(bad)
    assert.equal(result.ok, false, `${String(bad)} should be refused`)
    assert.ok(result.reason === 'bad-url' || result.reason === 'bad-protocol')
  }
})

test('the URL basename survives decoding and query strings are ignored', () => {
  assert.equal(nameFromUrl('https://cdn.test/out/My%20Clip.mp4?sig=abc#t=1'), 'My Clip.mp4')
  assert.equal(nameFromUrl('https://cdn.test/'), '')
  assert.equal(nameFromUrl('not a url'), '')
})

test('filenames cannot escape the download folder', () => {
  assert.equal(sanitizeFilename('../../evil.mp4'), 'evil.mp4')
  assert.equal(sanitizeFilename('C:\\Windows\\evil.mp4'), 'evil.mp4')
  assert.equal(sanitizeFilename('/tmp/x/evil.mp4'), 'evil.mp4')
  assert.equal(sanitizeFilename('a:b*c?.mp4'), 'a_b_c_.mp4')
  assert.equal(sanitizeFilename('   ').startsWith('download-'), true)
  assert.equal(sanitizeFilename('clip'), 'clip.mp4')
  assert.equal(sanitizeFilename('clip', 'mov'), 'clip.mov')
})

test('long names are capped but keep their extension', () => {
  const name = sanitizeFilename(`${'a'.repeat(300)}.mp4`)
  assert.equal(name.length <= 120, true)
  assert.equal(name.endsWith('.mp4'), true)
})

test('an existing file gets a numbered suffix instead of being overwritten', () => {
  const taken = new Set(['/dl/clip.mp4', '/dl/clip (1).mp4'])
  const target = resolveDownloadTarget({
    dir: '/dl/',
    url: 'https://cdn.test/clip.mp4',
    exists: candidate => taken.has(candidate)
  })
  assert.equal(target.path, '/dl/clip (2).mp4')
  assert.equal(target.name, 'clip (2).mp4')

  const fresh = resolveDownloadTarget({
    dir: '/dl',
    url: 'https://cdn.test/clip.mp4',
    exists: () => false
  })
  assert.equal(fresh.path, '/dl/clip.mp4')
})

test('a download writes the file, follows redirects and cleans up after itself', async () => {
  const { server, origin } = await startServer()
  const dir = tempDir()
  try {
    const ok = await downloadMediaToFile({ url: `${origin}/ok`, filename: 'clip.mp4', dir })
    assert.equal(ok.ok, true, ok.error)
    assert.equal(fs.readFileSync(ok.path, 'utf8'), 'hello video')
    assert.equal(fs.existsSync(`${ok.path}.part`), false)

    const redirected = await downloadMediaToFile({ url: `${origin}/redirect`, filename: 'moved.mp4', dir })
    assert.equal(redirected.ok, true, redirected.error)
    assert.equal(fs.readFileSync(redirected.path, 'utf8'), 'hello video')

    // The same name twice must not overwrite the first file.
    const again = await downloadMediaToFile({ url: `${origin}/ok`, filename: 'clip.mp4', dir })
    assert.equal(again.path.endsWith('clip (1).mp4'), true, again.path)
    assert.equal(fs.existsSync(ok.path), true)

    const missing = await downloadMediaToFile({ url: `${origin}/missing`, filename: 'gone.mp4', dir })
    assert.equal(missing.ok, false)
    assert.match(missing.error, /HTTP 404/)
    assert.equal(fs.existsSync(path.join(dir, 'gone.mp4')), false)
    assert.equal(fs.readdirSync(dir).some(name => name.endsWith('.part')), false)

    const refused = await downloadMediaToFile({ url: 'file:///etc/passwd', dir })
    assert.equal(refused.ok, false)
    assert.equal(refused.error, 'bad-protocol')
  } finally {
    await new Promise(resolve => server.close(resolve))
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('progress is reported with the declared size and a final marker', async () => {
  const { server, origin } = await startServer()
  const dir = tempDir()
  try {
    const events = []
    const result = await downloadMediaToFile({
      url: `${origin}/stream`,
      filename: 'progress.mp4',
      dir,
      onProgress: payload => events.push(payload)
    })
    assert.equal(result.ok, true, result.error)
    assert.equal(events.length > 0, true)
    assert.equal(events[0].total, 20 * 1024)
    const final = events.at(-1)
    assert.equal(final.done, true)
    assert.equal(final.loaded, result.bytes)
    const loadedValues = events.map(event => event.loaded)
    assert.deepEqual([...loadedValues].sort((a, b) => a - b), loadedValues, 'loaded must never go backwards')
  } finally {
    await new Promise(resolve => server.close(resolve))
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('cancelling mid-download aborts, resolves cancelled and removes the partial file', async () => {
  const { server, origin } = await startServer()
  const dir = tempDir()
  try {
    let canceled = false
    const result = await downloadMediaToFile({
      url: `${origin}/stream`,
      filename: 'cancel.mp4',
      id: 'dl_cancel_test',
      dir,
      onProgress: (payload) => {
        if (canceled || payload.loaded === 0) return
        canceled = true
        assert.equal(cancelMediaDownload('dl_cancel_test'), true)
      }
    })
    assert.equal(result.ok, false)
    assert.equal(result.error, 'cancelled')
    assert.equal(fs.existsSync(path.join(dir, 'cancel.mp4')), false)
    assert.equal(fs.readdirSync(dir).filter(name => name.includes('.part')).length, 0)
    // A second cancel of the same id has nothing left to abort.
    assert.equal(cancelMediaDownload('dl_cancel_test'), false)
  } finally {
    await new Promise(resolve => server.close(resolve))
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('the explicit filename wins over the URL and is sanitized too', () => {
  const target = resolveDownloadTarget({
    dir: '/dl',
    url: 'https://cdn.test/token-name.mp4',
    filename: '../Scene 1.webm',
    exists: () => false
  })
  assert.equal(target.path, '/dl/Scene 1.webm')
})
