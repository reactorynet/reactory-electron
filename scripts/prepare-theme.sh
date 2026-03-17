#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────
# prepare-theme.sh — Extract theme assets for Electron packaging
#
# Copies logo, icons, and metadata from REACTORY_DATA/themes/<key>
# into the Electron resources/ directory so that electron-builder
# can package them as native app icons and splash branding.
#
# Usage:
#   bash scripts/prepare-theme.sh [themeId] [configId]
#
# Defaults:
#   themeId   = REACTORY_THEME_ID or "reactory"
#   configId  = REACTORY_CONFIG_ID or same as themeId
# ──────────────────────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
RESOURCES_DIR="$PROJECT_DIR/resources"

THEME_ID="${1:-${REACTORY_THEME_ID:-reactory}}"
CONFIG_ID="${2:-${REACTORY_CONFIG_ID:-$THEME_ID}}"

REACTORY_DATA="${REACTORY_DATA:-$(dirname "$PROJECT_DIR")/reactory-data}"
THEME_DIR="$REACTORY_DATA/themes/$THEME_ID"

if [ ! -d "$THEME_DIR" ]; then
  echo "❌ ERROR: Theme directory not found at $THEME_DIR"
  exit 1
fi

echo "══════════════════════════════════════════════════════════"
echo "  Preparing theme assets for Electron"
echo "  Theme:  $THEME_ID"
echo "  Config: $CONFIG_ID"
echo "  Source: $THEME_DIR"
echo "  Target: $RESOURCES_DIR"
echo "══════════════════════════════════════════════════════════"

IMAGES_DIR="$THEME_DIR/images"
ICONS_DIR="$RESOURCES_DIR/icons"

# ── Step 1: Copy icon.png (for macOS tray and fallback) ──
echo ""
echo "📎 Preparing app icons…"

# Use the largest available PNG icon
if [ -f "$IMAGES_DIR/icons-512.png" ]; then
  cp "$IMAGES_DIR/icons-512.png" "$RESOURCES_DIR/icon.png"
  echo "   icon.png ← icons-512.png"
elif [ -f "$IMAGES_DIR/icons-192.png" ]; then
  cp "$IMAGES_DIR/icons-192.png" "$RESOURCES_DIR/icon.png"
  echo "   icon.png ← icons-192.png"
elif [ -f "$IMAGES_DIR/icons-144.png" ]; then
  cp "$IMAGES_DIR/icons-144.png" "$RESOURCES_DIR/icon.png"
  echo "   icon.png ← icons-144.png"
fi

# ── Step 2: Prepare Linux icon set ──
# electron-builder expects resources/icons/ with sizes like 16x16.png, 32x32.png etc.
echo "📎 Preparing Linux icon set…"
mkdir -p "$ICONS_DIR"

# Portable icon-size mapping (no associative arrays — works with Bash 3.x)
ICON_PAIRS="
icons-16.png:16x16.png
icons-32.png:32x32.png
icons-44.png:48x48.png
icons-64.png:64x64.png
icons-144.png:128x128.png
icons-192.png:256x256.png
icons-512.png:512x512.png
"

for pair in $ICON_PAIRS; do
  src_name="${pair%%:*}"
  dst_name="${pair##*:}"
  if [ -f "$IMAGES_DIR/$src_name" ]; then
    cp "$IMAGES_DIR/$src_name" "$ICONS_DIR/$dst_name"
    echo "   $dst_name ← $src_name"
  fi
done

# ── Step 3: Windows .ico ──
if [ -f "$IMAGES_DIR/favicon.ico" ]; then
  cp "$IMAGES_DIR/favicon.ico" "$RESOURCES_DIR/icon.ico"
  echo "   icon.ico ← favicon.ico"
fi

# ── Step 4: macOS .icns ──
# If sips + iconutil are available (macOS), generate .icns from PNGs
if command -v iconutil &>/dev/null && [ -f "$IMAGES_DIR/icons-512.png" ]; then
  echo "📎 Generating macOS .icns…"
  ICONSET_DIR="$RESOURCES_DIR/icon.iconset"
  mkdir -p "$ICONSET_DIR"

  # Copy available sizes into the iconset (macOS expects specific naming)
  for pair in $ICON_PAIRS; do
    src_name="${pair%%:*}"
    dst_name="${pair##*:}"
    if [ -f "$IMAGES_DIR/$src_name" ]; then
      # Map to macOS iconset naming: icon_16x16.png, icon_32x32.png, etc.
      dim="${dst_name%.png}"  # e.g., "16x16"
      cp "$IMAGES_DIR/$src_name" "$ICONSET_DIR/icon_${dim}.png"
    fi
  done

  # Generate @2x retina variants where possible
  if [ -f "$IMAGES_DIR/icons-64.png" ]; then
    cp "$IMAGES_DIR/icons-64.png" "$ICONSET_DIR/icon_32x32@2x.png"
  fi
  if [ -f "$IMAGES_DIR/icons-512.png" ]; then
    cp "$IMAGES_DIR/icons-512.png" "$ICONSET_DIR/icon_256x256@2x.png"
  fi

  iconutil -c icns "$ICONSET_DIR" -o "$RESOURCES_DIR/icon.icns" 2>/dev/null || {
    echo "   ⚠️  iconutil failed — .icns not generated (non-fatal)"
  }

  rm -rf "$ICONSET_DIR"
  [ -f "$RESOURCES_DIR/icon.icns" ] && echo "   icon.icns generated ✅"
else
  echo "   ⚠️  iconutil not available — skipping .icns generation"
fi

# ── Step 5: Write theme metadata ──
echo ""
echo "📝 Writing theme metadata…"

# Read colors from the PWA client env file if available
PRIMARY_COLOR=""
SECONDARY_COLOR=""
REACTORY_CLIENT="${REACTORY_CLIENT:-$(dirname "$PROJECT_DIR")/reactory-pwa-client}"
CLIENT_ENV="$REACTORY_CLIENT/config/env/$CONFIG_ID/.env.local"

if [ -f "$CLIENT_ENV" ]; then
  PRIMARY_COLOR=$(grep "^REACT_APP_THEME_PRIMARY=" "$CLIENT_ENV" | cut -d= -f2 | tr -d "'" | tr -d '"' || true)
  SECONDARY_COLOR=$(grep "^REACT_APP_THEME_BG=" "$CLIENT_ENV" | cut -d= -f2 | tr -d "'" | tr -d '"' || true)
fi

# Only create theme.json if it doesn't already exist in the theme dir
if [ ! -f "$THEME_DIR/theme.json" ]; then
  # Create one in resources for reference
  cat > "$RESOURCES_DIR/theme.json" << THEMEJSON
{
  "id": "${THEME_ID}",
  "configId": "${CONFIG_ID}",
  "colors": {
    "primary": "${PRIMARY_COLOR:-#f95e20}",
    "background": "#1a1a2e",
    "secondary": "${SECONDARY_COLOR:-#424242}",
    "textColor": "#e0e0e0",
    "mutedColor": "#7788aa"
  }
}
THEMEJSON
  echo "   Created resources/theme.json"
fi

echo ""
echo "══════════════════════════════════════════════════════════"
echo "  ✅ Theme assets prepared"
echo "  Theme: $THEME_ID"
echo "══════════════════════════════════════════════════════════"
