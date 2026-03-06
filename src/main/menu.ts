/**
 * Reactory Desktop — Application Menu
 *
 * Provides a native menu bar with a View > Toggle Developer Tools item
 * so you can always inspect the PWA running inside the Electron window.
 */
import { app, Menu, MenuItemConstructorOptions, BrowserWindow, shell } from 'electron';

/**
 * Build and set the native application menu.
 * @param isDev - Pass true to show extra developer options.
 */
export function buildMenu(isDev: boolean): void {
  const isMac = process.platform === 'darwin';

  const viewMenu: MenuItemConstructorOptions = {
    label: 'View',
    submenu: [
      { role: 'reload' },
      { role: 'forceReload' },
      {
        label: 'Toggle Developer Tools',
        accelerator: isMac ? 'Cmd+Alt+I' : 'Ctrl+Shift+I',
        click: () => {
          const win = BrowserWindow.getFocusedWindow();
          if (win) {
            win.webContents.toggleDevTools();
          }
        },
      },
      { type: 'separator' },
      { role: 'resetZoom' },
      { role: 'zoomIn' },
      { role: 'zoomOut' },
      { type: 'separator' },
      { role: 'togglefullscreen' },
    ],
  };

  const helpMenu: MenuItemConstructorOptions = {
    role: 'help',
    submenu: [
      {
        label: 'View Logs',
        click: () => {
          const logPath = require('electron-log/main').transports.file.getFile().path;
          shell.showItemInFolder(logPath);
        },
      },
      {
        label: 'Open User Data Directory',
        click: () => {
          shell.openPath(app.getPath('userData'));
        },
      },
      { type: 'separator' },
      {
        label: 'API Explorer (GraphiQL)',
        click: () => {
          shell.openExternal('http://localhost:4000/graphiql');
        },
      },
    ],
  };

  const template: MenuItemConstructorOptions[] = [
    // macOS app menu
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { role: 'about' as const },
              { type: 'separator' as const },
              { role: 'services' as const },
              { type: 'separator' as const },
              { role: 'hide' as const },
              { role: 'hideOthers' as const },
              { role: 'unhide' as const },
              { type: 'separator' as const },
              { role: 'quit' as const },
            ],
          },
        ]
      : []),

    {
      label: 'File',
      submenu: [isMac ? { role: 'close' as const } : { role: 'quit' as const }],
    },

    {
      label: 'Edit',
      submenu: [
        { role: 'undo' as const },
        { role: 'redo' as const },
        { type: 'separator' as const },
        { role: 'cut' as const },
        { role: 'copy' as const },
        { role: 'paste' as const },
        ...(isMac
          ? [
              { role: 'pasteAndMatchStyle' as const },
              { role: 'delete' as const },
              { role: 'selectAll' as const },
            ]
          : [
              { role: 'delete' as const },
              { type: 'separator' as const },
              { role: 'selectAll' as const },
            ]),
      ],
    },

    viewMenu,
    helpMenu,
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
