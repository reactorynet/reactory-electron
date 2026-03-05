/**
 * Reactory Desktop — Splash Preload Script
 *
 * Minimal preload for the splash window to receive status updates.
 */
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  onStatus: (callback: (message: string) => void) => {
    ipcRenderer.on('splash:status', (_event, message) => callback(message));
  },
});
