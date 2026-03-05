/**
 * Reactory Desktop — Electron Main Process Entry
 *
 * Boot sequence:
 *   1. Show splash window
 *   2. Start embedded MongoDB (or connect to external)
 *   3. Compile environment & start the Express server
 *   4. Express serves the pre-built PWA client + API
 *   5. Open main BrowserWindow pointing at http://localhost:<port>
 *   6. Hide splash, show main window
 */
import path from 'path';
import { app, BrowserWindow, dialog, ipcMain, Menu } from 'electron';
import log from 'electron-log/main';
import { JsonStore } from './store';
import { MongoManager } from './mongodb';
import { ReactoryServerManager } from './server';
import { createSplashWindow, closeSplash } from './splash';
import { createTray } from './tray';
import { setupAutoUpdater } from './updater';
import { resolveEnv, PATHS } from './env';

// ── Logging ────────────────────────────────────────────────
log.initialize();
log.transports.file.level = 'info';
log.transports.console.level = 'debug';
log.info(`Reactory Desktop v${app.getVersion()} starting…`);

// ── Persistent settings ────────────────────────────────────
export const store = new JsonStore();

// ── State ──────────────────────────────────────────────────
let mainWindow: BrowserWindow | null = null;
let mongoManager: MongoManager | null = null;
let serverManager: ReactoryServerManager | null = null;

// ── Helpers ────────────────────────────────────────────────

/**
 * Map of well-known resource names to their dev-mode paths.
 * In dev mode, we resolve from existing workspace env vars.
 * In packaged mode, everything lives under process.resourcesPath.
 */
const DEV_RESOURCE_MAP: Record<string, string | undefined> = {
  server: process.env.REACTORY_SERVER,
  'reactory-data': process.env.REACTORY_DATA,
  client: process.env.REACTORY_CLIENT
    ? path.join(process.env.REACTORY_CLIENT, 'build', 'reactory', 'local')
    : undefined,
};

function getResourcePath(...segments: string[]): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, ...segments);
  }

  // Dev mode: check if the first segment maps to a known workspace path
  const [first, ...rest] = segments;
  const mapped = DEV_RESOURCE_MAP[first];
  if (mapped) {
    return rest.length > 0 ? path.join(mapped, ...rest) : mapped;
  }

  // Fallback: look in build/ first, then project root
  const buildPath = path.resolve(__dirname, '..', '..', 'build', ...segments);
  const rootPath = path.resolve(__dirname, '..', '..', ...segments);
  const fs = require('fs');
  return fs.existsSync(buildPath) ? buildPath : rootPath;
}

// ── Main Window ────────────────────────────────────────────

function createMainWindow(port: number): BrowserWindow {
  const savedBounds = store.get('windowBounds');

  const win = new BrowserWindow({
    width: savedBounds?.width ?? 1400,
    height: savedBounds?.height ?? 900,
    x: savedBounds?.x,
    y: savedBounds?.y,
    show: false,
    title: 'Reactory Desktop',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  win.loadURL(`http://localhost:${port}`);

  win.on('ready-to-show', () => {
    closeSplash();
    win.show();
    win.focus();
  });

  win.on('close', () => {
    const bounds = win.getBounds();
    store.set('windowBounds', bounds);
  });

  win.on('closed', () => {
    mainWindow = null;
  });

  return win;
}

// ── Boot Sequence ──────────────────────────────────────────

async function boot(): Promise<void> {
  log.info('Boot sequence starting…');
  const splash = createSplashWindow();

  try {
    // ── Step 1: MongoDB ──
    const useEmbedded = store.get('useEmbeddedMongo');
    let mongoUri: string;

    if (useEmbedded) {
      splash.webContents.send('splash:status', 'Starting database…');
      mongoManager = new MongoManager({
        dbPath: path.join(app.getPath('userData'), 'mongodb-data'),
        mongodPath: getResourcePath('mongodb', 'mongod'),
        port: 27018,
        dbName: 'reactory',
      });
      mongoUri = await mongoManager.start();
      log.info(`Embedded MongoDB running at ${mongoUri}`);
    } else {
      mongoUri = store.get('mongoUri') || 'mongodb://localhost:27017/reactory';
      log.info(`Using external MongoDB at ${mongoUri}`);
    }

    // ── Step 2: Environment ──
    splash.webContents.send('splash:status', 'Preparing environment…');
    const apiPort = store.get('apiPort');
    const serverPath = getResourcePath('server');
    const env = resolveEnv({
      mongoUri,
      apiPort,
      dataRoot: getResourcePath('reactory-data'),
      clientBuildPath: getResourcePath('client'),
      isPackaged: app.isPackaged,
      serverPath,
    });

    // ── Step 3: Start Express Server ──
    splash.webContents.send('splash:status', 'Starting server…');
    serverManager = new ReactoryServerManager({
      serverPath,
      env,
    });
    await serverManager.start();
    log.info(`Reactory Server running on port ${apiPort}`);

    // ── Step 4: Create main window ──
    splash.webContents.send('splash:status', 'Loading application…');
    mainWindow = createMainWindow(apiPort);

    // ── Step 5: System tray + auto-update ──
    createTray(mainWindow, apiPort);
    if (app.isPackaged) {
      setupAutoUpdater(mainWindow);
    }

    log.info('Boot sequence complete ✅');

  } catch (err: any) {
    log.error('Boot failed:', err);
    closeSplash();
    dialog.showErrorBox(
      'Reactory Desktop — Startup Error',
      `The application failed to start.\n\n${err.message}\n\nCheck the logs at:\n${log.transports.file.getFile().path}`
    );
    app.quit();
  }
}

// ── App Lifecycle ──────────────────────────────────────────

app.whenReady().then(boot);

app.on('activate', () => {
  // macOS: re-create window when dock icon is clicked
  if (BrowserWindow.getAllWindows().length === 0 && serverManager?.isRunning()) {
    const port = store.get('apiPort');
    mainWindow = createMainWindow(port);
  }
});

app.on('window-all-closed', () => {
  // On macOS, keep app running even with no windows
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', async (event) => {
  log.info('Shutting down…');

  // Stop Express server
  if (serverManager?.isRunning()) {
    try {
      await serverManager.stop();
      log.info('Express server stopped');
    } catch (err) {
      log.error('Error stopping server:', err);
    }
  }

  // Stop embedded MongoDB
  if (mongoManager?.isRunning()) {
    try {
      await mongoManager.stop();
      log.info('MongoDB stopped');
    } catch (err) {
      log.error('Error stopping MongoDB:', err);
    }
  }
});

// ── IPC Handlers ───────────────────────────────────────────

ipcMain.handle('app:getVersion', () => app.getVersion());
ipcMain.handle('app:getPort', () => store.get('apiPort'));
ipcMain.handle('app:getMongoUri', () => {
  return store.get('useEmbeddedMongo')
    ? 'embedded'
    : store.get('mongoUri');
});
ipcMain.handle('app:getLogs', () => {
  return log.transports.file.getFile().path;
});
