/**
 * Reactory Desktop — Splash Screen
 *
 * Shows a small loading window during the boot sequence.
 * Displays status messages sent via IPC from the main process.
 */
import { BrowserWindow } from 'electron';
import path from 'path';

let splashWindow: BrowserWindow | null = null;

/**
 * Create and show the splash screen.
 */
export function createSplashWindow(): BrowserWindow {
  splashWindow = new BrowserWindow({
    width: 420,
    height: 320,
    frame: false,
    transparent: false,
    resizable: false,
    center: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    backgroundColor: '#1a1a2e',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'splash-preload.js'),
    },
    show: false,
  });

  // Load inline HTML for the splash screen
  splashWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(SPLASH_HTML)}`);

  splashWindow.once('ready-to-show', () => {
    splashWindow?.show();
  });

  return splashWindow;
}

/**
 * Close the splash screen.
 */
export function closeSplash(): void {
  if (splashWindow && !splashWindow.isDestroyed()) {
    splashWindow.close();
    splashWindow = null;
  }
}

// ── Inline splash HTML ─────────────────────────────────────
const SPLASH_HTML = `<!DOCTYPE html>
<html>
<head>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    background: linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%);
    color: #e0e0e0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100vh;
    -webkit-app-region: drag;
    user-select: none;
    overflow: hidden;
  }
  .logo {
    font-size: 42px;
    font-weight: 700;
    color: #f95e20;
    margin-bottom: 8px;
    letter-spacing: -1px;
  }
  .subtitle {
    font-size: 13px;
    color: #8899aa;
    margin-bottom: 40px;
  }
  .spinner {
    width: 36px;
    height: 36px;
    border: 3px solid rgba(249, 94, 32, 0.2);
    border-top-color: #f95e20;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
    margin-bottom: 20px;
  }
  @keyframes spin {
    to { transform: rotate(360deg); }
  }
  #status {
    font-size: 12px;
    color: #7788aa;
    min-height: 18px;
    transition: opacity 0.3s;
  }
  .version {
    position: absolute;
    bottom: 12px;
    right: 16px;
    font-size: 10px;
    color: #445566;
  }
</style>
</head>
<body>
  <div class="logo">Reactory</div>
  <div class="subtitle">Desktop Edition</div>
  <div class="spinner"></div>
  <div id="status">Initializing…</div>
  <div class="version">v1.0.0</div>
  <script>
    const { ipcRenderer } = require('electron');
    if (typeof window.electronAPI !== 'undefined') {
      window.electronAPI.onStatus((msg) => {
        document.getElementById('status').textContent = msg;
      });
    }
    // Fallback: listen directly if preload is available
    try {
      const electron = require('electron');
      electron.ipcRenderer.on('splash:status', (_, msg) => {
        document.getElementById('status').textContent = msg;
      });
    } catch(e) {}
  </script>
</body>
</html>`;
