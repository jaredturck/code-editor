const pty = require('node-pty')

if (typeof pty.spawn !== 'function') {
  throw new Error('node-pty did not load in Electron')
}

console.log('Electron runtime loaded node-pty successfully.')
process.exit(0)
