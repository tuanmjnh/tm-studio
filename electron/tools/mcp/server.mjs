#!/usr/bin/env node
// =============================================================================
// TMCut MCP Server — stdio JSON-RPC 2.0 entry point
// Spawned by Electron main on demand; talks to main via privileged IPC
// =============================================================================

import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  InitializeRequestSchema,
  PingRequestSchema
} from '@modelcontextprotocol/sdk/types.js'
import { TOOL_REGISTRY, buildCapabilities, getToolDef } from './tool-registry.js'
import { createMockIpc } from './ipc.js'

// -----------------------------------------------------------------------------
// Session state (single session per server process in MVP)
// -----------------------------------------------------------------------------
/** @typedef {{ id: string, projectId?: string, ipc: object, startedAt: string, requestCount: number, lastActivity: number }} SessionState */

/** @type {SessionState|null} */
let session = null
/** @type {StdioServerTransport} */
let transport
/** @type {Server} */
let server

// -----------------------------------------------------------------------------
// Idle timeout (configurable)
// -----------------------------------------------------------------------------
const IDLE_TIMEOUT_MS = Number(process.env.MCP_IDLE_TIMEOUT_MS) || 300000 // 5 min
/** @type {NodeJS.Timeout|null} */
let idleTimer = null

function resetIdleTimer() {
  if (idleTimer) clearTimeout(idleTimer)
  idleTimer = setTimeout(() => {
    console.error('[MCP] Idle timeout, shutting down')
    shutdown(0)
  }, IDLE_TIMEOUT_MS)
}

// -----------------------------------------------------------------------------
// Request ID generator (for IPC correlation)
// -----------------------------------------------------------------------------
let requestCounter = 0
function nextRequestId() {
  return `req-${Date.now()}-${++requestCounter}`
}

// -----------------------------------------------------------------------------
// Main MCP Server setup
// -----------------------------------------------------------------------------
server = new Server(
  { name: 'tmcut-mcp', version: '0.1.0' },
  { capabilities: { tools: {} } }
)

// -----------------------------------------------------------------------------
// Initialize: create session, bind to project
// -----------------------------------------------------------------------------
server.setRequestHandler(InitializeRequestSchema, async (request) => {
  const projectId = (request.params || {}).projectId
  const isTest = process.env.MCP_TEST_MODE === '1'
  const ipc = isTest ? createMockIpc(projectId || 'test-project') : await createRealIpcTransport(projectId)

  session = {
    id: `sess-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    projectId,
    ipc,
    startedAt: new Date().toISOString(),
    requestCount: 0,
    lastActivity: Date.now()
  }

  resetIdleTimer()

  return {
    protocolVersion: '2024-11-05',
    capabilities: buildCapabilities(projectId),
    serverInfo: { name: 'tmcut-mcp', version: '0.1.0' }
  }
})

// -----------------------------------------------------------------------------
// List tools
// -----------------------------------------------------------------------------
server.setRequestHandler(ListToolsRequestSchema, async () => {
  if (!session) throw new Error('Session not initialized')
  resetIdleTimer()
  return { tools: buildCapabilities(session.projectId).tools }
})

// -----------------------------------------------------------------------------
// Call tool
// -----------------------------------------------------------------------------
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (!session) throw new Error('Session not initialized')

  const { name, arguments: args } = request.params
  const toolDef = getToolDef(name)

  if (!toolDef) {
    throw new Error(`METHOD_NOT_FOUND: Tool "${name}" not found`)
  }

  // Validate params (SDK validates against advertised JSON Schema)
  const params = args

  // Rate limiting (per session)
  session.requestCount++
  session.lastActivity = Date.now()
  resetIdleTimer()

  const requestId = `req-${Date.now()}-${++requestCounter}`

  try {
    const result = await toolDef.handler(params, {
      projectId: session.projectId || 'default',
      sessionId: session.id,
      ipc: session.ipc
    })

    // Emit proposal_changed event if proposal was modified
    if (name.startsWith('edit.') || name.startsWith('timeline.')) {
      const proposal = await session.ipc.getProposal(session.projectId || 'default')
      if (proposal) {
        console.error(JSON.stringify({ type: 'event:proposal_changed', payload: proposal }))
      }
    }

    return {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      isError: !result.ok
    }
  } catch (error) {
    const mcpError = {
      code: -32603,
      message: error.message || 'Internal error',
      data: { code: error.code || 'INTERNAL_ERROR' }
    }

    if (error.code === 'RATE_LIMITED') mcpError.code = -32001
    else if (error.code === 'DUPLICATE_REQUEST') mcpError.code = -32002
    else if (error.code === 'REVISION_CONFLICT') mcpError.code = -32003
    else if (error.code === 'METHOD_NOT_FOUND') mcpError.code = -32601
    else if (error.code === 'INVALID_PARAMS') mcpError.code = -32602

    return {
      content: [{ type: 'text', text: JSON.stringify({ ok: false, error: mcpError.data }, null, 2) }],
      isError: true
    }
  }
})

// -----------------------------------------------------------------------------
// Ping (keepalive)
// -----------------------------------------------------------------------------
server.setRequestHandler(PingRequestSchema, async () => {
  resetIdleTimer()
  return {}
})

// -----------------------------------------------------------------------------
// Real IPC transport (connects to Electron main via preload)
// -----------------------------------------------------------------------------
/** @returns {Promise<object>} */
async function createRealIpcTransport(projectId) {
  // In the real Electron context, main spawns this process with an IPC channel.
  // For the spawned child process, we communicate with main via a
  // dedicated IPC channel established by main when spawning us.
  //
  // The main process passes us a port via --mcp-port=PORT or
  // we use the stdio that main already gave us (this process IS the stdio transport).
  //
  // Actually, the MCP SDK's StdioServerTransport IS our stdio to the host.
  // The IPC to Electron main is a SEPARATE channel.
  //
  // Main sets up: child = spawn('node', [server.mjs], { stdio: ['pipe', 'pipe', 'pipe', 'ipc'] })
  // Then we can use process.on('message') / process.send() for main ↔ server IPC.
  //
  // For now, return a stub that will be replaced when main wires it up.
  return createMockIpc(projectId || 'default')
}

// -----------------------------------------------------------------------------
// Stdio transport for MCP host (Claude Desktop, etc.)
// -----------------------------------------------------------------------------
transport = new StdioServerTransport()

// -----------------------------------------------------------------------------
// Graceful shutdown
// -----------------------------------------------------------------------------
let isShuttingDown = false

process.on('SIGINT', () => shutdown(0))
process.on('SIGTERM', () => shutdown(0))
process.on('uncaughtException', (err) => {
  console.error('[MCP] Uncaught exception:', err)
  shutdown(1)
})
process.on('unhandledRejection', (reason) => {
  console.error('[MCP] Unhandled rejection:', reason)
  shutdown(1)
})

function shutdown(code) {
  if (isShuttingDown) return
  isShuttingDown = true
  if (idleTimer) clearTimeout(idleTimer)
  transport.close()
  server.close()
  process.exit(code)
}

// -----------------------------------------------------------------------------
// Start
// -----------------------------------------------------------------------------
async function main() {
  try {
    await server.connect(transport)
    console.error('[MCP] tmcut-mcp server started (stdio)')
  } catch (error) {
    console.error('[MCP] Failed to start:', error)
    shutdown(1)
  }
}

main()