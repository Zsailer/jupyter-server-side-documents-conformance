import test from 'node:test';
import assert from 'node:assert/strict';
import { NAME_WIDTH, reason, rowLines, rowOf, summaryLines, wrapList } from '../runtime/report.ts';
import { grepFor, parse, workersFor } from '../bin/args.mjs';

const plain = { color: false };
const t = (title: string, over: Record<string, unknown> = {}) => ({ title, annotations: [], expectedStatus: 'passed', ...over });
const r = (status: string, over: Record<string, unknown> = {}) => ({ status, duration: 1500, ...over });

test('a passing story is one line with its name and time: the name says what it is about', () => {
  const row = rowOf(t('conflict/delete-while-typing · A tab comes back'), r('passed'));
  assert.deepEqual(rowLines(row, plain), [`  ✓ ${'conflict/delete-while-typing'.padEnd(NAME_WIDTH)} 1.5s`]);
});

test('a story that did not pass says in words which one it is, and then why', () => {
  const row = rowOf(t('crash/dies-before-save · The server dies before it saved'), r('failed', { error: { message: 'Error: tab: 2 cells' } }));
  assert.deepEqual(rowLines(row, plain).slice(1), ['    The server dies before it saved', '    tab: 2 cells']);
});

test('a failing story says why, with the step first', () => {
  const message = '\u001b[31mError: step 4. Second tab adds a cell\u001b[0m\n\nlocator.click: Timeout 30000ms exceeded.';
  assert.equal(reason(message), 'step 4. Second tab adds a cell — locator.click: Timeout 30000ms exceeded.');
  const row = rowOf(t('C2 · A second tab adds a cell'), r('failed', { error: { message } }));
  assert.equal(row.kind, 'fail');
  assert.match(rowLines(row, plain)[2], /step 4/);
});

test('a story that is skipped carries the reason, and only the summary shows it', () => {
  const row = rowOf(t('crash/dies-before-save · Crash', { annotations: [{ type: 'skip', description: 'adapter "jsd" cannot: crashServer' }] }), r('skipped'));
  assert.equal(row.kind, 'skip');
  const lines = summaryLines([row, { ...row, id: 'crash/server-edit-survives' }, rowOf(t('A · x'), r('passed'))], 61000, plain).join('\n');
  assert.match(lines, /1 passed {2}· {2}2 skipped {3}1m 01s/);
  assert.match(lines, /2 {2}adapter "jsd" cannot: crashServer\n {8}crash\/dies-before-save, crash\/server-edit-survives/);
});

test('a known gap that fails is fine, and one that passes is stale', () => {
  const gap = [{ type: 'known-gap', description: 'lost across a rebuild' }];
  assert.equal(rowOf(t('C2 · x', { annotations: gap, expectedStatus: 'failed' }), r('failed')).kind, 'gap');
  const stale = rowOf(t('C2 · x', { annotations: gap, expectedStatus: 'failed' }), r('passed'));
  assert.equal(stale.kind, 'fail');
  assert.match(stale.detail, /remove it from the known gaps/);
});

test('a proposed case that is not met is reported, not failed', () => {
  const row = rowOf(t('FLOW1 · x', { annotations: [{ type: 'proposed-not-met', description: 'tab: 2 cells, expected 3' }] }), r('passed'));
  assert.equal(row.kind, 'miss');
  assert.match(rowLines(row, plain)[2], /proposed, not met: tab: 2 cells/);
});

test('the summary names only what happened', () => {
  const lines = summaryLines([rowOf(t('A · x'), r('passed'))], 2000, plain).join('\n');
  assert.doesNotMatch(lines, /failed|skipped|gap/);
});

test('arguments: a command, stories and options', () => {
  const p = parse(['run', 'Z3', 'AI*', '--group', 'edges', '--headed', '--url=http://x:1']);
  assert.equal(p.command, 'run');
  assert.deepEqual(p.stories, ['Z3', 'AI*']);
  assert.deepEqual(p.options, { group: 'edges', headed: true, url: 'http://x:1' });
});

test('arguments: workers is a whole number of at least 1, or max', () => {
  assert.equal(parse(['run', '--workers', '4']).options.workers, '4');
  assert.equal(parse(['run', '--workers', 'max']).options.workers, 'max');
  for (const bad of ['0', '-1', 'two', '1.5']) {
    assert.throws(() => parse(['run', `--workers=${bad}`]), /--workers needs a whole number/);
  }
});

test('workers: max is as many as the machine has processors, and at least one', () => {
  assert.equal(workersFor('max', 4), 4);
  assert.equal(workersFor('max', 0), 1);
  assert.equal(workersFor('3', 16), 3);
  assert.equal(workersFor(undefined, 16), 1);
});

test('arguments: mistakes say what is wrong', () => {
  assert.throws(() => parse(['run', '--bogus']), /unknown option --bogus/);
  assert.throws(() => parse(['run', '--url']), /--url needs a value/);
  assert.throws(() => parse(['go']), /unknown command "go"/);
  assert.equal(parse([]).command, 'welcome');
  assert.equal(parse(['-v']).command, 'version');
});

test('the grep picks exactly the stories named, and a prefix with a star', () => {
  assert.equal(grepFor([], undefined), undefined);
  const re = new RegExp(grepFor(['Z3', 'AI*'], undefined) as string);
  const title = (id: string) => ` generated/x.spec.ts ${id} · Something @compliance`;
  assert.ok(re.test(title('Z3')) && re.test(title('AI5')));
  assert.ok(!re.test(title('Z30')) && !re.test(title('XZ3')) && !re.test(title('C2')));
  const grouped = new RegExp(grepFor(['C2'], 'handshake') as string);
  assert.ok(grouped.test(' generated/h.spec.ts C2 · x @compliance @group-handshake'));
  assert.ok(!grouped.test(' generated/e.spec.ts C2 · x @compliance @group-edges'));
});

test('a leading ssd names the suite, and is optional', () => {
  assert.deepEqual(parse(['ssd', 'run', 'Z3']).stories, ['Z3']);
  assert.equal(parse(['ssd', 'run', 'Z3']).command, 'run');
  assert.deepEqual(parse(['run', 'Z3']), parse(['ssd', 'run', 'Z3']));
  assert.equal(parse(['ssd']).command, 'welcome');
  assert.equal(parse(['ssd', 'help', 'run']).topic, 'run');
});

test('the names of skipped stories wrap onto lines of their own, none cut off', () => {
  const names = Array.from({ length: 9 }, (_, i) => `history/a-story-with-a-name-${i}`);
  const lines = wrapList(names, 70);
  assert.ok(lines.length > 1 && lines.every(l => l.length <= 71));
  assert.deepEqual(lines.join(' ').replace(/,\s*/g, ' ').split(' '), names);
});
