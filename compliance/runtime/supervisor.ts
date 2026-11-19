import * as fs from 'node:fs';
import * as nodePath from 'node:path';

/**
 * How a story kills the server and starts it again, when the command that runs the tests started the server itself
 * (`jupyter conformance ssd run --backend ...` or `--start`). The command owns the process, so it does both; a test asks
 * through files in a folder both can see (COMPLIANCE_CONTROL_DIR), which needs no port and no help from the backend:
 *
 *   crash      the command kills the server's whole process group with SIGKILL (no save, no goodbye), then writes `crashed`
 *   restart    the command starts the same command again, on the same port and files, waits until it answers, then writes
 *              `restarted`
 *
 * A server somebody else started (`--url`) cannot be killed from here, so there the stories that need it are skipped.
 */
export const CONTROL_DIR = 'COMPLIANCE_CONTROL_DIR';

export function supervised(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env[CONTROL_DIR]);
}

/** Ask the command to do `request` and wait until it says `done`. */
export async function ask(request: 'crash' | 'restart', done: 'crashed' | 'restarted', timeoutMs: number, dir = process.env[CONTROL_DIR]): Promise<void> {
  if (!dir) {
    throw new Error(`${request}: the server was not started by the command that runs the tests (no ${CONTROL_DIR})`);
  }
  fs.rmSync(nodePath.join(dir, done), { force: true });
  fs.writeFileSync(nodePath.join(dir, request), '');
  const started = Date.now();
  while (!fs.existsSync(nodePath.join(dir, done))) {
    if (Date.now() - started > timeoutMs) {
      throw new Error(`the command that runs the tests did not ${request} the server within ${Math.round(timeoutMs / 1000)} s`);
    }
    await new Promise(r => setTimeout(r, 100));
  }
}
