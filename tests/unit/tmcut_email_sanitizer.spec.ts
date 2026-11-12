/**
 * Untrusted HTML mail must not be able to run script, and a URL must be judged
 * on the value the browser will act on rather than on the bytes in the body.
 *
 * The defect this pins was measured in a browser, not inferred: the previous
 * sanitizer matched `javascript:` as a literal string inside the attribute, but
 * a browser decodes entities and drops C0 controls/whitespace before reading a
 * URL's scheme. So all three of these survived the filter and executed on click:
 *
 *   href="jav&#x61;script:…"     (entity-encoded letter)
 *   href="jav\tascript:…"        (tab inside the scheme)
 *   href="java\nscript:…"        (newline inside the scheme)
 *
 * The inbox body comes from `GET /api/v1/apps/:appId/mail/inbox/threads/:id`,
 * so the author of the mail controls it. The app sets no CSP and the access
 * token cookie is not httpOnly, which is why a click alone was enough to read
 * the session. The fix allowlists schemes on the decoded value.
 */
import '../../tests/unit/helpers/tmcut_store_env'
import { sanitizeEmailHtml } from '../../app/utils/inboxHtml'

let passed = 0
class CheckFailed extends Error {}
async function check(name: string, fn: () => void | Promise<void>) {
  try {
    await fn()
  } catch (error) {
    console.error(`FAILED: ${name}\n  ${(error as Error).message}`)
    throw error
  }
  passed++
  console.log(`[ok] ${name}`)
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new CheckFailed(message)
}

/** The URL a browser would resolve for the first `href`/`src` in `html`. */
function keptUrl(html: string, attr = 'href'): string | null {
  const m = new RegExp(`${attr}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(html)
  if (!m) return null
  return m[2] ?? m[3] ?? m[4] ?? null
}

/** Drop the characters a browser ignores when it reads a URL. */
function stripNoise(value: string): string {
  let out = ''
  for (const ch of value) {
    const code = ch.codePointAt(0) ?? 0
    if (code <= 0x20 || code === 0x7f) continue
    out += ch
  }
  return out
}

/** Mirror of the browser's URL pre-processing: decode entities, drop C0 and space. */
function browserScheme(url: string): string | null {
  const decoded = url
    .replace(/&#x([0-9a-f]+);?/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);?/g, (_, d: string) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&colon;?/gi, ':')
    .replace(/&tab;?/gi, '\t')
  return /^([a-z][a-z0-9+.-]*):/i.exec(stripNoise(decoded))?.[1]?.toLowerCase() ?? null
}

async function main() {
  await check('entity-encoded, tabbed and newline-split javascript: URLs are removed', async () => {
    // Each of these executed in a real browser against the old filter.
    const payloads = [
      '<a href="jav&#x61;script:alert(1)">x</a>',
      '<a href="jav&#97;script:alert(1)">x</a>',
      '<a href="jav&colon;ascript:alert(1)">x</a>',
      '<a href="jav\tascript:alert(1)">x</a>',
      '<a href="java\nscript:alert(1)">x</a>',
      '<a href="  javascript:alert(1)">x</a>',
      '<a href="JaVaScRiPt:alert(1)">x</a>',
      '<a href="\u0001javascript:alert(1)">x</a>'
    ]
    for (const payload of payloads) {
      const out = sanitizeEmailHtml(payload)
      const url = keptUrl(out)
      assert(url === null, `kept a URL from ${JSON.stringify(payload)} -> ${JSON.stringify(out)}`)
    }
  })

  await check('the src attribute is held to the same rule', async () => {
    for (const payload of [
      '<img src="jav&#x61;script:alert(1)">',
      '<img src="jav\tascript:alert(1)">'
    ]) {
      const out = sanitizeEmailHtml(payload)
      assert(keptUrl(out, 'src') === null, `kept src from ${JSON.stringify(payload)} -> ${JSON.stringify(out)}`)
    }
  })

  await check('every URL the sanitizer keeps resolves to a safe scheme', async () => {
    // The property, not an example: whatever survives must be http(s)/mailto/
    // tel/cid, a relative path, a fragment, or an image data: URL.
    const inputs = [
      '<a href="jav&#x61;script:alert(1)">x</a>',
      '<a href="vbscript:msgbox(1)">x</a>',
      '<a href="data:text/html,<script>alert(1)</script>">x</a>',
      '<img src="data:text/html;base64,PHNjcmlwdD4=">',
      '<a href="https://example.com/ok">ok</a>',
      '<a href="mailto:a@b.c">mail</a>',
      '<a href="#section">jump</a>',
      '<a href="/relative">rel</a>',
      '<img src="data:image/png;base64,iVBORw0KGgo=">'
    ]
    const allowed = new Set(['http', 'https', 'mailto', 'tel', 'cid'])
    for (const input of inputs) {
      const out = sanitizeEmailHtml(input)
      for (const attr of ['href', 'src']) {
        const url = keptUrl(out, attr)
        if (url === null) continue
        const scheme = browserScheme(url)
        const relative = !scheme
        const imageData = scheme === 'data' && attr === 'src' && /^data:image\//i.test(stripNoise(url))
        assert(
          relative || allowed.has(scheme) || imageData,
          `${JSON.stringify(input)} kept an unsafe URL ${JSON.stringify(url)} (scheme ${scheme})`
        )
      }
    }
  })

  await check('handler attributes are removed even when unquoted and slash-separated', async () => {
    const payloads = [
      '<img src=x onerror=alert(1)>',
      '<img src=x onerror="alert(1)">',
      '<img/src=x/onerror=alert(1)>',
      '<IMG SRC=X ONERROR=alert(1)>',
      '<img src=x\nonerror=alert(1)>',
      '<details open ontoggle=alert(1)>',
      '<div onmouseover=alert(1)>x</div>',
      '<iframe srcdoc="<script>alert(1)</script>"></iframe>'
    ]
    for (const payload of payloads) {
      const out = sanitizeEmailHtml(payload).toLowerCase()
      assert(!/\son[a-z]+\s*=/.test(out), `kept a handler from ${JSON.stringify(payload)} -> ${JSON.stringify(out)}`)
      assert(!/srcdoc/.test(out), `kept srcdoc from ${JSON.stringify(payload)}`)
    }
  })

  await check('active elements are dropped whole, not just their tags', async () => {
    const out = sanitizeEmailHtml('<p>keep</p><script>alert(1)</script><style>body{}</style><p>tail</p>')
    assert(!/script|style/i.test(out), `active element survived: ${JSON.stringify(out)}`)
    assert(out.includes('keep') && out.includes('tail'), `lost surrounding content: ${JSON.stringify(out)}`)
  })

  await check('ordinary mail formatting still renders', async () => {
    // The sanitizer must stay usable: mail is mostly links, bold, and images.
    const input = '<p>Hello <b>there</b>, see <a href="https://example.com/a?b=1&amp;c=2">this</a></p>'
    const out = sanitizeEmailHtml(input)
    assert(out.includes('<b>there</b>'), `dropped <b>: ${JSON.stringify(out)}`)
    assert(/<a\s[^>]*href="https:\/\/example\.com/.test(out), `dropped a normal link: ${JSON.stringify(out)}`)
    assert(out.includes('<p>'), `dropped <p>: ${JSON.stringify(out)}`)
  })

  await check('an empty or missing body stays empty', async () => {
    assert(sanitizeEmailHtml('') === '', 'empty input produced output')
    assert(sanitizeEmailHtml(undefined as unknown as string) === '', 'undefined input produced output')
  })

  console.log(`\n=== All ${passed} email-sanitizer checks passed ===`)
}

main().catch((error) => {
  if (error instanceof CheckFailed) process.exit(1)
  console.error(error)
  process.exit(1)
})
