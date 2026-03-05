#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────
# bundle-data.sh — Assemble a minimal reactory-data bundle
#
# Copies only the runtime-essential assets from reactory-data
# into build/reactory-data for packaging with Electron.
#
# Full reactory-data can be 1.5GB+; this bundle targets ~10-50MB.
# ──────────────────────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
BUILD_DIR="$PROJECT_DIR/build/reactory-data"

# Resolve reactory-data path
REACTORY_DATA="${REACTORY_DATA:-$(dirname "$PROJECT_DIR")/reactory-data}"

if [ ! -d "$REACTORY_DATA" ]; then
  echo "❌ ERROR: reactory-data not found at $REACTORY_DATA"
  echo "   Set REACTORY_DATA environment variable to the correct path."
  exit 1
fi

echo "══════════════════════════════════════════════════════════"
echo "  Bundling reactory-data for Electron"
echo "  Source: $REACTORY_DATA"
echo "  Output: $BUILD_DIR"
echo "══════════════════════════════════════════════════════════"

# ── Step 1: Clean ──
echo ""
echo "🧹 Cleaning previous data bundle…"
rm -rf "$BUILD_DIR"
mkdir -p "$BUILD_DIR"

# ── Step 2: Copy essential directories ──

# Themes (branding, CSS, images) — ~300KB
echo "📁 Copying themes…"
if [ -d "$REACTORY_DATA/themes" ]; then
  cp -r "$REACTORY_DATA/themes" "$BUILD_DIR/themes"
fi

# i18n translations — ~90KB
echo "📁 Copying i18n translations…"
if [ -d "$REACTORY_DATA/i18n" ]; then
  cp -r "$REACTORY_DATA/i18n" "$BUILD_DIR/i18n"
fi

# Email templates — ~20KB
echo "📁 Copying email templates…"
if [ -d "$REACTORY_DATA/templates" ]; then
  cp -r "$REACTORY_DATA/templates" "$BUILD_DIR/templates"
fi

# Profiles (default avatars, persona data) — ~30KB
echo "📁 Copying profiles…"
if [ -d "$REACTORY_DATA/profiles" ]; then
  cp -r "$REACTORY_DATA/profiles" "$BUILD_DIR/profiles"
fi

# Static content — ~4KB
echo "📁 Copying content…"
if [ -d "$REACTORY_DATA/content" ]; then
  cp -r "$REACTORY_DATA/content" "$BUILD_DIR/content"
fi

# Workflow definitions — structure needed
echo "📁 Copying workflows…"
if [ -d "$REACTORY_DATA/workflows" ]; then
  cp -r "$REACTORY_DATA/workflows" "$BUILD_DIR/workflows"
else
  mkdir -p "$BUILD_DIR/workflows/catalog" "$BUILD_DIR/workflows/schedules"
fi

# ── Step 3: Plugin built artifacts (skip node_modules!) ──
echo "📁 Copying plugin artifacts…"
PLUGINS_DIR="$BUILD_DIR/plugins"
mkdir -p "$PLUGINS_DIR/__runtime__" "$PLUGINS_DIR/artifacts"

# Copy the plugin registry
if [ -f "$REACTORY_DATA/plugins/available.json" ]; then
  cp "$REACTORY_DATA/plugins/available.json" "$PLUGINS_DIR/"
fi

if [ -f "$REACTORY_DATA/plugins/installed.json" ]; then
  cp "$REACTORY_DATA/plugins/installed.json" "$PLUGINS_DIR/"
fi

# Copy reactory-client-core built output (dist/build only, skip node_modules)
if [ -d "$REACTORY_DATA/plugins/reactory-client-core" ]; then
  mkdir -p "$PLUGINS_DIR/reactory-client-core"
  # Copy dist/build directories if they exist
  for dir in dist build lib; do
    if [ -d "$REACTORY_DATA/plugins/reactory-client-core/$dir" ]; then
      cp -r "$REACTORY_DATA/plugins/reactory-client-core/$dir" "$PLUGINS_DIR/reactory-client-core/$dir"
    fi
  done
  # Copy package.json for reference
  if [ -f "$REACTORY_DATA/plugins/reactory-client-core/package.json" ]; then
    cp "$REACTORY_DATA/plugins/reactory-client-core/package.json" "$PLUGINS_DIR/reactory-client-core/"
  fi
fi

# Copy __runtime__ compiled bundles (skip node_modules)
if [ -d "$REACTORY_DATA/plugins/__runtime__" ]; then
  find "$REACTORY_DATA/plugins/__runtime__" \
    -maxdepth 1 \
    \( -name "*.js" -o -name "*.json" -o -name "*.map" \) \
    -exec cp {} "$PLUGINS_DIR/__runtime__/" \;
  echo "   Copied $(find "$PLUGINS_DIR/__runtime__" -type f | wc -l | tr -d ' ') runtime files"
fi

# Copy artifacts (tarballs)
if [ -d "$REACTORY_DATA/plugins/artifacts" ]; then
  cp -r "$REACTORY_DATA/plugins/artifacts/"*.tgz "$PLUGINS_DIR/artifacts/" 2>/dev/null || true
fi

# ── Step 4: Fonts (selective — top essential fonts) ──
echo "📁 Copying essential fonts…"
FONTS_DIR="$BUILD_DIR/fonts"
mkdir -p "$FONTS_DIR"

if [ -d "$REACTORY_DATA/fonts" ]; then
  # Copy only common/essential fonts to keep bundle small
  # Add more as needed or use --all-fonts flag to copy everything
  ESSENTIAL_FONTS=(
    "Roboto"
    "OpenSans"
    "Lato"
    "Montserrat"
    "Arial"
    "NotoSans"
  )

  if [ "${1:-}" = "--all-fonts" ]; then
    echo "   Copying ALL fonts (this adds ~370MB)…"
    cp -r "$REACTORY_DATA/fonts/"* "$FONTS_DIR/" 2>/dev/null || true
  else
    for font in "${ESSENTIAL_FONTS[@]}"; do
      find "$REACTORY_DATA/fonts" -maxdepth 1 -iname "${font}*" -exec cp {} "$FONTS_DIR/" \; 2>/dev/null || true
    done
    echo "   Copied essential fonts only. Use --all-fonts to include all."
  fi
fi

# ── Step 5: Create required empty directories ──
echo "📁 Creating required directory structure…"
mkdir -p "$BUILD_DIR/logging"
mkdir -p "$BUILD_DIR/builds"
mkdir -p "$BUILD_DIR/imports"
mkdir -p "$BUILD_DIR/tmp"
mkdir -p "$BUILD_DIR/organization"
mkdir -p "$BUILD_DIR/forms"

# ── Summary ──
TOTAL_SIZE=$(du -sh "$BUILD_DIR" | awk '{print $1}')
TOTAL_FILES=$(find "$BUILD_DIR" -type f | wc -l | tr -d ' ')

echo ""
echo "══════════════════════════════════════════════════════════"
echo "  ✅ Data bundle complete"
echo "  Output: $BUILD_DIR"
echo "  Size:   $TOTAL_SIZE"
echo "  Files:  $TOTAL_FILES"
echo "══════════════════════════════════════════════════════════"
