import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';

const CLI = path.join(import.meta.dirname, '..', 'bin', 'conformance.mjs');

const alive = (marker: string) => spawnSync('pgrep', ['-f', marker], { encoding: 'utf8' }).stdout.trim() !== '';

// the server a command starts must not outlive it, also when it is interrupted while the server is still starting up
for (const [signal, code, marker] of [
  ['SIGINT', 130, 'sleep 41701'],
  ['SIGTERM', 143, 'sleep 41702']
] as const) {
  test(`${signal} while the server is starting stops the server`, async () => {
    spawnSync('pkill', ['-f', marker]); // one left by an earlier run would look like the one this test starts
    const child = spawn('node', [CLI, 'run', 'Z3', '--start', marker], { stdio: 'ignore' });
    const exited = new Promise<number | null>(resolve => child.on('exit', c => resolve(c)));
    // the stand-in "server" is running and never answers: give the command time to start it
    for (let i = 0; i < 50 && !alive(marker); i++) {
      await new Promise(r => setTimeout(r, 100));
    }
    assert.ok(alive(marker), 'the stand-in server was started');
    child.kill(signal);
    assert.equal(await exited, code);
    await new Promise(r => setTimeout(r, 500));
    const left = alive(marker);
    if (left) {
      spawnSync('pkill', ['-f', marker]);
    }
    assert.equal(left, false, 'the server was left running');
  });
}
