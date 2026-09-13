/**
 * Reactory Desktop — Express Server Manager
 *
 * Manages the lifecycle of the Reactory Express Server as a child process.
 *
 * The desktop build launches the server through the Express server's own
 * launcher — `bin/run.sh --bun` — so the Electron app and a standalone
 * deployment share exactly the same boot path (runtime selection, compiled
 * app entry resolution, environment loading). The launcher runs the server
 * under Bun, which has been verified to run the platform.
 *
 * When the compiled server (or the launcher) is not present, the manager
 * falls back to forking the compiled Electron entry point under Node/Electron
 * and finally to the babel-node development workflow.
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
  /**
   * Runtime used to launch the compiled server.
   *   - 'bun'  → launch via the Express server's own `bin/run.sh --bun`
   *              (default; the desktop build ships the launcher)
   *   - 'node' → fork the compiled Electron entry point under Node/Electron
   */
  runtime?: 'bun' | 'node';
  /** Server configuration key passed to bin/run.sh (e.g. "reactory") */
  serverConfigId?: string;
  /** Environment id passed to bin/run.sh (e.g. "local" | "production") */
  envId?: string;
}

export class ReactoryServerManager {
  private opts: ServerManagerOptions;
  private serverProcess: ChildProcess | null = null;
  private running = false;
  /**
   * True when the child was spawned detached and therefore owns its own
   * process group. Only then is it safe to signal the group with a negative
   * pid — otherwise we would signal Electron's own group.
   */
  private detachedProcessGroup = false;

  constructor(opts: ServerManagerOptions) {
    this.opts = opts;
  }

  /**
   * Start the Reactory Express Server.
   * Returns a promise that resolves once the server signals it is ready.
   */
  async start(): Promise<void> {
    const { serverPath, env } = this.opts;

    const runScript = path.join(serverPath, 'bin', 'run.sh');
    const electronEntry = path.join(serverPath, 'electron-entry.js');
    const compiledEntry = path.join(serverPath, 'index.js');
    const srcEntry = path.join(serverPath, 'src', 'index.ts');

    const runtime =
      this.opts.runtime ||
      ((process.env.REACTORY_SERVER_RUNTIME as 'bun' | 'node' | undefined) ?? 'bun');

    // ── Preferred: launch through the Express server's own launcher ──
    // `bin/run.sh --bun` selects Bun, resolves the compiled app entry
    // (app/index.js) and loads the environment file.
    const hasCompiledEntry = fs.existsSync(electronEntry) || fs.existsSync(compiledEntry);
    if (runtime === 'bun' && hasCompiledEntry) {
      if (fs.existsSync(runScript)) {
        log.info(`Starting compiled server via bin/run.sh --bun (${runScript})`);
        return this.startViaRunScript(serverPath, env);
      }
      log.warn(`bin/run.sh not found at ${runScript} — falling back to Node fork`);
    }

    if (fs.existsSync(electronEntry)) {
      // ── Production: fork compiled JS via the Electron entry point ──
      log.info(`Starting compiled server via Electron entry point ${electronEntry}`);
      return this.startCompiled(electronEntry, env);
    } else if (fs.existsSync(compiledEntry)) {
      // ── Production fallback: no electron-entry.js — run the compiled JS ──
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
   * Start the compiled server through the Express server's launcher script
   * (`bin/run.sh --bun`). The launcher resolves the app entry, selects the
   * runtime and execs the server, so this is the canonical desktop boot path.
   *
   * Readiness is detected from stdout (the entry point logs
   * "Reactory Server started.") because the actual server runs as a
   * grandchild (bash → env-cmd → bun) and has no IPC channel back to Electron.
   */
  private startViaRunScript(
    serverPath: string,
    env: Record<string, string>
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const runScript = path.join(serverPath, 'bin', 'run.sh');
      if (!fs.existsSync(runScript)) {
        return reject(new Error(`bin/run.sh not found at ${runScript}`));
      }

      const configId = this.opts.serverConfigId || 'reactory';
      const envId =
        this.opts.envId ||
        (process.env.NODE_ENV === 'production' ? 'production' : 'local');

      const timeout = setTimeout(() => {
        reject(new Error('Server did not start within 120 seconds'));
      }, 120000);

      // NOTE: REACTORY_RUNTIME must stay 'electron' — the Reactory server keys
      // its Electron integration (static client serving, process.exit guards)
      // off that value. The Bun runtime is selected by the --bun flag alone via
      // USE_BUN/run.sh, it is not expressed through REACTORY_RUNTIME.
      const childEnv: Record<string, string> = {
        ...(process.env as Record<string, string>),
        ...env,
        REACTORY_RUNTIME: env.REACTORY_RUNTIME || 'electron',
        REACTORY_SERVER: serverPath,
        REACTORY_CONFIG_ID: configId,
        REACTORY_ENV_ID: envId,
        USE_BUN: 'true',
        PATH: this.resolveRuntimePath(serverPath),
      };

      const args = ['--bun', configId, envId];
      log.info(`Launching server: bash ${runScript} ${args.join(' ')} (cwd=${serverPath})`);

      // Detached so the launcher — and everything it spawns (env-cmd → bun) —
      // forms its own process group that can be signalled as a unit on quit.
      this.detachedProcessGroup = true;
      this.serverProcess = spawn('/bin/bash', [runScript, ...args], {
        cwd: serverPath,
        env: childEnv,
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: true,
      });

      const onReady = () => {
        if (this.running) return;
        clearTimeout(timeout);
        this.running = true;
        resolve();
      };

      // Readiness markers can be split across pipe chunks, so scan a rolling
      // tail of recent output instead of each chunk in isolation.
      const READY_MARKERS = ['System Initialized/Ready', 'Reactory Server started'];
      let outputTail = '';
      const scanForReady = (text: string) => {
        outputTail = (outputTail + text).slice(-8192);
        if (READY_MARKERS.some((marker) => outputTail.includes(marker))) {
          onReady();
        }
      };

      this.serverProcess.stdout?.on('data', (data: Buffer) => {
        const text = data.toString();
        for (const line of text.split('\n')) {
          const msg = line.trim();
          if (msg) log.info(`[server] ${msg}`);
        }
        scanForReady(text);
      });

      this.serverProcess.stderr?.on('data', (data: Buffer) => {
        const text = data.toString();
        const msg = text.trim();
        if (msg) log.warn(`[server:err] ${msg}`);
        scanForReady(text);
      });

      this.serverProcess.on('error', (err) => {
        clearTimeout(timeout);
        log.error('Server launcher error:', err);
        this.running = false;
        this.serverProcess = null;
        reject(err);
      });

      this.serverProcess.on('exit', (code, signal) => {
        clearTimeout(timeout);
        log.info(`Server launcher exited code=${code} signal=${signal}`);
        const wasRunning = this.running;
        this.running = false;
        this.serverProcess = null;
        if (!wasRunning) {
          reject(new Error(`Server process exited unexpectedly with code ${code}`));
        }
      });
    });
  }

  /**
   * Build the PATH for the server launcher.
   *
   * The local `node_modules/.bin` is always added so the Node launcher path can
   * find `env-cmd`.
   *
   * Bun locations are only prepended when `bun` is not already resolvable, and
   * never ahead of an existing installation. Ordering matters: a machine can
   * have several Bun builds (e.g. an x86_64 `~/.bun/bin/bun` alongside an
   * arm64 one on PATH), and forcing the wrong architecture breaks native
   * addons — sharp reports "Could not load the 'sharp' module using the
   * darwin-x64 runtime". Respecting the inherited PATH keeps the same runtime
   * the user validated.
   */
  private resolveRuntimePath(serverPath: string): string {
    const current = process.env.PATH || '';
    const entries = current.split(path.delimiter).filter(Boolean);

    const hasBun = entries.some((dir) => {
      try {
        fs.accessSync(path.join(dir, 'bun'), fs.constants.X_OK);
        return true;
      } catch {
        return false;
      }
    });

    const candidates = [
      // Local CLIs (env-cmd and friends) for the Node launcher path
      path.join(serverPath, 'node_modules', '.bin'),
      ...(hasBun
        ? []
        : [
            process.env.BUN_INSTALL ? path.join(process.env.BUN_INSTALL, 'bin') : '',
            process.env.HOME ? path.join(process.env.HOME, '.bun', 'bin') : '',
            '/opt/homebrew/bin',
            '/usr/local/bin',
          ]),
    ].filter((p): p is string => !!p && !entries.includes(p) && fs.existsSync(p));

    return [...candidates, ...entries].join(path.delimiter);
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

      this.detachedProcessGroup = false;
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
        const wasRunning = this.running;
        this.running = false;
        this.serverProcess = null;
        if (!wasRunning) {
          reject(new Error(`Server process exited unexpectedly with code ${code}`));
        }
      });

      // The server sends a 'ready' message when it's listening
      this.serverProcess.on('message', (msg: any) => {
        if (msg === 'ready' || msg?.type === 'ready') {
          clearTimeout(timeout);
          this.running = true;
          resolve();
        }
      });

      // Fallback: resolve when stdout indicates a successful start.
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

      this.detachedProcessGroup = false;
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

    const child = this.serverProcess;
    const pid = child.pid;
    const useGroup = this.detachedProcessGroup && typeof pid === 'number' && pid > 0;

    log.info('Stopping Reactory server…');

    const signal = (sig: NodeJS.Signals): void => {
      if (useGroup) {
        try {
          // Negative pid → signal the whole detached process group.
          process.kill(-(pid as number), sig);
          return;
        } catch {
          /* group already gone — fall through to the direct child */
        }
      }
      try {
        child.kill(sig);
      } catch {
        /* process already gone */
      }
    };

    const groupAlive = (): boolean => {
      if (!useGroup) return false;
      try {
        process.kill(-(pid as number), 0);
        return true;
      } catch {
        return false;
      }
    };

    await new Promise<void>((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        this.running = false;
        this.serverProcess = null;
        this.detachedProcessGroup = false;
        resolve();
      };

      const deadline = Date.now() + 8000;

      // Resolve only once the whole group is gone. The launcher execs the
      // runtime, but a crash/force-quit can still leave children behind, and
      // the SIGKILL escalation must not be cancelled merely because the group
      // leader exited first.
      const reap = () => {
        if (settled) return;
        if (groupAlive()) {
          if (Date.now() >= deadline) {
            log.warn('Server process group still alive — sending SIGKILL');
            signal('SIGKILL');
            setTimeout(finish, 500);
          } else {
            setTimeout(reap, 250);
          }
          return;
        }
        finish();
      };

      // Try IPC shutdown first (Node fork path), then a graceful signal.
      if (child.connected) {
        try {
          child.send('shutdown');
        } catch {
          /* channel already closed */
        }
      }
      signal('SIGTERM');

      if (useGroup) {
        reap();
      } else {
        child.once('exit', finish);
        setTimeout(() => {
          if (!settled) {
            log.warn('Server did not exit gracefully — sending SIGKILL');
            signal('SIGKILL');
            finish();
          }
        }, 8000);
      }
    });
  }

  isRunning(): boolean {
    return this.running;
  }
}
