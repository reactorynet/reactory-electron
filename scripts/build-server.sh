#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────
# build-server.sh — Compile the Reactory Express Server for Electron
#
# This script:
#   1. Runs the code generator to produce __index.ts
#   2. Compiles TypeScript to JavaScript using Babel
#   3. Resolves path aliases
#   4. Copies the compiled output + production node_modules to build/server
# ──────────────────────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
BUILD_DIR="$PROJECT_DIR/build/server"

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

# ── Step 1: Clean ──
echo ""
echo "🧹 Cleaning previous build…"
rm -rf "$BUILD_DIR"
mkdir -p "$BUILD_DIR"

# ── Step 2: Run code generation ──
echo ""
echo "⚙️  Running code generation (module index + client configs)…"
pushd "$REACTORY_SERVER" > /dev/null

# The generate script produces src/modules/__index.ts and client config imports
if [ -f "bin/generate.sh" ]; then
  bash bin/generate.sh "$REACTORY_CONFIG_ID" "$REACTORY_ENV_ID" 2>/dev/null || {
    echo "⚠️  generate.sh failed — trying direct generation…"
    NODE_PATH=./src npx babel-node ./src/utils/code/index.ts \
      --presets @babel/env --extensions ".js,.ts" 2>/dev/null || true
  }
fi

popd > /dev/null

# ── Step 3: Compile TypeScript to JavaScript ──
echo ""
echo "🔨 Compiling TypeScript with Babel…"
cd "$REACTORY_SERVER"

npx babel src \
  --out-dir "$BUILD_DIR" \
  --presets @babel/env \
  --extensions ".js,.ts,.tsx" \
  --copy-files \
  --no-copy-ignored \
  --ignore "**/__tests__/**,**/*.test.ts,**/*.spec.ts,**/node_modules/**" \
  2>&1 | tail -5

# ── Step 4: Resolve path aliases ──
echo ""
echo "🔗 Resolving path aliases…"
# Replace @reactory/server-core/* → relative paths
# Replace @reactory/server-modules/* → relative module paths
cd "$BUILD_DIR"

if command -v find &> /dev/null; then
  # Use sed to replace path aliases in compiled JS files
  find . -name "*.js" -type f | while read -r file; do
    # Calculate relative path from file to root
    dir=$(dirname "$file")

    # @reactory/server-core/* → relative to root
    if grep -q "@reactory/server-core/" "$file" 2>/dev/null; then
      rel=$(python3 -c "import os.path; print(os.path.relpath('.', '$dir'))" 2>/dev/null || echo ".")
      sed -i '' "s|@reactory/server-core/|${rel}/|g" "$file" 2>/dev/null || \
      sed -i "s|@reactory/server-core/|${rel}/|g" "$file" 2>/dev/null || true
    fi

    # @reactory/server-modules/* → ./modules/*
    if grep -q "@reactory/server-modules/" "$file" 2>/dev/null; then
      rel=$(python3 -c "import os.path; print(os.path.relpath('./modules', '$dir'))" 2>/dev/null || echo "./modules")
      sed -i '' "s|@reactory/server-modules/|${rel}/|g" "$file" 2>/dev/null || \
      sed -i "s|@reactory/server-modules/|${rel}/|g" "$file" 2>/dev/null || true
    fi
  done
fi

# ── Step 5: Copy essential non-JS files ──
echo ""
echo "📦 Copying essential assets…"
cd "$REACTORY_SERVER"

# Copy package.json (needed for version info)
cp package.json "$BUILD_DIR/"

# Copy view templates (EJS files)
find src -name "*.ejs" -o -name "*.hbs" | while read -r tpl; do
  dest="$BUILD_DIR/${tpl#src/}"
  mkdir -p "$(dirname "$dest")"
  cp "$tpl" "$dest"
done

# Copy GraphQL schema files
find src -name "*.graphql" -o -name "*.gql" | while read -r gql; do
  dest="$BUILD_DIR/${gql#src/}"
  mkdir -p "$(dirname "$dest")"
  cp "$gql" "$dest"
done

# Copy proto files
find src -name "*.proto" | while read -r proto; do
  dest="$BUILD_DIR/${proto#src/}"
  mkdir -p "$(dirname "$dest")"
  cp "$proto" "$dest"
done

# ── Step 6: Install production dependencies ──
echo ""
echo "📥 Installing production dependencies…"
cd "$BUILD_DIR"

# Create a trimmed package.json with only production dependencies
node -e "
  const pkg = require('$REACTORY_SERVER/package.json');
  const trimmed = {
    name: pkg.name,
    version: pkg.version,
    dependencies: pkg.dependencies,
    resolutions: pkg.resolutions || {}
  };
  require('fs').writeFileSync('./package.json', JSON.stringify(trimmed, null, 2));
"

# Note: In CI, you'd run yarn install --production here.
# For local dev, we skip this step (it takes a while) and rely on the
# server's own node_modules via NODE_PATH.
echo "⚠️  Skipping production install for local dev. Run this in CI:"
echo "    cd $BUILD_DIR && yarn install --production --frozen-lockfile"

# ── Step 7: Add IPC signal support ──
echo ""
echo "📡 Patching server for Electron IPC…"
cat > "$BUILD_DIR/electron-entry.js" << 'ENTRYJS'
/**
 * Electron-compatible entry point for the Reactory server.
 * Wraps the original entry and adds IPC messaging for lifecycle events.
 */
'use strict';

// Load environment from parent process
require('dotenv').config();

// Import and start the server
const { ReactoryServer } = require('./express/server');

ReactoryServer()
  .then((result) => {
    console.log('Reactory Server started.');

    // Signal to Electron main process that server is ready
    if (process.send) {
      process.send('ready');
    }

    // Listen for shutdown signal from Electron
    process.on('message', (msg) => {
      if (msg === 'shutdown') {
        console.log('Received shutdown signal from Electron.');
        result.stop();
        setTimeout(() => process.exit(0), 3000);
      }
    });
  })
  .catch((err) => {
    console.error('Reactory Server startup failed:', err.message);
    process.exit(1);
  });
ENTRYJS

echo ""
echo "══════════════════════════════════════════════════════════"
echo "  ✅ Server build complete"
echo "  Output: $BUILD_DIR"
echo "  Entry:  $BUILD_DIR/electron-entry.js"
echo "══════════════════════════════════════════════════════════"
