/**
 * The compliance suite runs against a JupyterLab you already have running.
 *
 *   COMPLIANCE_BASE_URL   where it is (default http://localhost:8899)
 *   COMPLIANCE_ADAPTER    generic (default) | jsd | the path of your own adapter module
 *   COMPLIANCE_ROOT_DIR   the folder the server serves; lets the tests change the file from outside Jupyter
 *   COMPLIANCE_SERVER_CMD optional: a command that starts the server, which Playwright starts and stops for you
 *
 * The server must be started the way JupyterLab's own UI tests start it (no login, and the app exposed to the page):
 * `from jupyterlab.galata import configure_jupyter_server; configure_jupyter_server(c)` in its config.
 */
import { defineConfig } from '@playwright/test';

// galata's own Playwright configuration (CommonJS, untyped)
// eslint-disable-next-line @typescript-eslint/no-var-requires
const baseConfig: any = require('@jupyterlab/galata/lib/playwright-config');

const baseURL = process.env.COMPLIANCE_BASE_URL ?? 'http://localhost:8899';

export default defineConfig({
  ...baseConfig,
  testDir: './tests',
  // a story opens several browsers, goes offline, waits for saves: give it room
  timeout: Number(process.env.COMPLIANCE_STORY_TIMEOUT_MS ?? 240000),
  retries: 0,
  // every story works on a notebook of its own (galata's tmpPath), so stories can run side by side, also those of one file
  workers: Number(process.env.COMPLIANCE_WORKERS ?? 1),
  fullyParallel: true,
  // a click that cannot be made (something is in the way) fails with a message and a picture, not after the whole story's time
  use: { ...baseConfig.use, baseURL, actionTimeout: Number(process.env.COMPLIANCE_ACTION_TIMEOUT_MS ?? 30000) },
  webServer: process.env.COMPLIANCE_SERVER_CMD
    ? { command: process.env.COMPLIANCE_SERVER_CMD, url: `${baseURL}/lab`, timeout: 120000, reuseExistingServer: true }
    : undefined
});
