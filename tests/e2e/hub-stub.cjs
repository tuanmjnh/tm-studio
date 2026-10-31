// Tiny stub TM Hub for automated UI checks.
// Serves the two endpoints the app actually calls on load:
//   GET /api/v1/auth/me          -> root user (bypasses route permission check)
//   GET /api/v1/apps/:appId/routes -> full nav tree so the sidebar renders
// Everything else 404s. No login page is required: the middleware only
// reads the accessToken cookie and calls /me, so a pre-set cookie + this
// stub is enough to reach /tmcut/editor.
const http = require('node:http')

const PORT = Number(process.env.HUB_PORT || '4000')

const ROUTES = [
  { id: 'r-index', path: '/', label: 'Dashboard', isVisible: true, children: [
    { id: 'r-tmcut', path: '/tmcut', label: 'TMCut', isVisible: true, children: [
      { id: 'r-tmcut-editor', path: '/tmcut/editor', label: 'Editor', isVisible: true },
      { id: 'r-tmcut-templates', path: '/tmcut/templates', label: 'Templates', isVisible: true },
      { id: 'r-tmcut-autocut', path: '/tmcut/autocut', label: 'AutoCut', isVisible: true }
    ] },
    { id: 'r-profiles', path: '/profiles', label: 'Profiles', isVisible: true },
    { id: 'r-tools', path: '/tools', label: 'Tools', isVisible: true },
    { id: 'r-media', path: '/media', label: 'Media', isVisible: true },
    { id: 'r-settings', path: '/settings', label: 'Settings', isVisible: true, children: [
      { id: 'r-settings-tools', path: '/settings/tools', label: 'Tools' },
      { id: 'r-settings-browsers', path: '/settings/browsers', label: 'Browsers' },
      { id: 'r-settings-connections', path: '/settings/connections', label: 'Connections' },
      { id: 'r-settings-security', path: '/settings/security', label: 'Security' },
      { id: 'r-settings-notifications', path: '/settings/notifications', label: 'Notifications' }
    ] },
    { id: 'r-system', path: '/system', label: 'System', isVisible: true, children: [
      { id: 'r-system-config', path: '/system/config', label: 'Config' },
      { id: 'r-system-seed', path: '/system/seed', label: 'Seed' }
    ] },
    { id: 'r-admin', path: '/administration', label: 'Administration', isVisible: true, children: [
      { id: 'r-admin-users', path: '/administration/users', label: 'Users' },
      { id: 'r-admin-roles', path: '/administration/roles', label: 'Roles' },
      { id: 'r-admin-configs', path: '/administration/configs', label: 'Configs' },
      { id: 'r-admin-logs', path: '/administration/logs', label: 'Logs' },
      { id: 'r-admin-import', path: '/administration/import', label: 'Import' },
      { id: 'r-admin-export', path: '/administration/export', label: 'Export' }
    ] }
  ] }
]

function json(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify(body))
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`)
  // CORS so the dev app can read it (dev mode only).
  res.setHeader('access-control-allow-origin', '*')
  res.setHeader('access-control-allow-headers', '*')
  res.setHeader('access-control-allow-methods', 'GET,OPTIONS')
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return }

  if (url.pathname === '/api/v1/auth/me') {
    return json(res, 200, {
      success: true,
      data: {
        userId: 'qa-root',
        email: 'qa@example.com',
        name: 'QA Root',
        username: 'qa',
        roles: ['root'],
        permissions: ['*'],
        platform: 'web',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }
    })
  }
  const m = url.pathname.match(/^\/api\/v1\/apps\/([^/]+)\/routes$/)
  if (m) return json(res, 200, { success: true, data: { routes: ROUTES } })
  return json(res, 404, { success: false, error: 'not_found' })
})

server.listen(PORT, '127.0.0.1', () => {
  console.log(`stub hub on :${PORT}`)
})
