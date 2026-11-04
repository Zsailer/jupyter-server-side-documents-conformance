// The player's pure core: parsing cells and building the frames of a story. No DOM.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const NB = require('../player/nbscenario.js');

function stories() {
  const page = fs.readFileSync(path.join(__dirname, '..', 'examples', 'storyboards', 'site', 'index.html'), 'utf8');
  const m = /<script id="data" type="application\/json">([\s\S]*?)<\/script>/.exec(page);
  return JSON.parse(m[1].replace(/<\\\//g, '</'));
}
const data = stories();
const cfg = data.config;

test('a cell token is parsed by its mark and its note', () => {
  assert.deepEqual(NB.parseCell('c0'), { look: 'plain', name: 'c0', note: '' });
  assert.deepEqual(NB.parseCell('c0=+OFFLINE'), { look: 'edited', name: 'c0', note: '+OFFLINE' });
  assert.equal(NB.parseCell('+typed offline').look, 'new');
  assert.equal(NB.parseCell('-c1').look, 'gone');
  assert.equal(NB.parseCell('^c0').look, 'moved');
  assert.equal(NB.parseCell('?c1=recovered').look, 'copy');
  assert.equal(NB.parseCell('#c0=1 output').look, 'out');
  assert.equal(NB.parseCell('!c0=twice').look, 'bad');
  assert.equal(NB.parseCell('*a remark').look, 'remark');
});

test('typed text is drawn as a trailing comment; unknown names as print()', () => {
  const v = NB.viewOf('c1=+B-TYPED', NB.buildTimeline({ steps: [{ at: 'tab', kind: 'open', text: 'x' }], ends: { all: ['c0'] }, result: 'r' }).config);
  assert.equal(v.code, 'df = pd.read_csv(path)  # B-TYPED');
  assert.deepEqual(v.typed, ['# B-TYPED']);
  const w = NB.viewOf('ONLINE CELL', NB.buildTimeline({ steps: [{ at: 'tab', kind: 'open', text: 'x' }], ends: { all: ['c0'] }, result: 'r' }).config);
  assert.equal(w.code, 'print("ONLINE CELL")');
});

test('every storyboard builds a timeline: start, one frame per step, end', () => {
  const ids = Object.keys(data.stories);
  assert.ok(ids.length >= 60, 'expected the full set of stories');
  for (const id of ids) {
    const st = data.stories[id];
    const tl = NB.buildTimeline(st, cfg);
    assert.equal(tl.frames.length, st.steps.length + 2, id);
    assert.equal(tl.frames[0].kind, 'start');
    assert.equal(tl.frames[tl.frames.length - 1].end, true);
    assert.equal(tl.starts.length, tl.frames.length);
    assert.ok(tl.total > 3000, id);
  }
});

test('every frame draws every lane, and never leaks undefined', () => {
  for (const id of Object.keys(data.stories)) {
    const tl = NB.buildTimeline(data.stories[id], cfg);
    for (const f of tl.frames) {
      const html = NB.boardHTML(tl, f);
      for (const l of tl.lanes) assert.ok(html.includes('data-lane="' + l.id + '"'), id + ' lane ' + l.id);
      assert.ok(!/undefined|\[object/.test(html), id + ' frame ' + f.index);
    }
  }
});

test('the end frame holds what the story says it ends with', () => {
  const st = data.stories.Z1;
  const tl = NB.buildTimeline(st, cfg);
  const end = tl.frames[tl.frames.length - 1];
  const names = end.lanes.tab.cells.map(c => c.key);
  assert.deepEqual(names, ['c0', 'c2', 'c1'].filter(Boolean));
  assert.equal(end.lanes.tab.cells[2].look, 'moved');
  assert.ok(end.lanes.tab.cells[2].typed.length === 1, 'the typing is in the moved cell');
});

test('a person typing is animated; the system changing a cell is not', () => {
  const tl = NB.buildTimeline(data.stories.Z1, cfg);
  const typing = tl.frames.find(f => f.kind === 'type');
  assert.ok(NB.boardHTML(tl, typing).includes('nbs-tw'), 'typing frame has typed text');
  const merge = tl.frames.find(f => f.kind === 'note');
  assert.ok(!NB.boardHTML(tl, merge).includes('nbs-tw'), 'a merge by the server is not typed');
});

test('a reconnect is a blip and previews what differs before the jump', () => {
  const tl = NB.buildTimeline(data.stories.Z1, cfg);
  const rec = tl.frames.find(f => f.kind === 'reconnect');
  assert.equal(rec.blip, true);
  assert.ok(NB.boardHTML(tl, rec).includes('nbs-diff'));
  assert.ok(rec.ms < tl.frames.find(f => f.kind === 'type').ms + 1000, 'a blip is not given a long time');
});

test('a decision option replaces the ending', () => {
  const st = data.stories.Z3;
  const tl = NB.buildTimeline(st, cfg);
  const alt = st.decision.options.find(o => !o.proposed);
  const tl2 = NB.withEnding(tl, st, alt.ends);
  const keys = f => f.lanes.tab.cells.map(c => c.key + ':' + c.look).join();
  assert.notEqual(keys(tl.frames[tl.frames.length - 1]), keys(tl2.frames[tl2.frames.length - 1]));
  assert.equal(tl2.frames.length, tl.frames.length);
});

test('a story with a bad step is refused, with a message', () => {
  assert.throws(() => NB.buildTimeline({ steps: [{ at: 'tab', kind: 'dance', text: 'x' }], ends: {}, result: '' }), /unknown kind/);
  assert.throws(() => NB.buildTimeline({ lanes: { tab: 'A' }, steps: [{ at: 'server', kind: 'open', text: 'x' }], ends: {}, result: '' }), /not drawn/);
});

test('the triptych draws static windows with the typed text kept', () => {
  const html = NB.triptychHTML([
    { title: 'A', status: 'online', cells: ['c0'] },
    { title: 'B', status: 'offline', cells: ['c0=+OFFLINE'], active: 'c0', editing: true }
  ]);
  assert.equal((html.match(/nbs-panel/g) || []).length >= 2, true);
  assert.ok(html.includes('nbs-keep'));
  assert.ok(!html.includes('nbs-tw'));
});

test('when a story is over the file is saved again, whatever changed it on the way', () => {
  const tl = NB.buildTimeline(data.stories.AI4, cfg);
  const before = tl.frames[tl.frames.length - 2].lanes.file.status;
  assert.equal(before, 'changed');
  assert.equal(tl.frames[tl.frames.length - 1].lanes.file.status, 'saved');
});

test('the server holds nothing until a tab opens the notebook, then what the file holds', () => {
  const tl = NB.buildTimeline(data.stories.Z3, cfg);
  const server = f => f.lanes.server;
  assert.equal(server(tl.frames[0]).status, 'idle');
  assert.equal(server(tl.frames[0]).cells.length, 0);
  assert.equal(server(tl.frames[1]).status, 'holding');
  assert.deepEqual(server(tl.frames[1]).cells.map(c => c.code), tl.frames[1].lanes.file.cells.map(c => c.code), 'it loaded the notebook from the file');
});

test('a server that holds the notebook never shows a blank notebook; one that let go or died does', () => {
  for (const id of Object.keys(data.stories)) {
    const tl = NB.buildTimeline(data.stories[id], cfg);
    if (!tl.lanes.some(l => l.id === 'server')) continue;
    tl.frames.forEach(f => {
      const sv = f.lanes.server;
      if (sv.status === 'holding') assert.ok(sv.cells.length > 0, id + ' frame ' + f.index + ': holds the notebook but shows none');
      if (sv.status === 'idle' || sv.status === 'stopped') assert.equal(sv.cells.filter(c => !c.remark).length, 0, id + ' frame ' + f.index + ': is not holding it but shows cells');
    });
  }
});

test('an empty server window says why', () => {
  const tl = NB.buildTimeline(data.stories.Z3, cfg);
  assert.match(NB.boardHTML(tl, tl.frames[0]), /Not holding the notebook/);
});

test('a tab that opens the notebook shows what it loaded, not what it held before it closed', () => {
  const tl = NB.buildTimeline(data.stories.AI4, cfg);
  const open = tl.frames.find(f => f.kind === 'open' && f.index > 5);
  assert.equal(open.lanes.tab.cells.length, 5);
  assert.deepEqual(open.lanes.tab.cells.map(c => c.code), open.lanes.server.cells.map(c => c.code));
});
