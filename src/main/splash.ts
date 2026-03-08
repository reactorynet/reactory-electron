/**
 * Reactory Desktop — Splash Screen
 *
 * Shows a small loading window during the boot sequence.
 * Displays status messages sent via IPC from the main process.
 * Accepts a ResolvedTheme to render branded colors, logo, and app name.
 */
import { BrowserWindow } from 'electron';
import path from 'path';
import type { ResolvedTheme } from './theme';

let splashWindow: BrowserWindow | null = null;

export interface SplashOptions {
  theme?: ResolvedTheme;
}

/**
 * Create and show the splash screen.
 */
export function createSplashWindow(opts?: SplashOptions): BrowserWindow {
  const theme = opts?.theme;
  const bgColor = theme?.colors.background ?? '#1a1a2e';

  splashWindow = new BrowserWindow({
    width: 420,
    height: 320,
    frame: false,
    transparent: false,
    resizable: false,
    center: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    backgroundColor: bgColor,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'splash-preload.js'),
    },
    show: false,
  });

  const html = buildSplashHtml(theme);
  splashWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);

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

// ── Dynamic splash HTML builder ────────────────────────────

/**
 * Generates the splash screen HTML with theme-aware colors, logo, and app name.
 */
function buildSplashHtml(theme?: ResolvedTheme): string {
  const primary = theme?.colors.primary ?? '#f95e20';
  const bg = theme?.colors.background ?? '#1a1a2e';
  const textColor = theme?.colors.textColor ?? '#e0e0e0';
  const mutedColor = theme?.colors.mutedColor ?? '#7788aa';
  const appName = theme?.appName ?? 'Reactory';
  const subtitle = theme?.subtitle ?? 'Desktop Edition';
  const logoDataUri = theme?.logoDataUri;

  // Derive a slightly lighter shade of the background for the gradient
  const bgLighter = adjustBrightness(bg, 20);
  const bgLightest = adjustBrightness(bg, 40);

  // Spinner border uses the primary color at 20% opacity
  const spinnerBorderFaint = hexToRgba(primary, 0.2);

  const logoHtml = logoDataUri
    ? `<img class="logo-img" src="${logoDataUri}" alt="${appName}" />`
    : `<div class="logo-text">${escapeHtml(appName)}</div>`;

  return `<!DOCTYPE html>
<html>
<head>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    background: linear-gradient(135deg, ${bg} 0%, ${bgLighter} 50%, ${bgLightest} 100%);
    color: ${textColor};
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100vh;
    -webkit-app-region: drag;
    user-select: none;
    overflow: hidden;
  }
  .logo-img {
    width: 80px;
    height: 80px;
    object-fit: contain;
    margin-bottom: 12px;
  }
  .logo-text {
    font-size: 42px;
    font-weight: 700;
    color: ${primary};
    margin-bottom: 8px;
    letter-spacing: -1px;
  }
  .app-name {
    font-size: 18px;
    font-weight: 600;
    color: ${textColor};
    margin-bottom: 4px;
  }
  .subtitle {
    font-size: 13px;
    color: ${mutedColor};
    margin-bottom: 40px;
  }
  .spinner {
    width: 36px;
    height: 36px;
    border: 3px solid ${spinnerBorderFaint};
    border-top-color: ${primary};
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
    margin-bottom: 20px;
  }
  @keyframes spin {
    to { transform: rotate(360deg); }
  }
  #status {
    font-size: 12px;
    color: ${mutedColor};
    min-height: 18px;
    transition: opacity 0.3s;
  }
  .version {
    position: absolute;
    bottom: 12px;
    right: 16px;
    font-size: 10px;
    color: ${mutedColor};
    opacity: 0.6;
  }
</style>
</head>
<body>
  ${logoHtml}
  ${logoDataUri ? `<div class="app-name">${escapeHtml(appName)}</div>` : ''}
  <div class="subtitle">${escapeHtml(subtitle)}</div>
  <div class="spinner"></div>
  <div id="status">Initializing\u2026</div>
  <div class="version">v1.0.0</div>
  <script>
    if (typeof window.electronAPI !== 'undefined') {
      window.electronAPI.onStatus((msg) => {
        document.getElementById('status').textContent = msg;
      });
    }
    try {
      const electron = require('electron');
      electron.ipcRenderer.on('splash:status', (_, msg) => {
        document.getElementById('status').textContent = msg;
      });
    } catch(e) {}
  </script>
</body>
</html>`;
}

// ── Color utility helpers ──────────────────────────────────

function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace('#', '');
  const r = parseInt(h.substring(0, 2), 16) || 0;
  const g = parseInt(h.substring(2, 4), 16) || 0;
  const b = parseInt(h.substring(4, 6), 16) || 0;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function adjustBrightness(hex: string, amount: number): string {
  const h = hex.replace('#', '');
  const r = Math.min(255, Math.max(0, (parseInt(h.substring(0, 2), 16) || 0) + amount));
  const g = Math.min(255, Math.max(0, (parseInt(h.substring(2, 4), 16) || 0) + amount));
  const b = Math.min(255, Math.max(0, (parseInt(h.substring(4, 6), 16) || 0) + amount));
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
