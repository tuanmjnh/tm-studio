export interface RealisticFingerprint {
  os: 'windows' | 'macos' | 'linux'
  browser_type: string
  browser_version: string
  user_agent: string
  screen_resolution: string
  color_depth: number
  hardware_concurrency: number
  device_memory: number
  languages: string
  webrtc_mode: string
  timezone_mode: string
  timezone_val: string
  geo_mode: string
  canvas_mode: string
  webgl_mode: string
  webgl_vendor: string
  webgl_renderer: string
  audio_mode: string
  client_rects_mode: string
  fonts_mode: string
}

const WINDOWS_UAS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0'
]

const MACOS_UAS = [
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15'
]

const LINUX_UAS = [
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:125.0) Gecko/20100101 Firefox/125.0'
]

const RESOLUTIONS = [
  '1920x1080',
  '1920x1080',
  '2560x1440',
  '1366x768',
  '1536x864',
  '1440x900',
  '1680x1050'
]

const WINDOWS_RENDERERS = [
  { vendor: 'Google Inc. (NVIDIA)', renderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0)' },
  { vendor: 'Google Inc. (NVIDIA)', renderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 4070 Direct3D11 vs_5_0 ps_5_0)' },
  { vendor: 'Google Inc. (NVIDIA)', renderer: 'ANGLE (NVIDIA, NVIDIA GeForce GTX 1660 SUPER Direct3D11 vs_5_0 ps_5_0)' },
  { vendor: 'Google Inc. (Intel)', renderer: 'ANGLE (Intel, Intel(R) Iris(R) Xe Graphics Direct3D11 vs_5_0 ps_5_0)' },
  { vendor: 'Google Inc. (AMD)', renderer: 'ANGLE (AMD, AMD Radeon RX 6700 XT Direct3D11 vs_5_0 ps_5_0)' }
]

const MACOS_RENDERERS = [
  { vendor: 'Apple', renderer: 'Apple M1' },
  { vendor: 'Apple', renderer: 'Apple M2' },
  { vendor: 'Apple', renderer: 'Apple M3 Pro' }
]

const LINUX_RENDERERS = [
  { vendor: 'Mesa', renderer: 'Mesa Intel(R) UHD Graphics 630 (CFL GT2)' },
  { vendor: 'NVIDIA Corporation', renderer: 'NVIDIA GeForce RTX 3060/PCIe/SSE2' }
]

function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!
}

export function generateRealisticFingerprint(targetOs: 'windows' | 'macos' | 'linux' = 'windows'): RealisticFingerprint {
  let ua: string
  let gpu: { vendor: string, renderer: string }

  if (targetOs === 'macos') {
    ua = pickRandom(MACOS_UAS)
    gpu = pickRandom(MACOS_RENDERERS)
  } else if (targetOs === 'linux') {
    ua = pickRandom(LINUX_UAS)
    gpu = pickRandom(LINUX_RENDERERS)
  } else {
    ua = pickRandom(WINDOWS_UAS)
    gpu = pickRandom(WINDOWS_RENDERERS)
  }

  const concurrency = pickRandom([4, 8, 8, 12, 16])
  const memory = pickRandom([8, 8, 16, 16, 32])
  const res = pickRandom(RESOLUTIONS)

  return {
    os: targetOs,
    browser_type: 'chrome',
    browser_version: '124.0.0.0',
    user_agent: ua,
    screen_resolution: res,
    color_depth: 24,
    hardware_concurrency: concurrency,
    device_memory: memory,
    languages: 'en-US,en',
    webrtc_mode: 'proxy',
    timezone_mode: 'auto',
    timezone_val: 'Asia/Ho_Chi_Minh',
    geo_mode: 'auto',
    canvas_mode: 'noise',
    webgl_mode: 'noise',
    webgl_vendor: gpu.vendor,
    webgl_renderer: gpu.renderer,
    audio_mode: 'noise',
    client_rects_mode: 'noise',
    fonts_mode: 'system'
  }
}
