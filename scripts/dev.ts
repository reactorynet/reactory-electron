/**
 * Reactory Desktop — Development Script
 *
 * Starts the Electron app in development mode:
 *   - Builds the main process with tsup in watch mode
 *   - Uses the live Express server (babel-node) from reactory-express-server
 *   - Uses the live PWA client dev server from reactory-pwa-client
 *
 * In dev mode, the Electron window points at http://localhost:3000
 * (the PWA dev server) instead of serving static files. The Express
 * server must be started separately via its bin/start.sh.
 *
 * Usage:
 *   tsx scripts/dev.ts
 */
import { execSync, spawn, ChildProcess } from 'child_process';
import path from 'path';
import fs from 'fs';

const ROOT = path.resolve(__dirname, '..');

console.log('🔧 Reactory Desktop — Development Mode');
console.log('');
console.log('This will build and launch Electron in dev mode.');
console.log('Make sure the Express server and PWA client are running:');
console.log('  Server: cd ../reactory-express-server && bin/start.sh reactory local');
console.log('  Client: cd ../reactory-pwa-client && bin/start.sh reactory local');
console.log('');

// Build main process
console.log('Building main process…');
execSync('yarn build:main', {
  cwd: ROOT,
  stdio: 'inherit',
});

// Set dev environment variables
const devEnv = {
  ...process.env,
  NODE_ENV: 'development',
  REACTORY_ELECTRON_DEV: 'true',
  // In dev mode, point at the running dev servers
  REACTORY_DEV_API_PORT: '4000',
  REACTORY_DEV_CLIENT_URL: 'http://localhost:3000',
};

// Launch Electron
console.log('');
console.log('🚀 Launching Electron…');
const electron = spawn('npx', ['electron', 'dist/main/index.js'], {
  cwd: ROOT,
  env: devEnv,
  stdio: 'inherit',
});

electron.on('exit', (code) => {
  console.log(`Electron exited with code ${code}`);
  process.exit(code ?? 0);
});
