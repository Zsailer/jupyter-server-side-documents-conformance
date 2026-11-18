import test from 'node:test';
import assert from 'node:assert/strict';
import { createPicker, fitCount, reduce, render, visible } from '../bin/picker.mjs';
import { helpFor, parse, suggest } from '../bin/args.mjs';
import { logo, welcome } from '../bin/welcome.mjs';

const stories = [
  { id: 'A', group: 'handshake', groupTitle: 'Reconnecting', title: 'Control: a tab reconnects', requires: ['releaseRoom'] },
  { id: 'B', group: 'handshake', groupTitle: 'Reconnecting', title: 'The answer is lost', requires: ['releaseRoom', 'wireFaults'] },
  { id: 'C', group: 'handshake', groupTitle: 'Reconnecting', title: 'A second tab adds a cell', requires: [] },
  { id: 'Z3', group: 'residual', groupTitle: 'Edge cases', title: 'One deletes while another types', requires: ['releaseRoom'], proposed: true },
  { id: 'X1', group: 'stop', groupTitle: 'Shutting down', title: 'The queue', requires: [], internal: 'inside the server' }
];

const press = (state: any, ...keys: string[]) => keys.reduce((s, k) => reduce(s, k, 5).state, state);
const last = (state: any, ...keys: string[]) => {
  let out: any = { state };
  for (const k of keys) {
    out = reduce(out.state, k, 5);
  }
  return out;
};

test('space selects the story under the arrow and moves down', () => {
  const s = press(createPicker(stories), 'space', 'space');
  assert.deepEqual([...s.selected], ['A', 'B']);
  assert.equal(s.cursor, 2);
});

test('space on a selected story unselects it', () => {
  const s = press(createPicker(stories), 'space', 'up', 'space');
  assert.equal(s.selected.size, 0);
});

test('enter runs what is selected; with nothing selected it runs the story under the arrow', () => {
  assert.deepEqual([...last(createPicker(stories), 'space', 'enter').state.selected], ['A']);
  const alone = last(createPicker(stories), 'down', 'down', 'enter');
  assert.equal(alone.done, 'run');
  assert.deepEqual([...alone.state.selected], ['C']);
  assert.equal(last(createPicker(stories), 'space', 'space', 'enter').done, 'run');
});

test('a selects everything shown, and again unselects it', () => {
  const all = press(createPicker(stories), 'a');
  assert.equal(all.selected.size, 5);
  assert.equal(press(all, 'a').selected.size, 0);
});

test('g selects the whole group of the story under the arrow', () => {
  const s = press(createPicker(stories), 'down', 'g');
  assert.deepEqual([...s.selected].sort(), ['A', 'B', 'C']);
});

test('the filter narrows the list by id, title, group or need, and escape clears it', () => {
  const typed = (text: string) => press(createPicker(stories), '/', ...text.split(''));
  assert.deepEqual(visible(typed('release')).map(s => s.id), ['A', 'B', 'Z3']);
  assert.deepEqual(visible(typed('edge')).map(s => s.id), ['Z3']); // by the title of the group
  assert.deepEqual(visible(typed('x1')).map(s => s.id), ['X1']);
  const cleared = press(typed('release'), 'escape');
  assert.equal(visible(cleared).length, 5);
});

test('selecting under a filter keeps what was selected before it', () => {
  const s = press(createPicker(stories), 'space', '/', 'z', '3', 'enter', 'space');
  assert.deepEqual([...s.selected].sort(), ['A', 'Z3']);
});

test('typing a space or j into the filter is text, not a command', () => {
  const s = press(createPicker(stories), '/', 'j', 'space', 'k');
  assert.equal(s.filter, 'j k');
});

test('q and ctrl-c leave; escape leaves only when there is no filter to clear', () => {
  assert.equal(last(createPicker(stories), 'q').done, 'cancel');
  assert.equal(last(createPicker(stories), '/', 'a', 'ctrl-c').done, 'cancel');
  assert.equal(last(createPicker(stories), 'escape').done, 'cancel');
  const filtered = last(createPicker(stories), '/', 'a', 'enter', 'escape');
  assert.equal(filtered.done, undefined);
  assert.equal(filtered.state.filter, '');
});

test('the arrow stays inside the list', () => {
  assert.equal(press(createPicker(stories), 'up', 'up').cursor, 0);
  assert.equal(press(createPicker(stories), 'end').cursor, 4);
});

test('the window counts the titles of groups, so the list never outgrows the terminal', () => {
  // three lines: the title of the first group and two of its stories
  assert.equal(fitCount(stories, 0, 3), 2);
  // a new group costs a blank line and its title
  assert.equal(fitCount(stories, 2, 3), 1); // C, then Z3 would need 2 more lines
  assert.equal(fitCount(stories, 2, 5), 2); // C, then a blank, the title and Z3
  for (const budget of [4, 6, 8, 12]) {
    let s = createPicker(stories);
    for (let i = 0; i < 6; i++) {
      s = reduce(s, 'down', budget).state;
      const listLines = render(s, { color: false, budget }).slice(3, -2); // between the keys line and the count
      assert.ok(listLines.length <= budget, `budget ${budget}: ${listLines.length} lines`);
      assert.ok(render(s, { color: false, budget }).join('\n').includes('❯'), `the arrow is shown at budget ${budget}`);
    }
  }
});

test('the picker draws groups, what each story needs, and how many are selected', () => {
  const s = press(createPicker(stories), 'space');
  const text = render(s, { width: 100, budget: 14, color: false }).join('\n');
  assert.match(text, /RECONNECTING {2}· {2}3/);
  assert.match(text, /◉ A {5}Control: a tab reconnects {2}releaseRoom/);
  assert.match(text, /○ B/);
  assert.match(text, /Z3 {4}One deletes while another types {2}releaseRoom · proposed/);
  assert.match(text, /not checkable from outside/);
  assert.match(text, /1 selected/);
});

test('with nothing matching the picker says so, and enter does not run', () => {
  const s = press(createPicker(stories), '/', 'z', 'z', 'z', 'enter');
  assert.match(render(s, { color: false }).join('\n'), /No story matches/);
  const out = reduce(s, 'enter', 3);
  assert.equal(out.done, undefined);
  assert.match(out.state.hint, /Nothing matches/);
});

test('help is there for the whole command and for each part of it', () => {
  assert.match(helpFor('main'), /Start here/);
  assert.match(helpFor('run'), /Examples/);
  assert.match(helpFor('pick'), /space/);
  assert.match(helpFor('list'), /--filter/);
  assert.equal(helpFor('nonsense'), helpFor('main'));
});

test('arguments: help in every form, and the picker', () => {
  assert.deepEqual([parse(['help', 'run']).command, parse(['help', 'run']).topic], ['help', 'run']);
  assert.deepEqual([parse(['run', '--help']).command, parse(['run', '--help']).topic], ['help', 'run']);
  assert.equal(parse([]).command, 'welcome'); // nothing to do: say hello
  assert.equal(parse(['help']).topic, 'main');
  assert.equal(parse(['pick']).command, 'pick');
  assert.equal(parse(['run', '-i']).options.interactive, true);
  assert.equal(parse(['list', '--filter', 'offline']).options.filter, 'offline');
});

test('a mistyped command or option is met with a suggestion', () => {
  assert.equal(suggest('rn', ['run', 'pick', 'list']), 'run');
  assert.equal(suggest('lst', ['run', 'pick', 'list']), 'list');
  assert.equal(suggest('zebra', ['run', 'pick', 'list']), undefined);
  assert.throws(() => parse(['rn']), /Did you mean `run`\?/);
  assert.throws(() => parse(['run', '--hedaed']), /Did you mean --headed\?/);
  assert.throws(() => parse(['run', '--zzzzzz']), /unknown option --zzzzzz$/);
});

test('help fits an ordinary terminal', () => {
  for (const topic of ['main', 'run', 'pick', 'list']) {
    for (const line of helpFor(topic).split('\n')) {
      assert.ok(line.length <= 78, `${topic}: "${line}" is ${line.length} characters`);
    }
  }
});

test('the welcome screen has the logo, the name, the version and where to start', () => {
  const text = welcome({ version: '9.8.7', color: false }).join('\n');
  assert.match(text, /[\u2801-\u28ff]/); // the logo is drawn in braille
  assert.doesNotMatch(text, /[█▀▄]/); // and only as an outline: nothing is filled in
  assert.match(text, /conformance\s*\n/); // the name sits inside the arcs
  assert.match(text, /v9\.8\.7/);
  assert.match(text, /jupyter conformance ssd pick/);
  assert.match(text, /jupyter conformance ssd run Z3/);
  assert.match(text, /jupyter conformance ssd help/);
  assert.doesNotMatch(text, /\u001b/); // plain when there is no colour
});

test('the logo is two arcs with an empty middle, a block of the same width on every row', () => {
  const rows = logo({ color: false });
  assert.equal(rows.length, 12);
  assert.ok(new Set(rows.map(r => r.length)).size === 1, 'every row has the same width');
  assert.equal(rows[0].length, 33);
  assert.equal(rows[5].trim(), '', 'there is nothing between the arcs');
  assert.doesNotMatch(rows.join(''), /\u2800/, 'empty cells are spaces');
});

test('a label goes in the middle of a row of the logo, and nowhere else', () => {
  const plain = logo({ color: false });
  const labelled = logo({ color: false, labels: { 5: { text: 'hello', paint: (x: string) => x } } });
  assert.equal(labelled[5].trim(), 'hello');
  assert.equal(labelled[5].indexOf('hello'), 14); // (33 - 5) / 2
  assert.deepEqual(labelled.filter((_, i) => i !== 5), plain.filter((_, i) => i !== 5));
});

test('the welcome screen has colour when asked, and fits an ordinary terminal', () => {
  const coloured = welcome({ version: '1.0.0', color: true }).join('\n');
  assert.match(coloured, /\u001b\[38;5;208m/); // the orange crescents
  assert.match(coloured, /\u001b\[38;5;250m/); // the gray circles
  for (const line of welcome({ version: '10.20.30', color: false })) {
    assert.ok(line.length <= 78, `"${line}" is ${line.length} characters`);
  }
});

test('before anything is selected the picker says how to select several', () => {
  const text = render(createPicker(stories), { color: false, budget: 14 }).join('\n');
  assert.match(text, /space selects several/);
  assert.match(text, /enter runs the one under the arrow/);
  assert.doesNotMatch(render(press(createPicker(stories), 'space'), { color: false, budget: 14 }).join('\n'), /space selects several/);
});
