#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────
# build-server.sh — Compile the Reactory Express Server for Electron
#
# Pipeline:
#   1. Run the code generator (module index + client configs)
#   2. Compile TypeScript to JavaScript with Babel into build/server/app
#   3. Copy essential non-JS assets (raw TS/TSX form widgets, YAML, JSON, …)
#   4. Resolve '@reactory/...' path aliases in app/
#   5. Bundle bin/run.sh + shell utils + per-config env files
#   6. Install production dependencies (server + module-scoped deps)
#   7. Write the Electron entry points
#
# Layout produced (mirrors the standard server build):
#
#   build/server/
#   ├── .env                  # baseline env for standalone bin/run.sh runs
#   ├── app/                  # compiled server code (the app root)
#   │   ├── index.js          # Electron entry (IPC aware)
#   │   ├── express/
#   │   ├── modules/          # includes enabled-<config>.json
#   │   └── ...
#   ├── bin/run.sh            # runtime launcher (--bun)
#   ├── config/<config>/      # .env.local etc. for Electron env resolution
#   ├── electron-entry.js     # shim → ./app/index.js (used by the Node fork)
#   ├── lib/
#   ├── node_modules/
#   └── package.json
#
# Three non-obvious requirements are encoded below; each caused a real
# startup failure when violated:
#
#   * Compiled output MUST be nested under app/. The server resolves its
#     enabled-module manifest from `<cwd>/app/modules` (or `<cwd>/src/modules`),
#     so a flattened layout fails with "The module specification file () does
#     not exist".
#   * No `node_modules` may exist underneath app/. Bun stops at the nearest
#     node_modules and does not continue walking up, so a partial/incomplete
#     copy inside a module directory shadows the real one and produces
#     "Cannot find module ...". All app-side deps resolve from build/server.
#   * Module-scoped dependencies must be folded into the install manifest.
#     The server root declares `workspaces: ["src/modules/*"]`; this build ships
#     a standalone manifest, so those deps (e.g. @modelcontextprotocol/sdk)
#     must be listed explicitly.
# ──────────────────────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
BUILD_DIR="$PROJECT_DIR/build/server"
APP_OUT="$BUILD_DIR/app"

# Resolve the Express server path
REACTORY_SERVER="${REACTORY_SERVER:-$(dirname "$PROJECT_DIR")/reactory-express-server}"
REACTORY_CONFIG_ID="${REACTORY_CONFIG_ID:-reactory}"
REACTORY_ENV_ID="${REACTORY_ENV_ID:-local}"

if [ ! -d "$REACTORY_SERVER" ]; then
  echo "❌ ERROR: Reactory Express Server not found at $REACTORY_SERVER"
  echo "   Set REACTORY_SERVER environment variable to the correct path."
  exit 1
fi

echo "══════════════════════════════════════════════════════════"
echo "  Building Reactory Express Server for Electron"
echo "  Config: $REACTORY_CONFIG_ID"
echo "  Env:    $REACTORY_ENV_ID"
echo "  Source: $REACTORY_SERVER"
echo "  Output: $BUILD_DIR"
echo "══════════════════════════════════════════════════════════"

# ── Helper: resolve '@reactory/...' path aliases ──
# Rewrites both compiled JS and the raw TS/TSX sources copied verbatim (form
# widgets are loaded at runtime). Bun prefers .ts over .js when both exist, so
# an unrewritten raw .ts file would be selected ahead of its compiled sibling.
resolve_module_aliases() {
  local root="$1"
  cd "$root"

  find . -type f \( -name "*.js" -o -name "*.ts" -o -name "*.tsx" -o -name "*.jsx" \) \
    -not -path "./node_modules/*" | while read -r file; do
    local dir ext rel
    dir=$(dirname "$file")
    ext="${file##*.}"

    if grep -q "@reactory/server-core/" "$file" 2>/dev/null; then
      rel=$(python3 -c "import os.path; print(os.path.relpath('.', '$dir'))" 2>/dev/null || echo ".")
      sed -i '' "s|@reactory/server-core/|${rel}/|g" "$file" 2>/dev/null || \
      sed -i "s|@reactory/server-core/|${rel}/|g" "$file" 2>/dev/null || true
    fi

    if grep -q "@reactory/server-modules/" "$file" 2>/dev/null; then
      rel=$(python3 -c "import os.path; print(os.path.relpath('./modules', '$dir'))" 2>/dev/null || echo "./modules")
      sed -i '' "s|@reactory/server-modules/|${rel}/|g" "$file" 2>/dev/null || \
      sed -i "s|@reactory/server-modules/|${rel}/|g" "$file" 2>/dev/null || true
    fi

    # The bare 'modules/' and 'utils/' rewrites only apply to compiled JS;
    # raw TS/TSX may contain client-side imports where those are meaningful.
    if [ "$ext" = "js" ]; then
      if grep -q "['\"]modules/" "$file" 2>/dev/null; then
        rel=$(python3 -c "import os.path; print(os.path.relpath('./modules', '$dir'))" 2>/dev/null || echo "./modules")
        sed -i '' "s|['\"]modules/|'${rel}/|g" "$file" 2>/dev/null || \
        sed -i "s|['\"]modules/|'${rel}/|g" "$file" 2>/dev/null || true
      fi

      if grep -q "['\"]utils/" "$file" 2>/dev/null; then
        rel=$(python3 -c "import os.path; print(os.path.relpath('./utils', '$dir'))" 2>/dev/null || echo "./utils")
        sed -i '' "s|['\"]utils/|'${rel}/|g" "$file" 2>/dev/null || \
        sed -i "s|['\"]utils/|'${rel}/|g" "$file" 2>/dev/null || true
      fi
    fi
  done
}

# ── Step 1: Clean ──
echo ""
echo "🧹 Cleaning previous build…"
rm -rf "$BUILD_DIR"
mkdir -p "$BUILD_DIR" "$APP_OUT"

# ── Step 1b: Run code generation ──
echo ""
echo "⚙️  Running code generation (module index + client configs)…"
pushd "$REACTORY_SERVER" > /dev/null

if [ -f "bin/generate.sh" ]; then
  bash bin/generate.sh "$REACTORY_CONFIG_ID" "$REACTORY_ENV_ID" 2>/dev/null || {
    echo "⚠️  generate.sh failed — trying direct generation…"
    NODE_PATH=./src npx babel-node ./src/utils/code/index.ts \
      --presets @babel/env --extensions ".js,.ts" 2>/dev/null || true
  }
fi

popd > /dev/null

# ── Step 2: Compile TypeScript to JavaScript (into app/) ──
echo ""
echo "🔨 Compiling TypeScript with Babel…"
cd "$REACTORY_SERVER"

npx babel src \
  --out-dir "$APP_OUT" \
  --presets @babel/env \
  --extensions ".js,.ts,.tsx" \
  --copy-files \
  --no-copy-ignored \
  --ignore "**/__tests__/**,**/*.test.ts,**/*.spec.ts,**/node_modules/**" \
  2>&1 | tail -5

# ── Step 3: Copy essential non-JS files ──
# Every find prunes node_modules so that no partial dependency tree is
# recreated inside the app root (see the header note).
echo ""
echo "📦 Copying essential assets…"
cd "$REACTORY_SERVER"

cp package.json "$BUILD_DIR/"

# View templates (EJS / HBS)
find src -path "*/node_modules" -prune -o \( -name "*.ejs" -o -name "*.hbs" \) -print | while read -r tpl; do
  dest="$APP_OUT/${tpl#src/}"
  mkdir -p "$(dirname "$dest")"
  cp "$tpl" "$dest"
done

# GraphQL schema files
find src -path "*/node_modules" -prune -o \( -name "*.graphql" -o -name "*.gql" \) -print | while read -r gql; do
  dest="$APP_OUT/${gql#src/}"
  mkdir -p "$(dirname "$dest")"
  cp "$gql" "$dest"
done

# Proto files
find src -path "*/node_modules" -prune -o -name "*.proto" -print | while read -r proto; do
  dest="$APP_OUT/${proto#src/}"
  mkdir -p "$(dirname "$dest")"
  cp "$proto" "$dest"
done

# Raw form widget sources (.tsx / .jsx / .ts) loaded at runtime via fileAsString/ingest
find src/modules -path "*/node_modules" -prune -o -path "*/forms/*" -type f -print | while read -r formfile; do
  dest="$APP_OUT/${formfile#src/}"
  mkdir -p "$(dirname "$dest")"
  cp "$formfile" "$dest"
done

# YAML / YML / JSON definitions under src
find src -path "*/node_modules" -prune -o \( -name "*.yaml" -o -name "*.yml" -o -name "*.json" \) -print | while read -r yml; do
  dest="$APP_OUT/${yml#src/}"
  mkdir -p "$(dirname "$dest")"
  cp "$yml" "$dest"
done

# lib folder if present (local tarball dependencies)
if [ -d "lib" ]; then
  cp -R lib "$BUILD_DIR/"
  cp -R lib "$APP_OUT/"
fi

# Per-config environment files. Electron's dev-mode env resolver (src/main/env.ts)
# reads <serverPath>/config/<config>/.env.local, so the build must carry them.
if [ -d "$REACTORY_SERVER/config/$REACTORY_CONFIG_ID" ]; then
  mkdir -p "$BUILD_DIR/config/$REACTORY_CONFIG_ID"
  find "$REACTORY_SERVER/config/$REACTORY_CONFIG_ID" -maxdepth 1 -type f \
    \( -name ".env" -o -name ".env.*" \) \
    -exec cp {} "$BUILD_DIR/config/$REACTORY_CONFIG_ID/" \;
  echo "   config/$REACTORY_CONFIG_ID/ (.env files)"
fi

# ── Step 4: Resolve path aliases (AFTER all copies) ──
echo ""
echo "🔗 Resolving path aliases…"
resolve_module_aliases "$APP_OUT"

# Defensive: guarantee no dependency tree exists under app/ (see header note).
find "$APP_OUT" -name node_modules -type d -prune -exec rm -rf {} + 2>/dev/null || true

# ── Step 5: Bundle the runtime launcher ──
echo ""
echo "🛠  Bundling bin/run.sh + shell utils…"
mkdir -p "$BUILD_DIR/bin/shared"

if [ -f "$REACTORY_SERVER/bin/run.sh" ]; then
  cp "$REACTORY_SERVER/bin/run.sh" "$BUILD_DIR/bin/run.sh"
  chmod +x "$BUILD_DIR/bin/run.sh"
  echo "   bin/run.sh"
else
  echo "❌ ERROR: bin/run.sh not found in $REACTORY_SERVER"
  exit 1
fi

if [ -d "$REACTORY_SERVER/bin/shared" ]; then
  cp -R "$REACTORY_SERVER/bin/shared/." "$BUILD_DIR/bin/shared/"
  echo "   bin/shared/ (shell-utils.sh)"
fi

# run.sh resolves <root>/.env. Write a baseline so Bun's --env-file always has
# something to load when the app is launched standalone. Electron passes the
# authoritative environment explicitly; --env-file does not override existing
# variables, so these values never clobber the parent environment.
if [ ! -f "$BUILD_DIR/.env" ]; then
  cat > "$BUILD_DIR/.env" << 'ENVBASELINE'
# Baseline environment for standalone runs of bin/run.sh.
# The Electron main process supplies the real environment at runtime.
REACTORY_RUNTIME=electron
ENVBASELINE
  echo "   .env (baseline)"
fi

# ── Step 6: Install production dependencies ──
echo ""
echo "📥 Building dependency manifest…"
cd "$BUILD_DIR"

REACTORY_SERVER_FOR_BUILD="$REACTORY_SERVER" node -e "
  const fs = require('fs');
  const path = require('path');
  const serverRoot = process.env.REACTORY_SERVER_FOR_BUILD;
  const pkg = JSON.parse(fs.readFileSync(path.join(serverRoot, 'package.json'), 'utf-8'));
  const dependencies = Object.assign({}, pkg.dependencies || {});

  // Fold in module-scoped dependencies (server root uses workspaces).
  const modulesDir = path.join(serverRoot, 'src', 'modules');
  if (fs.existsSync(modulesDir)) {
    for (const entry of fs.readdirSync(modulesDir)) {
      const modPkgPath = path.join(modulesDir, entry, 'package.json');
      if (!fs.existsSync(modPkgPath)) continue;
      const modPkg = JSON.parse(fs.readFileSync(modPkgPath, 'utf-8'));
      for (const name of Object.keys(modPkg.dependencies || {})) {
        if (!dependencies[name]) dependencies[name] = modPkg.dependencies[name];
      }
    }
  }

  // The server pins zod to an exact 3.24.x, but @modelcontextprotocol/sdk
  // (required by reactory-reactor) declares 'zod: ^3.25 || ^4.0' as a
  // non-optional peer and imports the 'zod/v3' subpath, which only exists from
  // 3.25 onward. Widen the pin so a satisfying zod is installed; 3.25 is a
  // backward-compatible minor of the pinned major.
  if (dependencies.zod) dependencies.zod = '^3.25.76';
  if (dependencies['@modelcontextprotocol/sdk'] && !dependencies.zod) {
    dependencies.zod = '^3.25.76';
  }

  // sharp 0.32 builds a platform binary via node-gyp and its loader can then
  // look for the wrong architecture (observed: built darwin-arm64v8 but the
  // runtime requested darwin-x64). 0.33+ ships prebuilt N-API binaries as
  // @img/sharp-<platform> optional deps, which resolve correctly. The module
  // that needs sharp (reactory-kyc) only uses the stable high-level API.
  if (dependencies.sharp) dependencies.sharp = '^0.33.5';

  const trimmed = {
    name: pkg.name,
    version: pkg.version,
    dependencies: dependencies,
    resolutions: pkg.resolutions || {},
    packageManager: pkg.packageManager
  };
  fs.writeFileSync('./package.json', JSON.stringify(trimmed, null, 2));
  fs.writeFileSync('./yarn.lock', '');
  console.log('   ' + Object.keys(dependencies).length + ' dependencies (incl. module deps)');
"

echo "📥 Installing production dependencies via Yarn…"
corepack enable
yarn install

# ── Step 6b: Native modules (runtime dependent) ──
# The build launches the server through `bin/run.sh --bun`, so the addons Yarn
# just installed (built for the system Node ABI) are loaded by Bun, which uses
# the Node-API surface. Rebuilding against Electron's V8 ABI would break the
# Bun runtime, so it only runs when the server explicitly targets the Node fork.
SERVER_RUNTIME="${REACTORY_SERVER_RUNTIME:-bun}"
if [ "$SERVER_RUNTIME" = "node" ]; then
  echo ""
  echo "🔧 Rebuilding native modules against Electron's ABI (runtime=node)…"
  ELECTRON_VERSION=$(node -p "require('$PROJECT_DIR/node_modules/electron/package.json').version")
  (cd "$PROJECT_DIR" && npx @electron/rebuild --version "$ELECTRON_VERSION" --module-dir "$BUILD_DIR" --only canvas,sqlite3,node-pty || true)
else
  echo ""
  echo "⏭  Skipping Electron ABI rebuild (runtime=$SERVER_RUNTIME) — native addons stay on the Node/Bun ABI."
fi

# ── Step 7: Write the Electron entry points ──
# app/index.js is the real entry: starts the server, emits the readiness marker
# Electron watches for, supports IPC where available, and shuts down gracefully
# on SIGTERM/SIGINT (Bun has no IPC channel to Electron, so the signal path
# matters for the launcher process group).
# electron-entry.js at the server root is a thin shim so the Node-fork fallback
# in src/main/server.ts resolves to the same code.
echo ""
echo "📡 Writing Electron entry points…"
cat > "$APP_OUT/index.js" << 'ENTRYJS'
/**
 * Electron entry point for the Reactory Express Server.
 *
 * Starts the server, announces readiness (stdout marker + IPC when present)
 * and shuts down gracefully on IPC 'shutdown' or SIGTERM/SIGINT.
 */
'use strict';

// Load environment from the .env in the current working directory (the
// server root). Existing process env always wins — dotenv does not override.
require('dotenv').config();

const { ReactoryServer } = require('./express/server');

ReactoryServer()
  .then((result) => {
    // Readiness marker consumed by the Electron main process.
    console.log('Reactory Server started.');

    // IPC is only available on the Node fork path; under Bun it is undefined.
    if (process.send) {
      process.send('ready');
    }

    const shutdown = (reason) => {
      console.log(`Received ${reason} — stopping Reactory Server.`);
      try {
        result.stop();
      } catch {
        /* ignore */
      }
      setTimeout(() => process.exit(0), 2000);
    };

    process.on('message', (msg) => {
      if (msg === 'shutdown') shutdown('shutdown signal from Electron');
    });
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
  })
  .catch((err) => {
    console.error('Reactory Server startup failed:', err && err.message ? err.message : err);
    process.exit(1);
  });
ENTRYJS

cat > "$BUILD_DIR/electron-entry.js" << 'SHIMJS'
/**
 * Shim so the Node-fork fallback (src/main/server.ts) resolves to the same
 * entry point the bin/run.sh --bun launcher uses (./app/index.js).
 */
'use strict';

require('./app/index.js');
SHIMJS

echo ""
echo "══════════════════════════════════════════════════════════"
echo "  ✅ Server build complete"
echo "  Output: $BUILD_DIR"
echo "  App:    $APP_OUT/index.js"
echo "  Entry:  $BUILD_DIR/electron-entry.js (→ app/index.js)"
echo "  Launcher: $BUILD_DIR/bin/run.sh --bun"
echo "══════════════════════════════════════════════════════════"
