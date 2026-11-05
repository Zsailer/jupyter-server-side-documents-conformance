// The page that lets a story be watched: every tab's video side by side, one clock, the storyboard step underneath.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { Recorder, watchPage } from '../runtime/recording.ts';

function folder(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'recording-'));
}

test('there is nothing to watch without a video', () => {
  const r = new Recorder(folder(), 'Z3');
  r.tabs.push({ name: 'tab', startedAt: r.t0, file: null });
  assert.equal(r.finish(), null);
});

test('the videos of the tabs are side by side, each starting when its tab was opened', () => {
  const dir = folder();
  const r = new Recorder(dir, 'Z3 · a story');
  const a = path.join(dir, 'a.webm');
  const b = path.join(dir, 'b.webm');
  fs.writeFileSync(a, 'AAAA');
  fs.writeFileSync(b, 'BBBB');
  r.tabs.push({ name: 'tab2', startedAt: r.t0 + 4000, file: b }, { name: 'tab', startedAt: r.t0 + 500, file: a });
  r.steps.push({ at: r.t0 + 600, text: '1. First tab opens the notebook' }, { at: r.t0 + 4100, text: '2. Second tab opens the same notebook' });
  const out = r.finish()!;
  const html = fs.readFileSync(out, 'utf8');
  assert.equal(path.basename(out), 'watch.html');
  assert.ok(html.indexOf('<figcaption>tab</figcaption>') < html.indexOf('<figcaption>tab2</figcaption>'), 'in the order the tabs were opened');
  assert.match(html, /"offsets":\[0\.5,4\]/);
  assert.match(html, /1\. First tab opens the notebook/);
  assert.ok(html.includes('data:video/webm;base64,' + Buffer.from('AAAA').toString('base64')), 'embedded, so the page works wherever it is opened');
});

test('a page of the steps cannot be broken by what a step says', () => {
  const html = watchPage('t', [{ name: 'tab', offset: 0, src: 'x.webm' }], [{ at: 0, text: '</script><b>boom</b>' }]);
  assert.ok(!html.includes('</script><b>boom'), 'markup in a step is not markup in the page');
});

test('a tab that was opened twice is two videos', () => {
  const dir = folder();
  const r = new Recorder(dir);
  const f = path.join(dir, 'v.webm');
  fs.writeFileSync(f, 'V');
  r.tabs.push({ name: 'tab', startedAt: r.t0, file: f }, { name: 'tab (2)', startedAt: r.t0 + 9000, file: f });
  const html = fs.readFileSync(r.finish()!, 'utf8');
  assert.match(html, /<figcaption>tab \(2\)<\/figcaption>/);
});
