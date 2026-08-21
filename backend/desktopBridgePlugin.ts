/**
 * Mounts the same bridge handler into Vite development and preview servers. This keeps
 * development and packaged bridge behavior on one implementation while changing only the
 * hosting layer.
 */

import os from 'node:os';
import type { Plugin } from 'vite';
import { createDesktopBridgeMiddleware } from './desktopBridge/middleware.js';

export { handleBridgeRequest } from './desktopBridge/routes/router.js';
export { isLocalBridgeRequest } from './desktopBridge/services/bridgeServiceRuntime.js';

export interface DesktopBridgePluginOptions {
  baseDir?: string;
}

// Creates the Vite plugin that mounts the local bridge middleware in development and preview modes.
export function desktopBridgePlugin({
  baseDir = os.homedir(),
}: DesktopBridgePluginOptions = {}): Plugin {
  const middleware = createDesktopBridgeMiddleware(baseDir);

  return {
    name: 'orbit-desktop-bridge',
    configureServer(server) {
      server.middlewares.use(middleware);
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware);
    },
  };
}
