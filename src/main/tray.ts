/**
 * Reactory Desktop — System Tray
 *
 * Provides a system tray icon with quick access to:
 *   - Show/hide the main window
 *   - Open the API in a browser
 *   - Check for updates
 *   - View logs
 *   - Quit the app
 */
import { Tray, Menu, BrowserWindow, shell, nativeImage, app } from 'electron';
import path from 'path';
import log from 'electron-log/main';

let tray: Tray | null = null;

export function createTray(mainWindow: BrowserWindow, apiPort: number): Tray {
  // Use a template image on macOS for proper dark/light mode support
  const iconPath = app.isPackaged
    ? path.join(process.resourcesPath, 'icon.png')
    : path.join(__dirname, '..', '..', 'resources', 'icon.png');

  // Create a small icon — on macOS use a 16x16 template
  let icon: nativeImage;
  try {
    icon = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 });
    if (process.platform === 'darwin') {
      icon.setTemplateImage(true);
    }
  } catch {
    // Fallback to empty icon if resource not found
    icon = nativeImage.createEmpty();
  }

  tray = new Tray(icon);
  tray.setToolTip('Reactory Desktop');

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Show Reactory',
      click: () => {
        mainWindow.show();
        mainWindow.focus();
      },
    },
    { type: 'separator' },
    {
      label: `API: http://localhost:${apiPort}`,
      enabled: false,
    },
    {
      label: 'Open API in Browser',
      click: () => {
        shell.openExternal(`http://localhost:${apiPort}/api`);
      },
    },
    { type: 'separator' },
    {
      label: 'View Logs',
      click: () => {
        const logPath = log.transports.file.getFile().path;
        shell.showItemInFolder(logPath);
      },
    },
    {
      label: 'Open Data Directory',
      click: () => {
        shell.openPath(app.getPath('userData'));
      },
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        app.quit();
      },
    },
  ]);

  tray.setContextMenu(contextMenu);

  tray.on('click', () => {
    if (mainWindow.isVisible()) {
      mainWindow.focus();
    } else {
      mainWindow.show();
    }
  });

  return tray;
}
