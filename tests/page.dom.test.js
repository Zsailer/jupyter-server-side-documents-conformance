// The built page, run in a simulated browser: the stories mount, play, pause and seek; the page's theme, search and
// filter work; a decision swaps the ending.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM, VirtualConsole } = require('jsdom');

const SITE = path.join(__dirname, '..', 'examples', 'storyboards', 'site', 'index.html');
const sleep = ms => new Promise(r => setTimeout(r, ms));

const opened = [];
test.after(() => opened.forEach(w => w.close()));

function open() {
  const errors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', e => errors.push(String(e.stack || e)));
  vc.on('error', (...a) => errors.push(a.join(' ')));
  const dom = new JSDOM(fs.readFileSync(SITE, 'utf8'), { runScripts: 'dangerously', pretendToBeVisual: true, url: 'http://localhost/', virtualConsole: vc });
  opened.push(dom.window);
  return { dom, win: dom.window, doc: dom.window.document, errors };
}
const widths = card => [...card.querySelectorAll('.nbs-fill')].map(f => f.style.width).join(',');

test('every story mounts without an error', async () => {
  const { doc, errors } = open();
  await sleep(200);
  const cards = [...doc.querySelectorAll('.story-card')];
  assert.ok(cards.length >= 60);
  for (const c of cards) {
    assert.ok(c.querySelector('.nbs-board'), c.id + ' has a board');
    const steps = c.querySelectorAll('.nbs-steps li').length;
    assert.equal(c.querySelectorAll('.nbs-seg').length, steps + 2, c.id + ' has start, a segment per step, end');
  }
  assert.deepEqual(errors, []);
});

test('pause freezes the story, play resumes it', async () => {
  const { doc } = open();
  const card = doc.getElementById('Z1');
  await sleep(300);
  const play = card.querySelector('.nbs-play');
  play.click(); // pause
  const frozen = widths(card);
  const caption = card.querySelector('.nbs-caption').textContent;
  await sleep(500);
  assert.equal(widths(card), frozen, 'the bar does not move while paused');
  assert.equal(card.querySelector('.nbs-caption').textContent, caption);
  assert.ok(card.classList.contains('nbs-pausedall'), 'animations are frozen too');
  play.click(); // play
  await sleep(500);
  assert.notEqual(widths(card), frozen, 'the bar moves again');
});

test('clicking a step jumps to it', async () => {
  const { doc } = open();
  const card = doc.getElementById('Z1');
  await sleep(100);
  card.querySelectorAll('.nbs-seg')[3].click();
  assert.ok(card.querySelectorAll('.nbs-seg')[3].classList.contains('on'));
  assert.match(card.querySelector('.nbs-caption').textContent, /loses its connection|types|moves|opens/);
  card.querySelectorAll('.nbs-seg')[card.querySelectorAll('.nbs-seg').length - 1].click();
  assert.ok(card.classList.contains('nbs-ended'));
  assert.ok(card.querySelector('.nbs-endseg.on'));
});

test('the reconnect step is drawn as a blip', async () => {
  const { doc } = open();
  const card = doc.getElementById('Z1');
  const blips = [...card.querySelectorAll('.nbs-seg.nbs-blip')];
  assert.ok(blips.length >= 1);
  blips[0].click();
  assert.ok(card.classList.contains('nbs-instant'));
  assert.match(card.querySelector('.nbs-caption').textContent, /over in a moment/);
  assert.ok(card.querySelector('.nbs-diff'), 'what differs is shown before the jump');
});

test('the theme can be set, and is remembered', async () => {
  const { doc, win } = open();
  doc.querySelector('[data-theme-set="dark"]').click();
  assert.equal(doc.documentElement.dataset.theme, 'dark');
  assert.equal(win.localStorage.getItem('nbs-theme'), 'dark');
  doc.querySelector('[data-theme-set="light"]').click();
  assert.equal(doc.documentElement.dataset.theme, 'light');
  doc.querySelector('[data-theme-set="auto"]').click();
  assert.equal(doc.documentElement.dataset.theme, undefined);
  assert.equal(win.localStorage.getItem('nbs-theme'), null);
});

test('search and the needs-alignment filter hide what does not match', async () => {
  const { doc, win } = open();
  const all = doc.querySelectorAll('.story-card').length;
  doc.querySelector('[data-filter="need"]').click();
  const visible = [...doc.querySelectorAll('.story-card')].filter(c => !c.hidden);
  assert.ok(visible.length > 0 && visible.length < all);
  assert.ok(visible.every(c => c.querySelector('.nbs-decision')));
  doc.querySelector('[data-filter="all"]').click();
  const q = doc.getElementById('q');
  q.value = 'zzzz-nothing';
  q.dispatchEvent(new win.Event('input'));
  assert.equal([...doc.querySelectorAll('.story-card')].filter(c => !c.hidden).length, 0);
  assert.equal(doc.getElementById('empty').hidden, false);
});

test('choosing another option of a decision shows its ending', async () => {
  const { doc } = open();
  const card = doc.getElementById('Z3');
  const opts = card.querySelectorAll('.nbs-opt');
  assert.ok(opts.length >= 2);
  const text = () => card.querySelector('.nbs-board').textContent;
  card.querySelectorAll('.nbs-seg')[card.querySelectorAll('.nbs-seg').length - 1].click();
  const before = text();
  [...opts].find(o => !o.classList.contains('nbs-proposed')).click();
  assert.ok(card.classList.contains('nbs-ended'));
  assert.notEqual(text(), before, 'the ending changed');
  assert.match(card.querySelector('.nbs-board').textContent, /recovered/);
});

test('with reduced motion a story starts at its end and nothing types', async () => {
  const { win, doc } = open();
  const el = doc.createElement('div');
  doc.body.appendChild(el);
  const st = JSON.parse(doc.getElementById('data').textContent).stories.Z1;
  win.NbScenario.mount(el, st, { reduced: true });
  assert.ok(el.classList.contains('nbs-ended'));
  assert.equal(el.querySelectorAll('.nbs-tw').length, 0);
});

test('the minimal example draws its picture and plays its story', async () => {
  const errors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', e => errors.push(String(e.stack || e)));
  const dom = await JSDOM.fromFile(path.join(__dirname, '..', 'examples', 'minimal', 'index.html'), {
    runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true, virtualConsole: vc
  });
  opened.push(dom.window);
  await new Promise(r => (dom.window.document.readyState === 'complete' ? r() : dom.window.addEventListener('load', r)));
  const doc = dom.window.document;
  assert.equal(doc.querySelectorAll('#picture .nbs-panel').length, 3);
  assert.ok(doc.querySelector('[data-nbs] .nbs-board'));
  assert.ok(doc.querySelectorAll('[data-nbs] .nbs-seg').length >= 8);
  assert.match(doc.querySelector('#picture').textContent, /Your typing is still there/);
  assert.deepEqual(errors, []);
});

test('every window of a story gets the height of the tallest, so nothing grows or shrinks while it plays', async () => {
  const { win, doc } = open();
  // jsdom does no layout: say that a window is taller the more cells it holds
  Object.defineProperty(win.HTMLElement.prototype, 'offsetWidth', { configurable: true, get() { return 900; } });
  Object.defineProperty(win.HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    get() {
      return this.classList && this.classList.contains('nbs-panel') ? 60 + 40 * this.querySelectorAll('.nbs-cell').length : 20;
    }
  });
  const el = doc.createElement('div');
  doc.body.appendChild(el);
  const st = JSON.parse(doc.getElementById('data').textContent).stories.Z3;
  const ctrl = win.NbScenario.mount(el, st, { autoplay: false });
  ctrl.measure();
  const h = parseInt(el.querySelector('.nbs-board').style.getPropertyValue('--nbs-h'), 10);
  // the most any frame of Z3 holds in a window is four cells (two tabs typing and deleting, plus the recovered copy of an option)
  assert.ok(h >= 60 + 40 * 3, 'tall enough for the fullest window, got ' + h);
  assert.ok(h <= 560);
});
