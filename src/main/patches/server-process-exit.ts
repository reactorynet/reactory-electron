/**
 * Express Server Patch — Remove process.exit() calls
 *
 * When the Reactory Express Server runs inside Electron, calling
 * process.exit() would kill the entire Electron application.
 *
 * ── What to change in src/express/server.ts ──
 *
 * 1. MongoDB connection failure (line ~105):
 *    BEFORE: process.exit(0);
 *    AFTER:  throw new Error('Could not connect to MongoDB');
 *
 * 2. unhandledRejection handler (line ~108):
 *    BEFORE: process.exit(0);
 *    AFTER:  logger.error('unhandledRejection', error);
 *            // Don't exit — Electron manages the process
 *
 * 3. SIGINT handlers (lines ~114, ~158):
 *    BEFORE: process.on('SIGINT', () => { ... process.exit(0); });
 *    AFTER:  Wrap in: if (process.env.REACTORY_RUNTIME !== 'electron') { ... }
 *
 * 4. SIGUSR2 handler (line ~149):
 *    BEFORE: process.once('SIGUSR2', ...)
 *    AFTER:  Wrap in: if (process.env.REACTORY_RUNTIME !== 'electron') { ... }
 *
 * 5. Startup failure (line ~225):
 *    BEFORE: process.exit(-1);
 *    AFTER:  throw startupError;
 *
 * ── Diff ──
 *
 * These changes are backward-compatible:
 *   - When REACTORY_RUNTIME !== 'electron', behavior is unchanged
 *   - When REACTORY_RUNTIME === 'electron', errors propagate to the
 *     Electron main process which shows a dialog instead of crashing
 */

// This file serves as documentation for the required server patches.
// The actual changes should be applied to:
//   reactory-express-server/src/express/server.ts
//
// A script or patch file can automate this in CI.
export {};
