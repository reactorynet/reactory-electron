/**
 * Reactory Desktop — Master Build Script
 *
 * Orchestrates the full build pipeline:
 *   1. Build the Electron main process (tsup)
 *   2. Compile the Express server (babel)
 *   3. Build the PWA client (webpack)
 *   4. Bundle reactory-data assets
 *   5. (Optional) Package with electron-builder
 *
 * Usage:
 *   tsx scripts/build-all.ts [--pack] [--all-fonts]
 */
import { execSync } from 'child_process';
import path from 'path';
import fs from 'fs';

const ROOT = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const shouldPack = args.includes('--pack');
const allFonts = args.includes('--all-fonts');

// Configuration keys — server and client can have different build targets.
// When --config is provided alone, it sets both. Use --server-config and
// --client-config for independent control.
const sharedConfig = getArgValue('--config') || process.env.REACTORY_CONFIG_ID || 'reactory';
const serverConfigId = getArgValue('--server-config') || process.env.REACTORY_SERVER_CONFIG_ID || sharedConfig;
const clientConfigId = getArgValue('--client-config') || process.env.REACTORY_CLIENT_CONFIG_ID || sharedConfig;
const themeId = getArgValue('--theme') || process.env.REACTORY_THEME_ID || clientConfigId;

function getArgValue(flag: string): string | undefined {
  const idx = args.indexOf(flag);
  return idx >= 0 && idx + 1 < args.length ? args[idx + 1] : undefined;
}

function run(label: string, command: string, cwd = ROOT): void {
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  ${label}`);
  console.log(`${'═'.repeat(60)}\n`);

  try {
    execSync(command, { cwd, stdio: 'inherit', env: process.env });
  } catch (err: any) {
    console.error(`\n❌ ${label} FAILED`);
    process.exit(1);
  }
}

function heading(text: string): void {
  console.log(`\n${'█'.repeat(60)}`);
  console.log(`█  ${text}`);
  console.log(`${'█'.repeat(60)}`);
}

// ── Validate environment ──
heading('Reactory Desktop — Full Build');

const REACTORY_SERVER = process.env.REACTORY_SERVER
  || path.resolve(ROOT, '..', 'reactory-express-server');
const REACTORY_CLIENT = process.env.REACTORY_CLIENT
  || path.resolve(ROOT, '..', 'reactory-pwa-client');
const REACTORY_DATA = process.env.REACTORY_DATA
  || path.resolve(ROOT, '..', 'reactory-data');

console.log(`  Server: ${REACTORY_SERVER}`);
console.log(`  Client: ${REACTORY_CLIENT}`);
console.log(`  Data:   ${REACTORY_DATA}`);
console.log(`  Server config: ${serverConfigId}`);
console.log(`  Client config: ${clientConfigId}`);
console.log(`  Theme:  ${themeId}`);

for (const [name, dir] of [['Server', REACTORY_SERVER], ['Client', REACTORY_CLIENT], ['Data', REACTORY_DATA]]) {
  if (!fs.existsSync(dir)) {
    console.error(`\n❌ ${name} not found at ${dir}`);
    console.error(`   Set REACTORY_${name.toUpperCase()} env variable to the correct path.`);
    process.exit(1);
  }
}

// ── Step 1: Build Electron main process ──
run(
  'Step 1/5: Build Electron main process',
  'yarn build:main'
);

// ── Step 2: Prepare theme assets ──
run(
  'Step 2/5: Prepare theme assets',
  `REACTORY_DATA="${REACTORY_DATA}" REACTORY_CLIENT="${REACTORY_CLIENT}" bash scripts/prepare-theme.sh "${themeId}" "${clientConfigId}"`
);

// ── Step 3: Compile Express server ──
run(
  'Step 3/5: Compile Express server',
  `REACTORY_SERVER="${REACTORY_SERVER}" REACTORY_CONFIG_ID="${serverConfigId}" bash scripts/build-server.sh`
);

// ── Step 4: Build PWA client ──
run(
  'Step 4/5: Build PWA client',
  `REACTORY_CLIENT="${REACTORY_CLIENT}" REACTORY_CONFIG_ID="${clientConfigId}" REACTORY_THEME_ID="${themeId}" bash scripts/build-client.sh`
);

// ── Step 5: Bundle reactory-data ──
run(
  'Step 5/5: Bundle reactory-data',
  `REACTORY_DATA="${REACTORY_DATA}" bash scripts/bundle-data.sh${allFonts ? ' --all-fonts' : ''}`
);

// ── Optional: Package ──
if (shouldPack) {
  heading('Packaging with electron-builder');
  run('electron-builder', 'yarn dist');
}

// ── Done ──
heading('Build Complete ✅');

const buildDir = path.join(ROOT, 'build');
if (fs.existsSync(buildDir)) {
  const { execSync: exec } = require('child_process');
  const size = exec(`du -sh "${buildDir}"`, { encoding: 'utf-8' }).trim();
  console.log(`\n  Total build size: ${size.split('\t')[0]}`);
}

console.log(`\n  Next steps:`);
console.log(`    yarn start          — Launch the app`);
console.log(`    yarn pack           — Create unpacked build`);
console.log(`    yarn dist           — Create distributable`);
console.log(`    yarn dist:mac       — Create macOS DMG`);
console.log(`    yarn dist:win       — Create Windows installer`);
console.log(`    yarn dist:linux     — Create Linux AppImage`);
console.log(`\n  Configuration:`);
console.log(`    Server config: ${serverConfigId}`);
console.log(`    Client config: ${clientConfigId}`);
console.log(`    Theme:  ${themeId}`);
console.log(`\n  Build with a different config:`);
console.log(`    yarn build --config booktutor --theme booktutor`);
console.log('');
