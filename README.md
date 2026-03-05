# Reactory Desktop (Electron)

Self-contained Electron wrapper that ships the entire Reactory platform as a desktop application.

## Architecture

```
┌─────────────────────────────────────────────┐
│              Electron Shell                  │
│  ┌────────────────────────────────────────┐  │
│  │          Main Process                  │  │
│  │  ┌──────────┐  ┌───────────────────┐   │  │
│  │  │ MongoDB  │  │  Express Server   │   │  │
│  │  │ (mongod) │  │  (port 4000)      │   │  │
│  │  │  :27018  │  │  ┌─────────────┐  │   │  │
│  │  └──────────┘  │  │  API Routes │  │   │  │
│  │                │  │  CDN/Static │  │   │  │
│  │                │  │  GraphQL    │  │   │  │
│  │                │  │  Auth       │  │   │  │
│  │                │  └─────────────┘  │   │  │
│  │                │  ┌─────────────┐  │   │  │
│  │                │  │ PWA Client  │  │   │  │
│  │                │  │ (static)    │  │   │  │
│  │                │  └─────────────┘  │   │  │
│  │                └───────────────────┘   │  │
│  └────────────────────────────────────────┘  │
│  ┌────────────────────────────────────────┐  │
│  │       Renderer (BrowserWindow)         │  │
│  │       → http://localhost:4000          │  │
│  └────────────────────────────────────────┘  │
└─────────────────────────────────────────────┘
```

## Boot Sequence

1. **Splash screen** — shown immediately
2. **MongoDB** — embedded `mongod` starts on port 27018 (data in `~/Library/Application Support/Reactory Desktop/mongodb-data/`)
3. **Express server** — starts on port 4000, serves API + pre-built PWA client
4. **BrowserWindow** — opens `http://localhost:4000`
5. **Splash closes**, main window shown

## Prerequisites

- **Node.js** 20+ (see reactory-core `.nvmrc`)
- **Yarn** package manager
- All sibling Reactory projects checked out:
  ```
  reactory/
  ├── reactory-core/
  ├── reactory-express-server/
  ├── reactory-pwa-client/
  ├── reactory-data/
  └── reactory-electron/          ← this project
  ```

## Quick Start

```bash
# Install dependencies
yarn install

# Development mode (requires running server + client separately)
yarn dev

# Full production build
yarn build

# Launch the built app
yarn start

# Package for distribution
yarn dist:mac    # macOS DMG
yarn dist:win    # Windows NSIS installer
yarn dist:linux  # Linux AppImage
```

## Development Mode

In dev mode, Electron opens the live development servers:

```bash
# Terminal 1 — Start the Express server
cd ../reactory-express-server
bin/start.sh reactory local

# Terminal 2 — Start the PWA client dev server
cd ../reactory-pwa-client
bin/start.sh reactory local

# Terminal 3 — Launch Electron pointing at dev servers
cd ../reactory-electron
yarn dev
```

## Production Build

The full build pipeline compiles everything into a self-contained bundle:

```bash
yarn build              # Build all components
yarn build --pack       # Build + package as distributable
yarn build --all-fonts  # Include all 370MB of fonts
```

### Build Steps

| Step | Script | Output |
|------|--------|--------|
| Electron main process | `yarn build:main` | `dist/main/` |
| Express server (Babel) | `yarn build:server` | `build/server/` |
| PWA client (Webpack) | `yarn build:client` | `build/client/` |
| Data bundle | `yarn build:data` | `build/reactory-data/` |

## Project Structure

```
reactory-electron/
├── src/
│   ├── main/
│   │   ├── index.ts          # Electron main process entry
│   │   ├── server.ts         # Express server lifecycle manager
│   │   ├── mongodb.ts        # Embedded MongoDB lifecycle manager
│   │   ├── env.ts            # Environment variable resolver
│   │   ├── preload.ts        # Renderer preload (window.reactoryDesktop)
│   │   ├── splash.ts         # Splash screen during boot
│   │   ├── splash-preload.ts # Splash window preload
│   │   ├── tray.ts           # System tray icon + menu
│   │   ├── updater.ts        # Auto-update via electron-updater
│   │   └── patches/          # Server integration patches (docs)
│   └── renderer/
│       └── electron.d.ts     # TypeScript types for window.reactoryDesktop
├── config/
│   └── env/reactory/
│       └── .env.electron     # Client build environment
├── scripts/
│   ├── build-all.ts          # Master build orchestrator
│   ├── build-server.sh       # Compile Express server
│   ├── build-client.sh       # Build PWA client
│   ├── bundle-data.sh        # Assemble minimal reactory-data
│   └── dev.ts                # Development launcher
├── resources/
│   └── entitlements.mac.plist
├── electron-builder.yml      # Packaging configuration
├── tsup.config.ts            # Main process bundler config
├── tsconfig.json
└── package.json
```

## MongoDB Strategy

| Mode | When | Data Persistence |
|------|------|-----------------|
| **Embedded** (default) | Packaged app ships `mongod` binary | `~/Library/Application Support/Reactory Desktop/mongodb-data/` |
| **Development** | No bundled `mongod` found | Uses `mongodb-memory-server-core` (auto-downloads) |
| **External** | User sets `useEmbeddedMongo: false` | Connects to user-provided URI |

## Required Server Patches

Before the Express server can run cleanly inside Electron, these changes are needed in `reactory-express-server/src/express/server.ts`:

1. **Remove `process.exit()`** calls — guard with `if (process.env.REACTORY_RUNTIME !== 'electron')`
2. **Add static client serving** — when `REACTORY_RUNTIME === 'electron'`, serve the pre-built PWA client from Express
3. **IPC ready signal** — send `process.send('ready')` after successful startup

See [src/main/patches/](src/main/patches/) for detailed instructions.

## Packaging for Distribution

### MongoDB Binary

You need platform-specific `mongod` binaries in `resources/mongodb/`:

```
resources/mongodb/
├── mac/
│   ├── x64/mongod
│   └── arm64/mongod
├── win/
│   └── x64/mongod.exe
└── linux/
    └── x64/mongod
```

Download from [MongoDB Community Server](https://www.mongodb.com/try/download/community).

### Code Signing

- **macOS**: Set `CSC_LINK` and `CSC_KEY_PASSWORD` env vars (or use Keychain)
- **Windows**: Set `CSC_LINK` for EV code signing certificate

### Auto-Update

Configure the `publish` section in `electron-builder.yml` with your update server URL.

## Environment Variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `REACTORY_SERVER` | `../reactory-express-server` | Path to Express server |
| `REACTORY_CLIENT` | `../reactory-pwa-client` | Path to PWA client |
| `REACTORY_DATA` | `../reactory-data` | Path to data directory |

## Estimated Bundle Sizes

| Component | Size |
|-----------|------|
| Electron + Chromium | ~180 MB |
| `mongod` binary | ~100 MB |
| Express server (compiled) | ~50 MB (with node_modules) |
| PWA client build | ~15 MB |
| reactory-data (minimal) | ~5 MB |
| reactory-data (with all fonts) | ~375 MB |
| **Total (minimal)** | **~350 MB** |
| **Total (with fonts)** | **~720 MB** |

## License

MIT — See [LICENSE](LICENSE) for details.
