const { ipcMain, dialog, BrowserWindow } = require('electron')

const moduleName = 'tools:dialog'

function normalizePath(p) {
  return String(p).replace(/\\/g, '/')
}

function buildOptions(defaults, args) {
  const options = { ...defaults }
  const properties = [...(defaults.properties || [])]

  if (args?.title) options.title = args.title
  if (args?.filters && args.filters.length > 0) options.filters = args.filters
  if (args?.defaultPath) options.defaultPath = args.defaultPath

  if (args?.multiSelections) properties.push('multiSelections')
  if (args?.showHiddenFiles) properties.push('showHiddenFiles')
  if (args?.createDirectory) properties.push('createDirectory')
  if (args?.treatPackageAsDirectory) properties.push('treatPackageAsDirectory')
  if (args?.showOverwriteConfirmation) properties.push('showOverwriteConfirmation')
  if (args?.dontAddToRecent) properties.push('dontAddToRecent')

  if (properties.length) options.properties = properties
  return options
}

async function handleOpenFile(event, args) {
  const defaults = {
    title: 'Open file',
    filters: [{ name: 'All Files', extensions: ['*'] }],
    properties: ['openFile']
  }
  const options = buildOptions(defaults, args)
  const parent = BrowserWindow.fromWebContents(event.sender)
  if (args?.sync) {
    const result = parent
      ? dialog.showOpenDialogSync(parent, options)
      : dialog.showOpenDialogSync(options)
    return result ? result.map(normalizePath) : null
  }
  const result = parent
    ? await dialog.showOpenDialog(parent, options)
    : await dialog.showOpenDialog(options)
  return result.canceled ? null : result.filePaths.map(normalizePath)
}

async function handleOpenFolder(event, args) {
  const defaults = {
    title: 'Open folder',
    properties: ['openDirectory']
  }
  const options = buildOptions(defaults, args)
  const parent = BrowserWindow.fromWebContents(event.sender)
  if (args?.sync) {
    const result = parent
      ? dialog.showOpenDialogSync(parent, options)
      : dialog.showOpenDialogSync(options)
    return result ? result.map(normalizePath) : null
  }
  const result = parent
    ? await dialog.showOpenDialog(parent, options)
    : await dialog.showOpenDialog(options)
  return result.canceled ? null : result.filePaths.map(normalizePath)
}

async function handleSaveFile(event, args) {
  const defaults = {
    title: 'Save file',
    filters: [{ name: 'All Files', extensions: ['*'] }]
  }
  const options = buildOptions(defaults, args)
  const parent = BrowserWindow.fromWebContents(event.sender)
  if (args?.sync) {
    const result = parent
      ? dialog.showSaveDialogSync(parent, options)
      : dialog.showSaveDialogSync(options)
    return result ? normalizePath(result) : null
  }
  const result = parent
    ? await dialog.showSaveDialog(parent, options)
    : await dialog.showSaveDialog(options)
  return result.canceled || !result.filePath ? null : normalizePath(result.filePath)
}

function registerDialogController() {
  ipcMain.handle(`${moduleName}:openFile`, (event, args) => handleOpenFile(event, args))
  ipcMain.handle(`${moduleName}:openFolder`, (event, args) => handleOpenFolder(event, args))
  ipcMain.handle(`${moduleName}:saveFile`, (event, args) => handleSaveFile(event, args))
}

module.exports = { registerDialogController, dialogEvents: {} }
