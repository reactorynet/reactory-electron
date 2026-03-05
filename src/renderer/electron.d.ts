/**
 * Reactory Desktop — TypeScript declaration for the renderer preload API.
 *
 * The PWA client can use `window.reactoryDesktop` to detect Electron
 * and access desktop-specific features.
 */

interface ReactoryDesktopAPI {
  /** Whether the app is running inside Electron */
  isElectron: boolean;
  /** Get the Electron app version */
  getVersion(): Promise<string>;
  /** Get the port the API server is running on */
  getPort(): Promise<number>;
  /** Get MongoDB connection info (returns 'embedded' or the URI) */
  getMongoUri(): Promise<string>;
  /** Get the log file path */
  getLogPath(): Promise<string>;
  /** Listen for auto-update events */
  onUpdateAvailable(callback: (info: { version: string; releaseDate: string }) => void): void;
  onUpdateDownloaded(callback: (info: { version: string; releaseDate: string }) => void): void;
  /** Trigger update install and restart */
  installUpdate(): void;
}

declare global {
  interface Window {
    reactoryDesktop?: ReactoryDesktopAPI;
  }
}

export {};
