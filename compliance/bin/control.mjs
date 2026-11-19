// What the command does when a test asks it to kill the server or start it again (runtime/supervisor.ts has the asking side).
import fs from 'node:fs';
import path from 'node:path';

/**
 * Watch `dir` for requests. A request is a file named `crash` or `restart`: it is removed, done, and answered with a file
 * named `crashed` or `restarted`. One request at a time. Returns a function that stops watching.
 */
export function watchControl(dir, { crash, restart }, every = 100) {
  fs.mkdirSync(dir, { recursive: true });
  for (const name of ['crash', 'restart', 'crashed', 'restarted']) {
    fs.rmSync(path.join(dir, name), { force: true });
  }
  let busy = false;
  const timer = setInterval(async () => {
    if (busy) {
      return;
    }
    for (const [request, answer, action] of [['crash', 'crashed', crash], ['restart', 'restarted', restart]]) {
      const file = path.join(dir, request);
      if (!fs.existsSync(file)) {
        continue;
      }
      busy = true;
      fs.rmSync(file, { force: true });
      try {
        await action();
      } catch (error) {
        console.error(`\n  ${request} failed: ${error.message}`);
      }
      fs.writeFileSync(path.join(dir, answer), '');
      busy = false;
      return;
    }
  }, every);
  return () => clearInterval(timer);
}
