/**
 * Loaded by mocha before any test file
 *
 * The test harness connects over plain ws://, so mark this as a test run (the only case outside
 * Colyseus Cloud where the server allows plain HTTP) and clear the local certificate settings
 * before app.config.ts creates its transport. Empty values also stop .env from filling them in
 *
 * Dev tools are cleared too, so tests see the production routes whatever server/.env says, and
 * ALLOWED_ORIGINS is set to a fixed test origin
 */

/**
 * The only origin the test server allows
 */
export const allowedTestOrigin = 'https://allowed.example';

process.env.NODE_ENV = 'test';
process.env.SSL_KEY_FILE = '';
process.env.SSL_CERT_FILE = '';
process.env.ENABLE_DEV_TOOLS = '';
process.env.ALLOWED_ORIGINS = allowedTestOrigin;
