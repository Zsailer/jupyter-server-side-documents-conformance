import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
// @ts-ignore: plain JavaScript
import { watchControl } from '../bin/control.mjs';
// @ts-ignore: plain JavaScript
import { phasesFor } from '../bin/args.mjs';
import { ask, supervised } from '../runtime/supervisor.ts';

const dir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'control-test-'));

test('a request for a crash is done by the command and answered', async () => {
  const d = dir();
  const done: string[] = [];
  const stop = watchControl(d, { crash: async () => done.push('crash'), restart: async () => done.push('restart') }, 10);
  try {
    await ask('crash', 'crashed', 2000, d);
    await ask('restart', 'restarted', 2000, d);
    assert.deepEqual(done, ['crash', 'restart']);
    // a request is answered once: asking again does it again
    await ask('crash', 'crashed', 2000, d);
    assert.deepEqual(done, ['crash', 'restart', 'crash']);
  } finally {
    stop();
  }
});

test('a request that fails is still answered, so a story is not left waiting', async () => {
  const d = dir();
  const stop = watchControl(d, { crash: async () => { throw new Error('no'); }, restart: async () => undefined }, 10);
  const error = console.error;
  console.error = () => undefined;
  try {
    await ask('crash', 'crashed', 2000, d);
  } finally {
    console.error = error;
    stop();
  }
});

test('asking with nobody to answer gives up, and says so', async () => {
  await assert.rejects(ask('restart', 'restarted', 150, dir()), /did not restart the server/);
  await assert.rejects(ask('crash', 'crashed', 150, undefined as any), /was not started by the command/);
});

test('the server can be crashed only when the command started it', () => {
  assert.equal(supervised({}), false);
  assert.equal(supervised({ COMPLIANCE_CONTROL_DIR: '/x' }), true);
});

const all = [
  { id: 'A', group: 'handshake', requires: ['releaseRoom'] },
  { id: 'AI1', group: 'ai', requires: ['agent'] },
  { id: 'S2', group: 'crash', requires: ['crashServer'] },
  { id: 'AI7', group: 'ai', requires: ['agent', 'crashServer'] }
];

test('with one worker everything runs at once; with several, a story that kills the server runs alone, last', () => {
  assert.deepEqual(phasesFor(all, [], undefined, 1), [{ workers: 1, last: true }]);
  assert.deepEqual(phasesFor(all, [], undefined, 4), [
    { project: 'stories', workers: 4, last: false },
    { project: 'serial', workers: 1, last: true }
  ]);
});

test('a phase with nothing to run is not started', () => {
  assert.deepEqual(phasesFor(all, ['S2'], undefined, 4), [{ project: 'serial', workers: 1, last: true }]);
  assert.deepEqual(phasesFor(all, ['A'], undefined, 4), [{ workers: 4, last: true }]);
  assert.deepEqual(phasesFor(all, ['A'], 'ai', 4), [{ workers: 4, last: true }]);
  assert.equal(phasesFor(all, ['AI*'], undefined, 3).length, 2);
  assert.deepEqual(phasesFor(all, [], 'crash', 3), [{ project: 'serial', workers: 1, last: true }]);
});
