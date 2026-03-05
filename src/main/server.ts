/**
 * Reactory Desktop — Express Server Manager
 *
 * Manages the lifecycle of the Reactory Express Server as a child process.
 * In production, this runs the pre-compiled server JS. In development, it can
 * delegate to the existing babel-node workflow.
 */
import { ChildProcess, fork, spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import log from 'electron-log/main';

export interface ServerManagerOptions {
  /** Path to the compiled server directory */
  serverPath: string;
  /** Environment variables for the server process */
  env: Record<string, string>;
}

export class ReactoryServerManager {
  private opts: ServerManagerOptions;
  private serverProcess: ChildProcess | null = null;
  private running = false;

  constructor(opts: ServerManagerOptions) {
    this.opts = opts;
  }

  /**
   * Start the Reactory Express Server.
   * Returns a promise that resolves once the server signals it is ready.
   */
  async start(): Promise<void> {
    const { serverPath, env } = this.opts;

    // Determine entry point
    const compiledEntry = path.join(serverPath, 'index.js');
    const srcEntry = path.join(serverPath, 'src', 'index.ts');

    if (fs.existsSync(compiledEntry)) {
      // ── Production: run compiled JS via Node fork ──
      log.info(`Starting compiled server from ${compiledEntry}`);
      return this.startCompiled(compiledEntry, env);
    } else if (fs.existsSync(srcEntry)) {
      // ── Development: run via babel-node ──
      log.info(`Starting dev server from ${srcEntry}`);
      return this.startDev(serverPath, env);
    } else {
      throw new Error(
        `Server entry point not found. Checked:\n  ${compiledEntry}\n  ${srcEntry}`
      );
    }
  }

  /**
   * Start the compiled server (production mode).
   * Uses Node.js fork() for IPC communication.
   */
  private startCompiled(
    entryPath: string,
    env: Record<string, string>
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Server did not start within 60 seconds'));
      }, 60000);

      this.serverProcess = fork(entryPath, [], {
        env: { ...process.env, ...env },
        cwd: path.dirname(entryPath),
        stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
        silent: true,
      });

      // Pipe server stdout/stderr to electron-log
      this.serverProcess.stdout?.on('data', (data: Buffer) => {
        const msg = data.toString().trim();
        if (msg) log.info(`[server] ${msg}`);
      });

      this.serverProcess.stderr?.on('data', (data: Buffer) => {
        const msg = data.toString().trim();
        if (msg) log.warn(`[server:err] ${msg}`);
      });

      this.serverProcess.on('error', (err) => {
        clearTimeout(timeout);
        log.error('Server process error:', err);
        this.running = false;
        reject(err);
      });

      this.serverProcess.on('exit', (code, signal) => {
        clearTimeout(timeout);
        log.info(`Server process exited code=${code} signal=${signal}`);
        this.running = false;
        this.serverProcess = null;
      });

      // The server sends a 'ready' message when it's listening
      // (We'll add this signal to the Express server build)
      this.serverProcess.on('message', (msg: any) => {
        if (msg === 'ready' || msg?.type === 'ready') {
          clearTimeout(timeout);
          this.running = true;
          resolve();
        }
      });

      // Fallback: if no IPC 'ready' message, resolve after stdout indicates success
      // Look for the express server "System Initialized/Ready" log line
      this.serverProcess.stdout?.on('data', (data: Buffer) => {
        const text = data.toString();
        if (text.includes('System Initialized/Ready') || text.includes('Reactory Server started')) {
          clearTimeout(timeout);
          this.running = true;
          resolve();
        }
      });
    });
  }

  /**
   * Start the server in development mode via babel-node.
   */
  private startDev(
    serverPath: string,
    env: Record<string, string>
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Dev server did not start within 90 seconds'));
      }, 90000);

      this.serverProcess = spawn(
        'npx',
        [
          'babel-node',
          './src/index.ts',
          '--presets', '@babel/env',
          '--extensions', '.js,.ts',
        ],
        {
          env: {
            ...process.env,
            ...env,
            NODE_PATH: path.join(serverPath, 'src'),
          },
          cwd: serverPath,
          stdio: ['pipe', 'pipe', 'pipe'],
          shell: true,
        }
      );

      this.serverProcess.stdout?.on('data', (data: Buffer) => {
        const text = data.toString();
        log.info(`[server:dev] ${text.trim()}`);

        if (text.includes('System Initialized/Ready') || text.includes('Reactory Server started')) {
          clearTimeout(timeout);
          this.running = true;
          resolve();
        }
      });

      this.serverProcess.stderr?.on('data', (data: Buffer) => {
        log.warn(`[server:dev:err] ${data.toString().trim()}`);
      });

      this.serverProcess.on('error', (err) => {
        clearTimeout(timeout);
        log.error('Dev server process error:', err);
        this.running = false;
        reject(err);
      });

      this.serverProcess.on('exit', (code) => {
        clearTimeout(timeout);
        log.info(`Dev server exited with code ${code}`);
        this.running = false;
        if (!this.running) {
          reject(new Error(`Dev server exited unexpectedly with code ${code}`));
        }
      });
    });
  }

  /**
   * Gracefully stop the server.
   */
  async stop(): Promise<void> {
    if (!this.serverProcess) {
      this.running = false;
      return;
    }

    log.info('Stopping Reactory server…');

    return new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        log.warn('Server did not exit gracefully — sending SIGKILL');
        this.serverProcess?.kill('SIGKILL');
        this.running = false;
        resolve();
      }, 15000);

      this.serverProcess!.once('exit', () => {
        clearTimeout(timeout);
        this.running = false;
        this.serverProcess = null;
        resolve();
      });

      // Try IPC shutdown first, then SIGTERM
      if (this.serverProcess!.connected) {
        this.serverProcess!.send('shutdown');
      }

      setTimeout(() => {
        if (this.serverProcess) {
          this.serverProcess.kill('SIGTERM');
        }
      }, 2000);
    });
  }

  isRunning(): boolean {
    return this.running;
  }
}
