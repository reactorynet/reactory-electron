/**
 * Express Middleware Patch — Static Client Serving
 *
 * This file should be added to the Express server's route configuration
 * when running in Electron mode (REACTORY_RUNTIME=electron).
 *
 * It serves the pre-built PWA client as static files from Express,
 * eliminating the need for a separate dev server or file:// protocol.
 *
 * ── Integration instructions ──
 *
 * Add this AFTER all API routes in ConfigureRoutes (src/express/routes/index.ts):
 *
 *   if (process.env.REACTORY_RUNTIME === 'electron') {
 *     const clientBuildPath = process.env.ELECTRON_CLIENT_BUILD_PATH;
 *     if (clientBuildPath && fs.existsSync(clientBuildPath)) {
 *       app.use(express.static(clientBuildPath));
 *       app.get('*', (req, res) => {
 *         res.sendFile(path.join(clientBuildPath, 'index.html'));
 *       });
 *     }
 *   }
 */
import express, { Application } from 'express';
import path from 'path';
import fs from 'fs';

export function configureElectronClientServing(app: Application): void {
  const clientBuildPath = process.env.ELECTRON_CLIENT_BUILD_PATH;
  const isElectron = process.env.REACTORY_RUNTIME === 'electron';

  if (!isElectron || !clientBuildPath) {
    return;
  }

  if (!fs.existsSync(clientBuildPath)) {
    console.warn(
      `[Electron] Client build path not found: ${clientBuildPath}. ` +
      `The API will run without a UI.`
    );
    return;
  }

  console.log(`[Electron] Serving client from ${clientBuildPath}`);

  // Serve static assets (JS, CSS, images, etc.)
  app.use(express.static(clientBuildPath, {
    maxAge: '1y',         // Long cache for hashed assets
    immutable: true,
    index: false,         // Don't auto-serve index.html for directory requests
  }));

  // SPA fallback: any non-API, non-CDN route returns index.html
  app.get('*', (req, res, next) => {
    // Skip API and CDN routes
    if (req.path.startsWith('/api') || req.path.startsWith('/cdn') || req.path.startsWith('/auth')) {
      return next();
    }

    const indexPath = path.join(clientBuildPath, 'index.html');
    if (fs.existsSync(indexPath)) {
      res.sendFile(indexPath);
    } else {
      next();
    }
  });
}
