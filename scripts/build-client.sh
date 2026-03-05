#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────
# build-client.sh — Build the Reactory PWA Client for Electron
#
# Builds the client with Electron-specific environment variables
# then copies the output to build/client.
# ──────────────────────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
BUILD_DIR="$PROJECT_DIR/build/client"

# Resolve the PWA client path
REACTORY_CLIENT="${REACTORY_CLIENT:-$(dirname "$PROJECT_DIR")/reactory-pwa-client}"

if [ ! -d "$REACTORY_CLIENT" ]; then
  echo "❌ ERROR: Reactory PWA Client not found at $REACTORY_CLIENT"
  echo "   Set REACTORY_CLIENT environment variable to the correct path."
  exit 1
fi

echo "══════════════════════════════════════════════════════════"
echo "  Building Reactory PWA Client for Electron"
echo "  Source: $REACTORY_CLIENT"
echo "  Output: $BUILD_DIR"
echo "══════════════════════════════════════════════════════════"

# ── Step 1: Clean ──
echo ""
echo "🧹 Cleaning previous client build…"
rm -rf "$BUILD_DIR"
mkdir -p "$BUILD_DIR"

# ── Step 2: Ensure Electron env file exists ──
ELECTRON_ENV_DIR="$REACTORY_CLIENT/config/env/reactory"
ELECTRON_ENV_FILE="$ELECTRON_ENV_DIR/.env.electron"

if [ ! -f "$ELECTRON_ENV_FILE" ]; then
  echo ""
  echo "📝 Creating Electron environment file…"
  mkdir -p "$ELECTRON_ENV_DIR"
  cat > "$ELECTRON_ENV_FILE" << 'ENVEOF'
# Reactory PWA Client — Electron Build Environment
# API endpoint will be the embedded Express server
REACT_APP_API_ENDPOINT=http://localhost:4000
REACT_APP_CDN=http://localhost:4000/cdn/
REACT_APP_CLIENT_KEY=reactory
REACT_APP_CLIENT_PASSWORD=sXMaK/c6/wRylv/GaBW/kTGO6NINm/jdVzytw/1qyPQ=
REACT_APP_TITLE=reactory:reactory.application.title
REACT_APP_THEME=reactory
REACT_APP_THEME_PRIMARY=#f95e20
REACT_APP_THEME_SECONDARY=#424242
REACT_APP_THEME_BG=#424242
REACT_APP_SHORTNAME=reactory:reactory.application.shortName
REACT_APP_APP_TITLE=Reactory Desktop
REACT_APP_DISABLE_SW=true

# Build settings
PORT=3000
NODE_ENV=production
GENERATE_SOURCEMAP=false
CI=false

# Electron-specific
REACT_APP_RUNTIME=electron
ENVEOF
  echo "   Created: $ELECTRON_ENV_FILE"
fi

# ── Step 3: Build the client ──
echo ""
echo "🔨 Building client (this may take a few minutes)…"
cd "$REACTORY_CLIENT"

# Use the existing build script with the electron environment
if [ -f "bin/build.sh" ]; then
  bash bin/build.sh reactory electron
else
  echo "❌ ERROR: bin/build.sh not found in $REACTORY_CLIENT"
  exit 1
fi

# ── Step 4: Copy built output ──
echo ""
echo "📦 Copying build output…"
CLIENT_BUILD_OUTPUT="$REACTORY_CLIENT/build/reactory/electron"
if [ ! -d "$CLIENT_BUILD_OUTPUT" ]; then
  echo "⚠️  Expected build output at $CLIENT_BUILD_OUTPUT not found."
  echo "   Checking for alternative build locations…"
  
  # Try common alternatives
  for alt in "$REACTORY_CLIENT/build/reactory/production" "$REACTORY_CLIENT/build/reactory/local" "$REACTORY_CLIENT/build"; do
    if [ -d "$alt" ] && [ -f "$alt/index.html" ]; then
      CLIENT_BUILD_OUTPUT="$alt"
      echo "   Found build at: $alt"
      break
    fi
  done
fi

if [ -d "$CLIENT_BUILD_OUTPUT" ] && [ -f "$CLIENT_BUILD_OUTPUT/index.html" ]; then
  cp -r "$CLIENT_BUILD_OUTPUT/"* "$BUILD_DIR/"
  echo "   Copied $(find "$BUILD_DIR" -type f | wc -l | tr -d ' ') files"
else
  echo "❌ ERROR: Client build output not found or missing index.html"
  exit 1
fi

# ── Step 5: Patch for Electron ──
echo ""
echo "🔧 Applying Electron patches…"

# Remove service worker registration if it was built
if [ -f "$BUILD_DIR/service-worker.js" ]; then
  rm "$BUILD_DIR/service-worker.js"
  echo "   Removed service-worker.js"
fi

echo ""
echo "══════════════════════════════════════════════════════════"
echo "  ✅ Client build complete"
echo "  Output: $BUILD_DIR"
echo "  Files:  $(find "$BUILD_DIR" -type f | wc -l | tr -d ' ')"
echo "══════════════════════════════════════════════════════════"
