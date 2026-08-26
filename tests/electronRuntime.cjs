const pty = require('node-pty')

async function main() {
  if (typeof pty.spawn !== 'function') {
    throw new Error('node-pty did not load in Electron')
  }

  const bridge = await import('../backend-dist/bridgeServer.js')
  if (typeof bridge.startLocalBridgeServer !== 'function') {
    throw new Error('backend bridge did not load in Electron')
  }

  console.log('Electron runtime loaded node-pty and the backend bridge successfully.')
  process.exit(0)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
