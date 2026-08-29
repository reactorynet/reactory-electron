/**
 * Reactory Desktop — Environment Configuration
 *
 * Resolves all environment variables needed by the Reactory Express Server,
 * pointing paths to the Electron resource directories and using the
 * embedded MongoDB URI.
 */
import path from 'path';
import fs from 'fs';
import { app } from 'electron';
import crypto from 'crypto';

export interface EnvOptions {
  mongoUri: string;
  apiPort: number;
  clientPort: number;
  dataRoot: string;
  clientBuildPath: string;
  isPackaged: boolean;
  serverPath?: string;
  /** Server configuration key (e.g. "reactory") — determines which .env file to load */
  serverConfigId?: string;
  /** Client configuration key (e.g. "reactory") — used for REACTORY_CLIENT_KEY */
  clientConfigId?: string;
}

/**
 * Well-known paths used throughout the Electron app.
 */
export const PATHS = {
  /** User data directory (persistent across updates) */
  userData: app?.getPath('userData') ?? '',
  /** Logs directory */
  logs: app?.getPath('logs') ?? '',
};

/**
 * Generate a stable secret for JWT signing, persisted in userData.
 * This ensures tokens survive app restarts.
 */
function getOrCreateSecret(userDataPath: string): string {
  const secretFile = path.join(userDataPath, '.reactory-secret');

  if (fs.existsSync(secretFile)) {
    return fs.readFileSync(secretFile, 'utf-8').trim();
  }

  const secret = crypto.randomBytes(32).toString('base64');
  fs.writeFileSync(secretFile, secret, { mode: 0o600 });
  return secret;
}

/**
 * Read an env-cmd style .env file and return key=value pairs.
 */
function readDotEnv(filePath: string): Record<string, string> {
  const result: Record<string, string> = {};
  if (!fs.existsSync(filePath)) return result;

  const content = fs.readFileSync(filePath, 'utf-8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIndex = trimmed.indexOf('=');
    if (eqIndex < 0) continue;
    const key = trimmed.slice(0, eqIndex).trim();
    let value = trimmed.slice(eqIndex + 1).trim();
    // Strip surrounding quotes
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    result[key] = value;
  }
  return result;
}

/**
 * Build the full environment object for the Express server process.
 *
 * In dev mode: reads the existing .env.local from the Express server config,
 * then overlays Electron-specific settings (MongoDB, port, runtime marker).
 *
 * In packaged mode: builds the full env from scratch.
 */
export function resolveEnv(opts: EnvOptions): Record<string, string> {
  const {
    mongoUri, apiPort, clientPort, dataRoot, clientBuildPath,
    isPackaged, serverPath,
    serverConfigId = 'reactory',
    clientConfigId = 'reactory',
  } = opts;
  const userDataPath = PATHS.userData || app.getPath('userData');
  const secret = getOrCreateSecret(userDataPath);

  // ── Dev mode: inherit from existing .env.local + overlay ──
  if (!isPackaged && serverPath) {
    const envFile = path.join(serverPath, 'config', serverConfigId, '.env.local');
    const baseEnv = readDotEnv(envFile);

    // Parse the embedded mongo URI for individual connection params
    let mongoHost = 'localhost';
    let mongoPort = '27017';
    let mongoDB = 'reactory';

    try {
      const url = new URL(mongoUri);
      mongoHost = url.hostname;
      mongoPort = url.port || '27017';
      mongoDB = url.pathname.replace('/', '') || 'reactory';
    } catch { /* keep defaults */ }

    return {
      // Start with the existing dev environment
      ...baseEnv,

      // Override database settings with embedded MongoDB
      MONGOOSE: mongoUri,
      MONGO_HOST: mongoHost,
      MONGO_PORT: mongoPort,
      MONGO_DB: mongoDB,
      MONGO_USER: '',
      MONGO_PASSWORD: '',

      // Override server settings
      API_PORT: String(apiPort),
      API_URI_ROOT: `http://localhost:${apiPort}`,
      CDN_ROOT: `http://localhost:${apiPort}/cdn`,

      // Data paths (use existing workspace paths in dev)
      APP_DATA_ROOT: dataRoot,

      // Client serving — the PWA client runs on its own port
      ELECTRON_CLIENT_BUILD_PATH: clientBuildPath,
      REACTORY_CLIENT_URL: `http://localhost:${clientPort}`,
      // Ensure both client port and API port are in the CORS whitelist.
      // The .env.local whitelist is also merged in via baseEnv, but we
      // add these explicitly to guarantee they're present.
      REACTORY_APP_WHITELIST: [
        `http://localhost:${clientPort}`,
        `http://localhost:${apiPort}`,
        `http://localhost:${apiPort}/`,
        'https://studio.apollographql.com',
      ].join(','),

      // Session (use memory store in dev to avoid extra dependencies)
      // REACTORY_SESSION_STORE not set = default MemoryStore

      // Disable optional services
      USE_REDIS_CACHE: 'false',
      GRPC_ENABLED: 'false',

      // Electron marker
      REACTORY_RUNTIME: 'electron',
    };
  }

  // ── Packaged mode: build full env from scratch ──
  return {
    // ── Node ──
    NODE_ENV: 'production',
    APPLICATION_ROOT: '.',
    NODE_PATH: serverPath || '.',

    // ── Database ──
    MONGOOSE: mongoUri,
    MONGO_USER: '',
    MONGO_PASSWORD: '',

    // ── Server ──
    API_PORT: String(apiPort),
    API_URI_ROOT: `http://localhost:${apiPort}`,
    CDN_ROOT: `http://localhost:${apiPort}/cdn`,
    SERVER_ID: 'reactory-desktop',
    DOMAIN_NAME: 'localhost',
    MAX_FILE_UPLOAD: '50mb',
    SECRET_SAUCE: secret,

    // ── Data paths ──
    APP_DATA_ROOT: dataRoot,
    APP_SYSTEM_FONTS: path.join(dataRoot, 'fonts'),

    // ── Client serving ──
    ELECTRON_CLIENT_BUILD_PATH: clientBuildPath,
    REACTORY_CLIENT_URL: `http://localhost:${clientPort}`,
    REACTORY_APP_WHITELIST: [
      `http://localhost:${clientPort}`,
      `http://localhost:${apiPort}`,
      `http://localhost:${apiPort}/`,
    ].join(','),

    // ── Authentication ──
    REACTORY_APPLICATION_KEY: serverConfigId,
    REACTORY_APPLICATION_USERNAME: 'reactory',
    REACTORY_APPLICATION_EMAIL: 'reactory@reactory.net',
    REACTORY_APPLICATION_PASSWORD: 'bYGgEjp9U9BBi3R3RPx8DAjm+8thTKdpymngp2kU+50=',
    REACTORY_APPLICATION_URL: `http://localhost:${clientPort}`,
    SYSTEM_USER_ID: 'reactory@reactory.net',
    REACTORY_CLIENT_KEY: clientConfigId,
    REACTORY_CLIENT_PWD: 'bYGgEjp9U9BBi3R3RPx8DAjm+8thTKdpymngp2kU+50=',

    REACTOR_APPLICATION_EMAIL: 'reactor@reactor.local',
    REACTOR_APPLICATION_USERNAME: 'reactor',
    REACTOR_APPLICATION_KEY: 'reactor',
    REACTOR_APPLICATION_PASSWORD: 'reactorpassword',
    REACTOR_APPLICATION_URL: 'http://localhost:3002',
    REACTOR_APPLICATION_PORT: '3002',

    REACTOR_ANONUSER_EMAIL: 'anon@reactor.local',
    REACTOR_ANONUSER_USERNAME: 'anon',
    REACTOR_ANONUSER_PASSWORD: 'anonymouspassword',

    BOOKTUTOR_APPLICATION_EMAIL: 'application@booktutor.local',
    BOOKTUTOR_APPLICATION_USERNAME: 'booktutor',
    BOOKTUTOR_APPLICATION_KEY: 'booktutor',
    BOOKTUTOR_APPLICATION_PASSWORD: 'booktutorpassword',
    BOOKTUTOR_APPLICATION_URL: 'http://localhost:3004',
    BOOKTUTOR_APPLICATION_PORT: '3004',

    COMPUTE_PLANNER_APPLICATION_EMAIL: 'application@computeplanner.local',
    COMPUTE_PLANNER_APPLICATION_USERNAME: 'computeplanner',
    COMPUTE_PLANNER_APPLICATION_KEY: 'compute-planner',
    COMPUTE_PLANNER_APPLICATION_PASSWORD: 'computeplannerpassword',
    COMPUTE_PLANNER_APPLICATION_URL: 'http://localhost:3005',
    COMPUTE_PLANNER_APPLICATION_PORT: '3005',

    COMPUTE_PLANNER_ANONUSER_EMAIL: 'anon@reactor.local',
    COMPUTE_PLANNER_ANONUSER_USERNAME: 'anon',
    COMPUTE_PLANNER_ANONUSER_PASSWORD: 'anonymouspassword',

    // ── Modules ──
    MODULES_ENABLED: `enabled-${serverConfigId}`,
    CLIENTS_ENABLED: `enabled-clients.${serverConfigId}`,

    // ── i18n ──
    I18N_NS: serverConfigId,

    // ── Optional services (disabled for desktop) ──
    USE_REDIS_CACHE: 'false',
    GRPC_ENABLED: 'false',
    SENDGRID_API_KEY: 'SG.disabled',

    // ── Email ──
    MAIL_REDIRECT_ENABLED: 'development',
    MAIL_REDIRECT_ADDRESS: 'admin@reactory.localhost',

    // ── Microsoft OAuth (disabled by default) ──
    MICROSOFT_OAUTH_APP_ID: '00000000-0000-0000-0000-000000000000',
    MICROSOFT_OAUTH_APP_PASSWORD: '00000000-0000-0000-0000-000000000000',
    MICROSOFT_OAUTH_REDIRECT_URI: `http://localhost:${apiPort}/auth/microsoft/openid/complete`,
    MICROSOFT_OAUTH_SCOPES: 'profile offline_access user.read',
    MICROSOFT_OAUTH_AUTHORITY: 'https://login.microsoftonline.com/common',
    MICROSOFT_OAUTH_ID_METADATA: '/v2.0/.well-known/openid-configuration',
    MICROSOFT_OAUTH_AUTHORIZE_ENDPOINT: '/oauth2/v2.0/authorize',
    MICROSOFT_OAUTH_TOKEN_ENDPOINT: '/oauth2/v2.0/token',

    // ── Logging ──
    LOG_LEVEL: 'info',

    // ── Session (use embedded MongoDB for session store) ──
    REACTORY_SESSION_STORE: 'mongo',

    // ── Electron marker ──
    REACTORY_RUNTIME: 'electron',
  };
}
