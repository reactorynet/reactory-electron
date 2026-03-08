/**
 * Reactory Desktop — Theme Resolver
 *
 * Reads theme assets from `REACTORY_DATA/themes/<themeId>` (dev) or
 * from the bundled `resources/theme` directory (packaged). Provides:
 *   - Theme metadata (colors, title, subtitle)
 *   - Paths to logo, icons, avatar, styles
 *   - Data URIs for the splash screen
 *
 * The theme key is determined by the `configId` setting in the store,
 * which mirrors the `REACTORY_CONFIG_ID` / `REACT_APP_THEME` concept
 * from the server and PWA client.
 */
import path from 'path';
import fs from 'fs';
import { app, nativeImage, NativeImage } from 'electron';
import log from 'electron-log/main';

// ── Types ──────────────────────────────────────────────────

export interface ThemeColors {
  /** Primary brand color (e.g. "#f95e20") */
  primary: string;
  /** Background color for splash / chrome (e.g. "#1a1a2e") */
  background: string;
  /** Secondary accent color */
  secondary: string;
  /** Text color on the background */
  textColor: string;
  /** Muted/subtitle text color */
  mutedColor: string;
}

export interface ThemeAssets {
  /** Absolute path to the logo image (PNG or SVG) */
  logoPath: string | null;
  /** Absolute path to the app avatar image */
  avatarPath: string | null;
  /** Absolute path to the favicon .ico */
  faviconPath: string | null;
  /** Absolute path to a large icon (512×512 PNG) */
  iconLargePath: string | null;
  /** Absolute path to the tray icon (16 or 32 px PNG) */
  trayIconPath: string | null;
  /** Absolute path to the styles.css file */
  stylesPath: string | null;
}

export interface ResolvedTheme {
  /** The theme key (e.g. "reactory", "booktutor") */
  id: string;
  /** Display name for the application */
  appName: string;
  /** Subtitle for the splash screen */
  subtitle: string;
  /** Theme color palette */
  colors: ThemeColors;
  /** Absolute paths to theme assets on disk */
  assets: ThemeAssets;
  /** Base64 data URI for the logo (for inline HTML splash) */
  logoDataUri: string | null;
}

// ── Default Reactory theme ─────────────────────────────────

const DEFAULT_COLORS: ThemeColors = {
  primary: '#f95e20',
  background: '#1a1a2e',
  secondary: '#424242',
  textColor: '#e0e0e0',
  mutedColor: '#7788aa',
};

const DEFAULT_THEME: ResolvedTheme = {
  id: 'reactory',
  appName: 'Reactory',
  subtitle: 'Desktop Edition',
  colors: DEFAULT_COLORS,
  assets: {
    logoPath: null,
    avatarPath: null,
    faviconPath: null,
    iconLargePath: null,
    trayIconPath: null,
    stylesPath: null,
  },
  logoDataUri: null,
};

// ── Known theme color overrides ────────────────────────────
//
// When we don't have a theme.json, we fall back to well-known
// config-id → color mappings. New themes should provide a
// theme.json in their data directory instead.
//
const KNOWN_THEME_COLORS: Record<string, Partial<ThemeColors>> = {
  reactory: {
    primary: '#f95e20',
    background: '#1a1a2e',
    secondary: '#424242',
  },
};

// ── Helpers ────────────────────────────────────────────────

function firstExisting(...candidates: string[]): string | null {
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function fileToDataUri(filePath: string): string | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    const ext = path.extname(filePath).toLowerCase();
    const mimeMap: Record<string, string> = {
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.svg': 'image/svg+xml',
      '.ico': 'image/x-icon',
      '.gif': 'image/gif',
      '.webp': 'image/webp',
    };
    const mime = mimeMap[ext] || 'application/octet-stream';
    const data = fs.readFileSync(filePath);
    return `data:${mime};base64,${data.toString('base64')}`;
  } catch {
    return null;
  }
}

// ── Main resolver ──────────────────────────────────────────

/**
 * Resolve the theme directory path.
 *
 * Dev mode:  `$REACTORY_DATA/themes/<themeId>`
 * Packaged:  `<resources>/reactory-data/themes/<themeId>`
 *
 * Falls back to the "reactory" theme if the requested one doesn't exist.
 */
function resolveThemeDir(themeId: string): string | null {
  const candidates: string[] = [];

  if (app.isPackaged) {
    candidates.push(
      path.join(process.resourcesPath, 'reactory-data', 'themes', themeId),
      path.join(process.resourcesPath, 'reactory-data', 'themes', 'reactory'),
    );
  } else {
    const dataRoot = process.env.REACTORY_DATA;
    if (dataRoot) {
      candidates.push(
        path.join(dataRoot, 'themes', themeId),
        path.join(dataRoot, 'themes', 'reactory'),
      );
    }
  }

  return firstExisting(...candidates);
}

/**
 * Try to read a `theme.json` from the theme directory.
 * This optional file allows customizing colors and metadata
 * beyond what images alone can express.
 *
 * Expected shape:
 * ```json
 * {
 *   "appName": "My App",
 *   "subtitle": "Custom Edition",
 *   "colors": {
 *     "primary": "#ff0000",
 *     "background": "#111111",
 *     "secondary": "#333333",
 *     "textColor": "#ffffff",
 *     "mutedColor": "#888888"
 *   }
 * }
 * ```
 */
function readThemeJson(themeDir: string): Partial<ResolvedTheme> | null {
  const jsonPath = path.join(themeDir, 'theme.json');
  if (!fs.existsSync(jsonPath)) return null;

  try {
    const raw = fs.readFileSync(jsonPath, 'utf-8');
    return JSON.parse(raw);
  } catch (err) {
    log.warn(`Failed to parse theme.json at ${jsonPath}:`, err);
    return null;
  }
}

/**
 * Resolve the complete theme for a given configuration key.
 *
 * @param themeId - The theme directory name (usually matches `REACT_APP_THEME`)
 * @param configId - The configuration key (used for app naming fallback)
 */
export function resolveTheme(themeId: string, configId?: string): ResolvedTheme {
  const themeDir = resolveThemeDir(themeId);

  if (!themeDir) {
    log.warn(`Theme directory not found for "${themeId}" — using defaults`);
    return { ...DEFAULT_THEME, id: themeId };
  }

  log.info(`Resolving theme "${themeId}" from ${themeDir}`);

  const imagesDir = path.join(themeDir, 'images');

  // ── Assets ──
  const logoPath = firstExisting(
    path.join(imagesDir, 'logo.png'),
    path.join(imagesDir, 'logo.svg'),
    path.join(imagesDir, `${themeId}.svg`),
    path.join(imagesDir, 'reactory.svg'),
  );

  const avatarPath = firstExisting(
    path.join(imagesDir, 'avatar.png'),
    path.join(imagesDir, 'avatar.svg'),
    path.join(imagesDir, `${themeId}_avatar.png`),
    path.join(imagesDir, 'reactory_avatar.png'),
  );

  const faviconPath = firstExisting(
    path.join(imagesDir, 'favicon.ico'),
  );

  const iconLargePath = firstExisting(
    path.join(imagesDir, 'icons-512.png'),
    path.join(imagesDir, 'icons-192.png'),
    path.join(imagesDir, 'icons-144.png'),
    path.join(imagesDir, 'icons-64.png'),
  );

  const trayIconPath = firstExisting(
    path.join(imagesDir, 'icons-16.png'),
    path.join(imagesDir, 'icons-32.png'),
    path.join(imagesDir, 'icons-44.png'),
    faviconPath,
  );

  const stylesPath = firstExisting(
    path.join(themeDir, 'styles.css'),
  );

  const assets: ThemeAssets = {
    logoPath,
    avatarPath,
    faviconPath,
    iconLargePath,
    trayIconPath,
    stylesPath,
  };

  // ── Colors (theme.json → known overrides → defaults) ──
  const themeJson = readThemeJson(themeDir);
  const knownColors = KNOWN_THEME_COLORS[themeId] || {};

  const colors: ThemeColors = {
    ...DEFAULT_COLORS,
    ...knownColors,
    ...(themeJson?.colors || {}),
  };

  // ── Metadata ──
  const humanName = configId || themeId;
  const appName = themeJson?.appName
    || humanName.charAt(0).toUpperCase() + humanName.slice(1);
  const subtitle = themeJson?.subtitle || 'Desktop Edition';

  // ── Logo data URI for inline splash ──
  const logoDataUri = logoPath ? fileToDataUri(logoPath) : null;

  return {
    id: themeId,
    appName,
    subtitle,
    colors,
    assets,
    logoDataUri,
  };
}

/**
 * Create a NativeImage for the tray/dock from the resolved theme.
 * Falls back to an empty image if the theme has no suitable icon.
 */
export function createTrayIcon(theme: ResolvedTheme): NativeImage {
  const iconPath = theme.assets.trayIconPath;

  if (iconPath) {
    try {
      const icon = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 });
      if (process.platform === 'darwin') {
        icon.setTemplateImage(true);
      }
      return icon;
    } catch (err) {
      log.warn('Failed to create tray icon from theme asset:', err);
    }
  }

  return nativeImage.createEmpty();
}

/**
 * Create a NativeImage for the dock / taskbar from the resolved theme.
 */
export function createAppIcon(theme: ResolvedTheme): NativeImage | null {
  const iconPath = theme.assets.iconLargePath;

  if (iconPath) {
    try {
      return nativeImage.createFromPath(iconPath);
    } catch (err) {
      log.warn('Failed to create app icon from theme asset:', err);
    }
  }

  return null;
}
