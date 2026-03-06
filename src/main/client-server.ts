/**
 * Reactory Desktop — Static Client Server
 *
 * Serves the pre-built PWA client on a local port so the Electron
 * BrowserWindow can load it.  The API endpoint (Express) runs on a
 * separate port and the client build already has it baked in via
 * REACT_APP_API_ENDPOINT.
 *
 * Features:
 *   - Standard static file serving with proper MIME types
 *   - SPA fallback: any path that doesn't match a file returns index.html
 *     (required for BrowserRouter / client-side routing)
 *   - Gzip support for pre-compressed assets
 */
import http from 'http';
import fs from 'fs';
import path from 'path';
import log from 'electron-log/main';

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.eot': 'application/vnd.ms-fontobject',
  '.map': 'application/json',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml',
  '.webmanifest': 'application/manifest+json',
  '.ejs': 'text/html; charset=utf-8',
};

export interface ClientServerOptions {
  /** Absolute path to the client build directory */
  clientBuildPath: string;
  /** Port to serve on */
  port: number;
  /** Port the API server is running on (for CORS headers) */
  apiPort: number;
}

export class ClientServer {
  private opts: ClientServerOptions;
  private server: http.Server | null = null;
  private running = false;

  constructor(opts: ClientServerOptions) {
    this.opts = opts;
  }

  /**
   * Start serving the client build.
   * Resolves once the server is listening.
   */
  async start(): Promise<void> {
    const { clientBuildPath, port, apiPort } = this.opts;

    // Verify the build directory exists
    const indexPath = path.join(clientBuildPath, 'index.html');
    if (!fs.existsSync(indexPath)) {
      throw new Error(
        `Client build not found at ${clientBuildPath}\n` +
        `Expected index.html at ${indexPath}\n\n` +
        `Build the PWA client first:\n` +
        `  cd $REACTORY_CLIENT && bin/build.sh reactory electron`
      );
    }

    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => {
        this.handleRequest(req, res, clientBuildPath, apiPort);
      });

      this.server.on('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'EADDRINUSE') {
          reject(new Error(`Client server port ${port} is already in use`));
        } else {
          reject(err);
        }
      });

      this.server.listen(port, '127.0.0.1', () => {
        this.running = true;
        log.info(`Client server listening on http://localhost:${port}`);
        resolve();
      });
    });
  }

  /**
   * Handle an incoming HTTP request.
   */
  private handleRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    root: string,
    apiPort: number
  ): void {
    // Parse the URL path, strip query string
    const urlPath = (req.url || '/').split('?')[0];
    const decodedPath = decodeURIComponent(urlPath);

    // Security: prevent directory traversal
    const safePath = path.normalize(decodedPath).replace(/^(\.\.[/\\])+/, '');
    const filePath = path.join(root, safePath);

    // Ensure the resolved path is still within root
    if (!filePath.startsWith(root)) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }

    // Try to serve the file
    fs.stat(filePath, (err, stats) => {
      if (!err && stats.isFile()) {
        this.serveFile(res, filePath);
      } else if (!err && stats.isDirectory()) {
        // Try index.html inside the directory
        const dirIndex = path.join(filePath, 'index.html');
        if (fs.existsSync(dirIndex)) {
          this.serveFile(res, dirIndex);
        } else {
          // SPA fallback
          this.serveFile(res, path.join(root, 'index.html'));
        }
      } else {
        // File not found → SPA fallback (return index.html for client routes)
        const indexHtml = path.join(root, 'index.html');
        if (fs.existsSync(indexHtml)) {
          this.serveFile(res, indexHtml);
        } else {
          res.writeHead(404);
          res.end('Not Found');
        }
      }
    });
  }

  /**
   * Serve a single file with correct MIME type and caching headers.
   */
  private serveFile(res: http.ServerResponse, filePath: string): void {
    const ext = path.extname(filePath).toLowerCase();
    const mimeType = MIME_TYPES[ext] || 'application/octet-stream';

    // Cache static assets aggressively (they have content hashes in filenames)
    const isHashed = /\.[a-f0-9]{8,}\./i.test(path.basename(filePath));
    const cacheControl = isHashed
      ? 'public, max-age=31536000, immutable'
      : 'no-cache';

    const stream = fs.createReadStream(filePath);
    stream.on('error', () => {
      res.writeHead(500);
      res.end('Internal Server Error');
    });

    res.writeHead(200, {
      'Content-Type': mimeType,
      'Cache-Control': cacheControl,
      'X-Content-Type-Options': 'nosniff',
    });

    stream.pipe(res);
  }

  /**
   * Stop the client server.
   */
  async stop(): Promise<void> {
    if (!this.server) {
      this.running = false;
      return;
    }

    return new Promise((resolve) => {
      this.server!.close(() => {
        this.running = false;
        this.server = null;
        log.info('Client server stopped');
        resolve();
      });

      // Force-close after 5s
      setTimeout(() => {
        if (this.server) {
          this.server.closeAllConnections?.();
          this.running = false;
          this.server = null;
          resolve();
        }
      }, 5000);
    });
  }

  isRunning(): boolean {
    return this.running;
  }

  getUrl(): string {
    return `http://localhost:${this.opts.port}`;
  }
}
