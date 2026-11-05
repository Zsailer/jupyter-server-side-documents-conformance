// The matcher that decides whether a notebook is what a story says it must be. No browser.
import test from 'node:test';
import assert from 'node:assert/strict';
import { E, cellMatches, matchCells, notebookJSON, sourceText, typed } from '../runtime/cells.ts';

test('a cell is compared as written, ignoring the whitespace around it', () => {
  assert.equal(cellMatches('c0\n', 'c0'), true);
  assert.equal(cellMatches(' c0 ', 'c0'), true);
  assert.equal(cellMatches('c0 +B', 'c0'), false);
  assert.equal(cellMatches('c0', 'c0 +B'), false);
  assert.equal(cellMatches('a\r\nb', 'a\nb'), true);
});

test('typing from two people may land in either order', () => {
  const e = E.parts('c1', '+A-OFFLINE', '+B-ONLINE');
  assert.equal(cellMatches('c1 +A-OFFLINE +B-ONLINE', e), true);
  assert.equal(cellMatches('c1 +B-ONLINE +A-OFFLINE', e), true);
  assert.equal(cellMatches('c1 +A-OFFLINE', e), false, 'one of the two is lost');
  assert.equal(cellMatches('x c1 +A-OFFLINE +B-ONLINE', e), false, 'it must still start with what was there');
});

test('a recovered copy is found by what it holds, whatever it is wrapped in', () => {
  const e = E.contains('c1', '+OFFLINE');
  assert.equal(cellMatches('# recovered: your version\nc1 +OFFLINE', e), true);
  assert.equal(cellMatches('c1', e), false);
});

test('cells are compared in order, with a reason a person can read', () => {
  assert.deepEqual(matchCells(['c0', 'c1'], ['c0', 'c1']), { ok: true, reason: '' });
  const wrong = matchCells(['c0', 'c2'], ['c0', 'c1']);
  assert.equal(wrong.ok, false);
  assert.match(wrong.reason, /cell 2 reads "c2", expected "c1"/);
  assert.match(matchCells(['c0'], ['c0', 'c1']).reason, /1 cells, expected 2/);
});

test('a duplicate is a failure: the same count, the wrong cells', () => {
  assert.equal(matchCells(['c0', 'c1', 'c1'], ['c0', 'c1', 'c2']).ok, false);
  assert.equal(matchCells(['c0', 'c1', 'c1', 'c2'], ['c0', 'c1', 'c2']).ok, false);
});

test('when the order does not matter any assignment will do', () => {
  assert.equal(matchCells(['c1', 'c0', 'c2'], ['c0', 'c1', 'c2'], false).ok, true);
  assert.equal(matchCells(['c1', 'c1', 'c2'], ['c0', 'c1', 'c2'], false).ok, false);
});

test('typed text is set off from what is there by a space', () => {
  assert.equal(typed('+B-TYPED'), ' +B-TYPED');
});

test('a source may arrive as lines', () => {
  assert.equal(sourceText(['a\n', 'b']), 'a\nb');
  assert.equal(sourceText('a'), 'a');
  assert.equal(sourceText(undefined), '');
});

test('the notebook a story starts from has the cells, with ids or without', () => {
  const withIds = JSON.parse(notebookJSON(['c0', 'c1']));
  assert.deepEqual(withIds.cells.map((c: any) => c.source), ['c0', 'c1']);
  assert.ok(withIds.cells.every((c: any) => typeof c.id === 'string'));
  assert.equal(withIds.nbformat_minor, 5);
  const without = JSON.parse(notebookJSON(['c0'], false));
  assert.equal(without.cells[0].id, undefined);
  assert.equal(without.nbformat_minor, 4);
});
