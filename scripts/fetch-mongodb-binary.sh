#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────
# fetch-mongodb-binary.sh — Download the mongod binary electron-builder.yml
# bundles as an extraResource for the current platform/arch.
#
# electron-builder.yml references resources/mongodb/<platform>/<arch>/mongod
# unconditionally; if that path doesn't exist, `electron-builder` fails the
# whole package build. The app already falls back to mongodb-memory-server
# at runtime if this binary is missing (src/main/mongodb.ts), but that only
# helps once the app is already packaged — it doesn't help `yarn dist` itself
# get past electron-builder's extraResources check. This script is meant to
# run before dist/dist:mac/dist:win/dist:linux (see package.json) so that
# check always has something to find.
#
# Idempotent: skips the download if the binary is already present, so local
# repeated runs are fast. Override the version with MONGODB_VERSION, and the
# Linux distro build with MONGODB_LINUX_DISTRO (see
# https://www.mongodb.com/try/download/community-edition for available
# per-distro Linux builds — this only matters for the `dist:linux` target).
# ──────────────────────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
RESOURCES_DIR="$PROJECT_DIR/resources/mongodb"

MONGODB_VERSION="${MONGODB_VERSION:-7.0.14}"
MONGODB_LINUX_DISTRO="${MONGODB_LINUX_DISTRO:-ubuntu2204}"

# Which platform(s) to fetch for. Defaults to the host OS (matching how
# dist:mac/dist:win/dist:linux are run — one native OS per CI job) but can be
# overridden, e.g. MONGODB_FETCH_PLATFORMS="mac win linux" to fetch all three.
detect_host_platform() {
  case "$(uname -s)" in
    Darwin) echo "mac" ;;
    Linux)  echo "linux" ;;
    MINGW*|MSYS*|CYGWIN*) echo "win" ;;
    *) echo "unknown" ;;
  esac
}
MONGODB_FETCH_PLATFORMS="${MONGODB_FETCH_PLATFORMS:-$(detect_host_platform)}"

detect_arch() {
  case "$(uname -m)" in
    x86_64|amd64) echo "x64" ;;
    arm64|aarch64) echo "arm64" ;;
    *) echo "x64" ;;
  esac
}

fetch_one() {
  local platform="$1" arch="$2" url="$3" archive_name="$4" bin_name="$5"
  local dest_dir="$RESOURCES_DIR/$platform/$arch"
  local dest_bin="$dest_dir/$bin_name"

  if [ -f "$dest_bin" ]; then
    echo "✅ $platform/$arch mongod already present at $dest_bin — skipping"
    return 0
  fi

  echo "⬇️  Fetching MongoDB $MONGODB_VERSION for $platform/$arch ..."
  mkdir -p "$dest_dir"
  local tmp_dir
  tmp_dir="$(mktemp -d)"
  trap 'rm -rf "$tmp_dir"' RETURN

  curl -fsSL "$url" -o "$tmp_dir/$archive_name"

  case "$archive_name" in
    *.zip)
      unzip -q "$tmp_dir/$archive_name" -d "$tmp_dir"
      ;;
    *.tgz|*.tar.gz)
      tar -xzf "$tmp_dir/$archive_name" -C "$tmp_dir"
      ;;
  esac

  local found
  found="$(find "$tmp_dir" -type f -name "$bin_name" | head -n1)"
  if [ -z "$found" ]; then
    echo "❌ Could not find $bin_name inside downloaded archive for $platform/$arch"
    return 1
  fi

  cp "$found" "$dest_bin"
  chmod +x "$dest_bin"
  echo "✅ Installed $dest_bin"
}

for platform in $MONGODB_FETCH_PLATFORMS; do
  case "$platform" in
    mac)
      arch="$(detect_arch)"
      # MongoDB publishes universal-ish per-arch macOS builds as "macos-<arch>" (arm64) / "macos-x86_64".
      mac_arch_segment="x86_64"; [ "$arch" = "arm64" ] && mac_arch_segment="arm64"
      fetch_one "mac" "$arch" \
        "https://fastdl.mongodb.org/osx/mongodb-macos-${mac_arch_segment}-${MONGODB_VERSION}.tgz" \
        "mongodb-macos-${mac_arch_segment}-${MONGODB_VERSION}.tgz" \
        "mongod"
      ;;
    win)
      fetch_one "win" "x64" \
        "https://fastdl.mongodb.org/windows/mongodb-windows-x86_64-${MONGODB_VERSION}.zip" \
        "mongodb-windows-x86_64-${MONGODB_VERSION}.zip" \
        "mongod.exe"
      ;;
    linux)
      fetch_one "linux" "x64" \
        "https://fastdl.mongodb.org/linux/mongodb-linux-x86_64-${MONGODB_LINUX_DISTRO}-${MONGODB_VERSION}.tgz" \
        "mongodb-linux-x86_64-${MONGODB_LINUX_DISTRO}-${MONGODB_VERSION}.tgz" \
        "mongod"
      ;;
    *)
      echo "⚠️  Unknown/unsupported platform '$platform' — skipping"
      ;;
  esac
done
