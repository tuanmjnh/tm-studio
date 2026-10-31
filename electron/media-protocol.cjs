// media:// protocol (moved out of main.cjs for the R126 webSecurity flip).
//
// Why this module exists: the main window used to run with
// webSecurity:false purely so media:// loads and canvas readback kept
// working. With webSecurity:true a cross-origin fetch() from the app page
// (http://localhost:4002 / loopback nitro) needs CORS on the media
// responses. We echo Access-Control-Allow-Origin ONLY for the app's own
// origins — a remote page (OAuth popup etc.) gets no ACAO, so it cannot
// exfiltrate arbitrary local files through this handler, which it COULD
// while webSecurity was off. Media tags (<video>/<audio>/<img>) need no
// CORS and keep working for the app regardless.
const fs = require('fs')
const path = require('path')
const { Readable } = require('node:stream')

// Content types served by the media:// protocol, keyed by extension.
// The Chromium media pipeline selects its demuxer from Content-Type,
// so a missing header breaks playback of some containers.
const MEDIA_CONTENT_TYPES = {
  '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.webm': 'video/webm',
  '.mkv': 'video/x-matroska', '.mov': 'video/quicktime',
  '.avi': 'video/x-msvideo', '.flv': 'video/x-flv',
  '.wmv': 'video/x-ms-wmv', '.3gp': 'video/3gpp',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg',
  '.oga': 'audio/ogg', '.m4a': 'audio/mp4', '.flac': 'audio/flac',
  '.aac': 'audio/aac', '.opus': 'audio/ogg',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp', '.bmp': 'image/bmp',
  '.tif': 'image/tiff', '.tiff': 'image/tiff', '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml'
}

function mediaContentTypeFor(filePath) {
  const ext = path.extname(filePath || '').toLowerCase()
  return MEDIA_CONTENT_TYPES[ext] || 'application/octet-stream'
}

// File stream for the media protocol. The 'error' listener
// is mandatory: an unhandled 'error' event on a Node stream
// (file locked or deleted between stat and read, requests
// aborted mid-scrub) would throw an uncaught exception and
// take down the main process. Readable.toWeb surfaces the
// failure to the consumer as a broken response body instead.
function diskStream(filePath, start, end) {
  const stream = fs.createReadStream(filePath, { start, end })
  stream.on('error', () => {
    // surfaced via the web stream as a response error
  })
  return stream
}

function mediaSchemePrivileges() {
  return {
    scheme: 'media',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      bypassCSP: true,
      stream: true,
      corsEnabled: true
    }
  }
}

// media://local?file=<abs path> (primary) or media://<abs path> (legacy).
function resolveRequestedFile(requestUrl) {
  try {
    const parsedUrl = new URL(requestUrl)
    const fromQuery = parsedUrl.searchParams.get('file')
    if (fromQuery) return fromQuery
  } catch {
    // fall through to the legacy shape
  }
  let filePath = decodeURIComponent(requestUrl.replace(/^media:\/\//i, ''))
  if (process.platform === 'win32') {
    filePath = filePath.replace(/^\/+([a-zA-Z]:)/, '$1')
  }
  return filePath
}

/**
 * @param {() => string[]} getAllowedOrigins — app origins allowed to
 *   fetch() media:// (dev/prod loopback). Anything else gets no ACAO.
 */
function createMediaHandler(getAllowedOrigins) {
  return async (request) => {
    try {
      const corsHeaders = {}
      const origin = request.headers.get('origin') || ''
      if (origin && getAllowedOrigins().includes(origin)) {
        corsHeaders['Access-Control-Allow-Origin'] = origin
        corsHeaders['Vary'] = 'Origin'
        // Range is not a CORS-safelisted header, so a fetch with it
        // preflights; answer it so app-origin range reads work.
        corsHeaders['Access-Control-Allow-Headers'] = 'Range'
      }
      if (request.method === 'OPTIONS') {
        return new Response(null, { status: 204, headers: corsHeaders })
      }

      const filePath = resolveRequestedFile(request.url)

      if (!filePath || !fs.existsSync(filePath)) {
        return new Response('File not found: ' + (filePath || 'empty path'), { status: 404, headers: corsHeaders })
      }
      const stat = fs.statSync(filePath)
      if (!stat.isFile()) {
        return new Response('Not a file: ' + filePath, { status: 404, headers: corsHeaders })
      }

      const fileSize = stat.size
      const contentType = mediaContentTypeFor(filePath)
      const baseHeaders = { 'Content-Type': contentType, 'Accept-Ranges': 'bytes', ...corsHeaders }

      if (request.method === 'HEAD') {
        return new Response(null, {
          status: 200,
          headers: { ...baseHeaders, 'Content-Length': String(fileSize) }
        })
      }

      if (fileSize === 0) {
        return new Response(new Uint8Array(0), {
          status: 200,
          headers: { ...baseHeaders, 'Content-Length': '0' }
        })
      }

      // Serve the file straight from disk with HTTP Range support
      // (206 Partial Content). The media pipeline seeks by issuing
      // Range requests; a plain 200 without `Accept-Ranges` stalls
      // seeks beyond the initially buffered window, which froze the
      // preview whenever the playhead was dragged off 00:00.
      // (net.fetch(file://) cannot forward Range headers, so the
      // file is streamed directly instead.)
      const rangeHeader = request.headers.get('range')
      const rangeMatch = rangeHeader ? /bytes=(\d*)-(\d*)/.exec(rangeHeader) : null

      if (rangeMatch) {
        let start = rangeMatch[1] ? Number(rangeMatch[1]) : 0
        let end = rangeMatch[2] ? Number(rangeMatch[2]) : fileSize - 1
        if (!Number.isFinite(start) || start < 0) start = 0
        if (!Number.isFinite(end) || end >= fileSize) end = fileSize - 1
        if (!rangeMatch[1] && rangeMatch[2]) {
          // Suffix range ("bytes=-N"): the final N bytes.
          const suffixLength = Math.min(end, fileSize)
          start = fileSize - suffixLength
          end = fileSize - 1
        }
        if (start > end || start >= fileSize) {
          return new Response('Range not satisfiable', {
            status: 416,
            headers: { 'Content-Range': `bytes */${fileSize}`, ...corsHeaders }
          })
        }
        const chunkStream = Readable.toWeb(diskStream(filePath, start, end))
        return new Response(chunkStream, {
          status: 206,
          headers: {
            ...baseHeaders,
            'Content-Length': String(end - start + 1),
            'Content-Range': `bytes ${start}-${end}/${fileSize}`
          }
        })
      }

      const stream = Readable.toWeb(diskStream(filePath, 0, fileSize - 1))
      return new Response(stream, {
        status: 200,
        headers: { ...baseHeaders, 'Content-Length': String(fileSize) }
      })
    } catch (err) {
      return new Response(String(err), { status: 500 })
    }
  }
}

module.exports = { mediaSchemePrivileges, createMediaHandler }
