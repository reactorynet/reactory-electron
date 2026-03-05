/**
 * Reactory Desktop — Preload Script
 *
 * Exposes a safe, limited API from the main process to the renderer
 * via contextBridge. The PWA client can optionally use these APIs
 * to detect it's running inside Electron and access desktop features.
 */
import { contextBridge, ipcRenderer } from 'electron';

/**
 * The API exposed to the renderer process at `window.reactoryDesktop`.
 */
const reactoryDesktopAPI = {
  /** Whether the app is running inside Electron */
  isElectron: true,

  /** Get the Electron app version */
  getVersion: (): Promise<string> => ipcRenderer.invoke('app:getVersion'),

  /** Get the port the API server is running on */
  getPort: (): Promise<number> => ipcRenderer.invoke('app:getPort'),

  /** Get MongoDB connection info (returns 'embedded' or the URI) */
  getMongoUri: (): Promise<string> => ipcRenderer.invoke('app:getMongoUri'),

  /** Get the log file path */
  getLogPath: (): Promise<string> => ipcRenderer.invoke('app:getLogs'),

  /** Listen for auto-update events */
  onUpdateAvailable: (callback: (info: any) => void) => {
    ipcRenderer.on('update:available', (_event, info) => callback(info));
  },

  onUpdateDownloaded: (callback: (info: any) => void) => {
    ipcRenderer.on('update:downloaded', (_event, info) => callback(info));
  },

  /** Trigger update install and restart */
  installUpdate: () => ipcRenderer.send('update:install'),
};

// Expose under window.reactoryDesktop
contextBridge.exposeInMainWorld('reactoryDesktop', reactoryDesktopAPI);

// Type declaration for use in the renderer
export type ReactoryDesktopAPI = typeof reactoryDesktopAPI;
