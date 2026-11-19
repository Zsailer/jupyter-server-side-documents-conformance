import test from 'node:test';
import assert from 'node:assert/strict';
import { nearestStory, resolveStories } from '../bin/args.mjs';
import { byName, fileNameOf } from '../runtime/names.ts';

const all = [
  { id: 'handshake/answer-lost', group: 'handshake', aliases: ['B'] },
  { id: 'offline/second-tab-adds-cell', group: 'offline', aliases: ['C2'] },
  { id: 'offline/second-tab-types', group: 'offline', aliases: ['C3'] },
  { id: 'crash/dies-before-save', group: 'crash', aliases: ['S2'] },
  { id: 'agent/edits-open-notebook', group: 'agent', aliases: ['AI1'] },
  { id: 'agent/last-person-leaves', group: 'agent', aliases: ['AI4'] }
];

test('a story is found by its name, or by the name it had before', () => {
  assert.deepEqual(resolveStories(['crash/dies-before-save'], all), { ids: ['crash/dies-before-save'], unknown: [] });
  assert.deepEqual(resolveStories(['S2'], all), { ids: ['crash/dies-before-save'], unknown: [] });
});

test('a group, or a pattern, names every story it fits, in the suite order, once', () => {
  assert.deepEqual(resolveStories(['offline'], all).ids, ['offline/second-tab-adds-cell', 'offline/second-tab-types']);
  assert.deepEqual(resolveStories(['offline/*'], all).ids, ['offline/second-tab-adds-cell', 'offline/second-tab-types']);
  assert.deepEqual(resolveStories(['AI*'], all).ids, ['agent/edits-open-notebook', 'agent/last-person-leaves']);
  assert.deepEqual(resolveStories(['C3', 'offline', 'B'], all).ids, ['handshake/answer-lost', 'offline/second-tab-adds-cell', 'offline/second-tab-types']);
});

test('a pattern is the whole name, so one name is not found inside another', () => {
  assert.deepEqual(resolveStories(['S'], all), { ids: [], unknown: ['S'] });
  assert.deepEqual(resolveStories(['C'], all), { ids: [], unknown: ['C'] });
  assert.deepEqual(resolveStories(['dies-before-save'], all).unknown, ['dies-before-save']);
});

test('a word that names no story is said so, and the nearest name is suggested', () => {
  const { ids, unknown } = resolveStories(['crash/dies-before-save', 'crash/dies-before-sav'], all);
  assert.deepEqual(ids, ['crash/dies-before-save']);
  assert.deepEqual(unknown, ['crash/dies-before-sav']);
  assert.equal(nearestStory('crash/dies-before-sav', all), 'crash/dies-before-save');
  assert.equal(nearestStory('nothing-like-it-at-all', all), undefined);
});

test('a table written with an old name still has its entry for the story', () => {
  const story = { id: 'crash/dies-before-save', aliases: ['S2'] };
  assert.equal(byName({ 'crash/dies-before-save': 'by name', S2: 'by old name' }, story), 'by name');
  assert.equal(byName({ S2: 'by old name' }, story), 'by old name');
  assert.equal(byName({ S3: 'another story' }, story), undefined);
  assert.equal(byName(undefined, story), undefined);
  assert.equal(byName({ toString: 'inherited' } as Record<string, string>, { id: 'toString' }), 'inherited');
  assert.equal(byName({}, { id: 'toString' }), undefined);
});

test('a name is a file name without a folder in it', () => {
  assert.equal(fileNameOf({ id: 'crash/dies-before-save' }), 'crash-dies-before-save');
  assert.equal(fileNameOf({ id: 'A' }), 'a');
});
