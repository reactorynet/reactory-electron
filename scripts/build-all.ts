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

for (const [name, dir] of [['Server', REACTORY_SERVER], ['Client', REACTORY_CLIENT], ['Data', REACTORY_DATA]]) {
  if (!fs.existsSync(dir)) {
    console.error(`\n❌ ${name} not found at ${dir}`);
    console.error(`   Set REACTORY_${name.toUpperCase()} env variable to the correct path.`);
    process.exit(1);
  }
}

// ── Step 1: Build Electron main process ──
run(
  'Step 1/4: Build Electron main process',
  'yarn build:main'
);

// ── Step 2: Build Express server ──
run(
  'Step 2/4: Compile Express server',
  `REACTORY_SERVER="${REACTORY_SERVER}" bash scripts/build-server.sh`
);

// ── Step 3: Build PWA client ──
run(
  'Step 3/4: Build PWA client',
  `REACTORY_CLIENT="${REACTORY_CLIENT}" bash scripts/build-client.sh`
);

// ── Step 4: Bundle reactory-data ──
run(
  'Step 4/4: Bundle reactory-data',
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
console.log('');
