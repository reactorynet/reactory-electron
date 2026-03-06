/**
 * Reactory Desktop — Embedded MongoDB Manager
 *
 * Manages a local mongod process lifecycle. In packaged builds, the mongod
 * binary ships as an extraResource. In development, it falls back to
 * mongodb-memory-server which downloads a binary automatically.
 */
import { ChildProcess, execSync, spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import net from 'net';
import log from 'electron-log/main';

export interface MongoManagerOptions {
  /** Path to the mongod binary (packaged builds). Null = use mongodb-memory-server. */
  mongodPath?: string;
  /** Directory to store database files */
  dbPath: string;
  /** Port to listen on */
  port: number;
  /** Database name */
  dbName: string;
}

/**
 * Check if a port is available.
 */
async function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => {
      server.close(() => resolve(true));
    });
    server.listen(port, '127.0.0.1');
  });
}

/**
 * Find and kill any process occupying the given port.
 * Sends SIGTERM first, then SIGKILL after 3 seconds.
 */
async function killProcessOnPort(port: number): Promise<void> {
  try {
    // lsof is available on macOS/Linux; on Windows use netstat approach
    const pids = execSync(`lsof -ti:${port} 2>/dev/null || true`)
      .toString()
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);

    if (pids.length === 0) return;

    log.info(`Found stale process(es) on port ${port}: ${pids.join(', ')} — killing…`);
    for (const pid of pids) {
      try {
        process.kill(Number(pid), 'SIGTERM');
      } catch {
        // Already gone
      }
    }

    // Give them 3 s to exit, then SIGKILL
    await new Promise<void>((resolve) => setTimeout(resolve, 3000));

    for (const pid of pids) {
      try {
        process.kill(Number(pid), 'SIGKILL');
      } catch {
        // Already gone — that's fine
      }
    }

    // Brief pause to let the OS release the port
    await new Promise<void>((r) => setTimeout(r, 500));
  } catch (err) {
    log.warn(`Could not kill process on port ${port}:`, err);
  }
}

/**
 * Wait until a port is accepting connections.
 */
async function waitForPort(port: number, timeoutMs = 30000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const available = await isPortAvailable(port);
    if (!available) {
      // Port is in use — mongod is listening
      return;
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`MongoDB did not start within ${timeoutMs / 1000}s on port ${port}`);
}

export class MongoManager {
  private opts: MongoManagerOptions;
  private mongodProcess: ChildProcess | null = null;
  private memoryServer: any = null; // MongoMemoryServer instance (dev only)
  private running = false;

  constructor(opts: MongoManagerOptions) {
    this.opts = opts;
  }

  /**
   * Start MongoDB and return the connection URI.
   */
  async start(): Promise<string> {
    // Ensure data directory exists
    fs.mkdirSync(this.opts.dbPath, { recursive: true });

    const mongodBinary = this.opts.mongodPath;

    if (mongodBinary && fs.existsSync(mongodBinary)) {
      // ── Packaged build: launch bundled mongod binary ──
      log.info(`Starting bundled mongod at ${mongodBinary}`);
      return this.startBundledMongod(mongodBinary);
    } else {
      // ── Development: use mongodb-memory-server ──
      log.info('No bundled mongod found — falling back to mongodb-memory-server');
      return this.startMemoryServer();
    }
  }

  /**
   * Launch the bundled mongod binary as a child process.
   */
  private async startBundledMongod(binaryPath: string): Promise<string> {
    const { port, dbPath, dbName } = this.opts;

    // Check port
    const portFree = await isPortAvailable(port);
    if (!portFree) {
      log.warn(`Port ${port} already in use — assuming external MongoDB`);
      this.running = true;
      return `mongodb://127.0.0.1:${port}/${dbName}`;
    }

    this.mongodProcess = spawn(binaryPath, [
      '--dbpath', dbPath,
      '--port', String(port),
      '--bind_ip', '127.0.0.1',
      '--noauth',
      '--quiet',
    ], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    this.mongodProcess.stdout?.on('data', (data: Buffer) => {
      log.debug(`[mongod] ${data.toString().trim()}`);
    });

    this.mongodProcess.stderr?.on('data', (data: Buffer) => {
      log.warn(`[mongod:err] ${data.toString().trim()}`);
    });

    this.mongodProcess.on('exit', (code, signal) => {
      log.info(`mongod exited with code=${code} signal=${signal}`);
      this.running = false;
      this.mongodProcess = null;
    });

    // Wait for MongoDB to accept connections
    await waitForPort(port);
    this.running = true;

    const uri = `mongodb://127.0.0.1:${port}/${dbName}`;
    log.info(`Bundled MongoDB ready at ${uri}`);
    return uri;
  }

  /**
   * Use mongodb-memory-server for development.
   */
  private async startMemoryServer(): Promise<string> {
    const { port, dbPath, dbName } = this.opts;

    // Same port-conflict guard as the bundled-mongod path
    const portFree = await isPortAvailable(port);
    if (!portFree) {
      log.warn(`Port ${port} already occupied — attempting to terminate stale process…`);
      await killProcessOnPort(port);

      // Re-check after kill attempt
      const freeAfterKill = await isPortAvailable(port);
      if (!freeAfterKill) {
        // Fall back: assume an external MongoDB we can reuse
        log.warn(`Port ${port} still in use after kill — assuming reusable external MongoDB`);
        this.running = true;
        return `mongodb://127.0.0.1:${port}/${dbName}`;
      }
    }

    const { MongoMemoryServer } = await import('mongodb-memory-server-core');

    this.memoryServer = await MongoMemoryServer.create({
      instance: {
        port: this.opts.port,
        dbPath: this.opts.dbPath,
        storageEngine: 'wiredTiger',
        dbName: this.opts.dbName,
      },
    });

    this.running = true;
    const uri = this.memoryServer.getUri();
    log.info(`MongoMemoryServer ready at ${uri}`);
    return uri;
  }

  /**
   * Gracefully stop MongoDB.
   */
  async stop(): Promise<void> {
    if (this.memoryServer) {
      log.info('Stopping MongoMemoryServer…');
      await this.memoryServer.stop();
      this.memoryServer = null;
      this.running = false;
      return;
    }

    if (this.mongodProcess) {
      log.info('Stopping bundled mongod…');
      return new Promise<void>((resolve) => {
        const timeout = setTimeout(() => {
          log.warn('mongod did not exit gracefully — sending SIGKILL');
          this.mongodProcess?.kill('SIGKILL');
          this.running = false;
          resolve();
        }, 10000);

        this.mongodProcess!.once('exit', () => {
          clearTimeout(timeout);
          this.running = false;
          resolve();
        });

        // Send SIGTERM for graceful shutdown
        this.mongodProcess!.kill('SIGTERM');
      });
    }

    this.running = false;
  }

  isRunning(): boolean {
    return this.running;
  }
}
