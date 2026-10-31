const { ipcMain } = require('electron')
const fs = require('fs')
const path = require('path')

const moduleName = 'tools:file-manager'

function normalizePath(p) {
  return String(p).replace(/\\/g, '/')
}

function normalizeExtensions(extensions) {
  if (!extensions) return undefined
  return extensions.map(e => (e.startsWith('.') ? e.toLowerCase() : `.${e.toLowerCase()}`))
}

function matchExtension(file, extensions) {
  if (!extensions || extensions.length === 0) return true
  const ext = path.extname(file).toLowerCase()
  return extensions.includes(ext)
}

function buildStat(fullPath, isSlashPath) {
  const stat = fs.statSync(fullPath)
  return {
    name: path.basename(fullPath),
    fullPath: isSlashPath ? normalizePath(fullPath) : fullPath,
    isFile: stat.isFile(),
    isDirectory: stat.isDirectory(),
    size: stat.size,
    atime: stat.atime,
    mtime: stat.mtime,
    ctime: stat.ctime,
    birthtime: stat.birthtime
  }
}

function buildStatFromStat(fullPath, stat, isSlashPath) {
  return {
    name: path.basename(fullPath),
    fullPath: isSlashPath ? normalizePath(fullPath) : fullPath,
    isFile: stat.isFile(),
    isDirectory: stat.isDirectory(),
    size: stat.size,
    atime: stat.atime,
    mtime: stat.mtime,
    ctime: stat.ctime,
    birthtime: stat.birthtime
  }
}

// ===== Sync operations =====
function readFile(filePath, encoding = 'utf-8') {
  return fs.readFileSync(filePath, { encoding })
}

function writeFile(filePath, data, encoding = 'utf-8') {
  fs.writeFileSync(filePath, data, { encoding })
}

function appendFile(filePath, data, encoding = 'utf-8') {
  fs.appendFileSync(filePath, data, { encoding })
}

function exists(filePath) {
  return fs.existsSync(filePath)
}

function deleteFile(filePath) {
  if (exists(filePath)) fs.unlinkSync(filePath)
}

function readJSON(filePath) {
  try {
    return JSON.parse(readFile(filePath))
  } catch {
    return null
  }
}

function writeJSON(filePath, obj, space = 2) {
  writeFile(filePath, JSON.stringify(obj, null, space))
}

function createFolder(dirPath) {
  if (!exists(dirPath)) fs.mkdirSync(dirPath, { recursive: true })
}

function rename(oldPath, newPath) {
  fs.renameSync(oldPath, newPath)
}

function copyFile(src, dest) {
  fs.copyFileSync(src, dest)
}

function copyFolder(src, dest) {
  createFolder(dest)
  const entries = fs.readdirSync(src, { withFileTypes: true })
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name)
    const destPath = path.join(dest, entry.name)
    if (entry.isDirectory()) copyFolder(srcPath, destPath)
    else copyFile(srcPath, destPath)
  }
}

function getTree(dirPath, options, currentDepth = 1) {
  const { extensions, exclude, depth = 2, isSlashPath } = options || {}
  const stat = buildStat(dirPath, isSlashPath)
  const baseName = path.basename(dirPath)

  if (exclude && exclude.includes(baseName)) return null

  const node = { ...stat, type: stat.isDirectory ? 'folder' : 'file' }

  if (stat.isDirectory && (depth === 0 || currentDepth < depth)) {
    const items = fs.readdirSync(dirPath)
    node.children = items
      .map(item => getTree(path.join(dirPath, item), options, currentDepth + 1))
      .filter((child) => {
        if (!child) return false
        if (child.type === 'file') return matchExtension(child.fullPath, normalizeExtensions(extensions))
        return true
      })
  }
  return node
}

function flattenTree(node) {
  if (!node) return []
  const result = [node]
  if (node.type === 'folder' && node.children) {
    result.push(...node.children.flatMap(child => flattenTree(child)))
  }
  return result
}

function listFiles(dirPath, options) {
  return flattenTree(getTree(dirPath, options)).filter(n => n.type === 'file')
}

function listFolders(dirPath, options) {
  return flattenTree(getTree(dirPath, options)).filter(n => n.type === 'folder')
}

function listAll(dirPath, options) {
  return flattenTree(getTree(dirPath, options))
}

function listFileNames(dirPath, options) {
  return listFiles(dirPath, options).map(n => n.name)
}

function listFolderNames(dirPath, options) {
  return listFolders(dirPath, options).map(n => n.name)
}

function listAllNames(dirPath, options) {
  return listAll(dirPath, options).map(n => n.name)
}

// ===== Async operations =====
async function readFileAsync(filePath, encoding = 'utf-8') {
  return fs.promises.readFile(filePath, { encoding })
}

async function writeFileAsync(filePath, data, encoding = 'utf-8') {
  await fs.promises.writeFile(filePath, data, { encoding })
}

async function appendFileAsync(filePath, data, encoding = 'utf-8') {
  await fs.promises.appendFile(filePath, data, { encoding })
}

async function existsAsync(filePath) {
  try {
    await fs.promises.access(filePath)
    return true
  } catch {
    return false
  }
}

async function deleteFileAsync(filePath) {
  if (await existsAsync(filePath)) await fs.promises.unlink(filePath)
}

async function readJSONAsync(filePath) {
  try {
    return JSON.parse(await readFileAsync(filePath))
  } catch {
    return null
  }
}

async function writeJSONAsync(filePath, obj, space = 2) {
  await writeFileAsync(filePath, JSON.stringify(obj, null, space))
}

async function createFolderAsync(dirPath) {
  if (!(await existsAsync(dirPath))) await fs.promises.mkdir(dirPath, { recursive: true })
}

async function renameAsync(oldPath, newPath) {
  await fs.promises.rename(oldPath, newPath)
}

async function copyFileAsync(src, dest) {
  await fs.promises.copyFile(src, dest)
}

async function copyFolderAsync(src, dest) {
  await createFolderAsync(dest)
  const entries = await fs.promises.readdir(src, { withFileTypes: true })
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name)
    const destPath = path.join(dest, entry.name)
    if (entry.isDirectory()) await copyFolderAsync(srcPath, destPath)
    else await copyFileAsync(srcPath, destPath)
  }
}

async function getTreeAsync(dirPath, options, currentDepth = 1) {
  const { extensions, exclude, depth = 2, isSlashPath } = options || {}
  const stat = await fs.promises.stat(dirPath)
  const baseName = path.basename(dirPath)

  if (exclude && exclude.includes(baseName)) return null

  const node = {
    type: stat.isDirectory() ? 'folder' : 'file',
    ...buildStatFromStat(dirPath, stat, isSlashPath)
  }

  if (stat.isDirectory() && (depth === 0 || currentDepth < depth)) {
    const items = await fs.promises.readdir(dirPath)
    const children = await Promise.all(
      items.map(item => getTreeAsync(path.join(dirPath, item), options, currentDepth + 1))
    )
    node.children = children.filter((child) => {
      if (!child) return false
      if (child.type === 'file') return matchExtension(child.fullPath, normalizeExtensions(extensions))
      return true
    })
  }
  return node
}

async function flattenTreeAsync(node) {
  if (!node) return []
  const result = [node]
  if (node.type === 'folder' && node.children) {
    for (const child of node.children) result.push(...(await flattenTreeAsync(child)))
  }
  return result
}

async function listFilesAsync(dirPath, options) {
  return (await flattenTreeAsync(await getTreeAsync(dirPath, options))).filter(n => n.type === 'file')
}

async function listFoldersAsync(dirPath, options) {
  return (await flattenTreeAsync(await getTreeAsync(dirPath, options))).filter(n => n.type === 'folder')
}

async function listAllAsync(dirPath, options) {
  return flattenTreeAsync(await getTreeAsync(dirPath, options))
}

async function listFileNamesAsync(dirPath, options) {
  return (await listFilesAsync(dirPath, options)).map(n => n.name)
}

async function listFolderNamesAsync(dirPath, options) {
  return (await listFoldersAsync(dirPath, options)).map(n => n.name)
}

async function listAllNamesAsync(dirPath, options) {
  return (await listAllAsync(dirPath, options)).map(n => n.name)
}

function imageToDataUrl(imagePath) {
  try {
    const { nativeImage } = require('electron')
    const img = nativeImage.createFromPath(imagePath)
    return img.toDataURL()
  } catch {
    return null
  }
}

function registerFileManagerController(options = {}) {
  // R133 §197 — sender validation (audit residual risk: this controller
  // exposed 44 unrestricted absolute-path FS channels with NO origin
  // check). The gate is injected by main.cjs (the app-origin rule, same
  // factory every privileged handler uses); refusing means the operation
  // simply does not happen and a typed-empty answer goes back: null /
  // false / undefined, never a stack trace an attacker can fingerprint.
  // When no gate is injected (tests), handlers stay permissive so the
  // module remains unit-testable without Electron frames.
  const guard = typeof options?.isTrustedSender === 'function'
    ? (event, handler) => (options.isTrustedSender(event) ? handler(event) : null)
    : (event, handler) => handler(event)

  const sync = (key, fn) => ipcMain.handle(`${moduleName}:${key}`, (event, ...args) => guard(event, () => fn(...args)))
  const syncObj = (key, fn) => ipcMain.handle(`${moduleName}:${key}`, (event, args) => guard(event, () => fn(args?.filePath, args?.encoding)))
  const syncObj2 = (key, fn) => ipcMain.handle(`${moduleName}:${key}`, (event, args) => guard(event, () => fn(args?.filePath, args?.data, args?.encoding)))
  const tree = (key, fn) => ipcMain.handle(`${moduleName}:${key}`, (event, args) => guard(event, () => fn(args?.dirPath, args?.options)))

  syncObj('read', readFile)
  syncObj2('write', writeFile)
  syncObj2('append', appendFile)
  sync('exists', exists)
  sync('delete', deleteFile)
  sync('readJSON', readJSON)
  ipcMain.handle(`${moduleName}:writeJSON`, (event, args) => guard(event, () => writeJSON(args?.filePath, args?.obj, args?.space)))
  sync('createFolder', createFolder)
  ipcMain.handle(`${moduleName}:rename`, (event, args) => guard(event, () => rename(args?.oldPath, args?.newPath)))
  ipcMain.handle(`${moduleName}:copyFile`, (event, args) => guard(event, () => copyFile(args?.src, args?.dest)))
  ipcMain.handle(`${moduleName}:copyFolder`, (event, args) => guard(event, () => copyFolder(args?.src, args?.dest)))

  tree('getTree', getTree)
  tree('listFlat', (dir, opt) => listAll(dir, opt))
  tree('listFiles', listFiles)
  tree('listFolders', listFolders)
  tree('listAll', listAll)
  tree('listFileNames', listFileNames)
  tree('listFolderNames', listFolderNames)
  tree('listAllNames', listAllNames)

  // Async versions
  syncObj('readAsync', readFileAsync)
  syncObj2('writeAsync', writeFileAsync)
  syncObj2('appendAsync', appendFileAsync)
  sync('existsAsync', existsAsync)
  sync('deleteAsync', deleteFileAsync)
  sync('readJSONAsync', readJSONAsync)
  ipcMain.handle(`${moduleName}:writeJSONAsync`, (event, args) => guard(event, () => writeJSONAsync(args?.filePath, args?.obj, args?.space)))
  sync('createFolderAsync', createFolderAsync)
  ipcMain.handle(`${moduleName}:renameAsync`, (event, args) => guard(event, () => renameAsync(args?.oldPath, args?.newPath)))
  ipcMain.handle(`${moduleName}:copyFileAsync`, (event, args) => guard(event, () => copyFileAsync(args?.src, args?.dest)))
  ipcMain.handle(`${moduleName}:copyFolderAsync`, (event, args) => guard(event, () => copyFolderAsync(args?.src, args?.dest)))

  tree('getTreeAsync', getTreeAsync)
  tree('listFlatAsync', async (dir, opt) => listAllAsync(dir, opt))
  tree('listFilesAsync', listFilesAsync)
  tree('listFoldersAsync', listFoldersAsync)
  tree('listAllAsync', listAllAsync)
  tree('listFileNamesAsync', listFileNamesAsync)
  tree('listFolderNamesAsync', listFolderNamesAsync)
  tree('listAllNamesAsync', listAllNamesAsync)

  sync('imageToDataUrl', imageToDataUrl)
}

module.exports = { registerFileManagerController, fileManagerEvents: {}, normalizePath }
