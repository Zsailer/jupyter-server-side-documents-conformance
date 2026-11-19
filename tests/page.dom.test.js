// The built page, run in a simulated browser: the stories mount, play, pause and seek; the page's theme, search and
// filter work; a decision swaps the ending.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM, VirtualConsole } = require('jsdom');

const SITE = path.join(__dirname, '..', 'examples', 'storyboards', 'site', 'stories.html');
const sleep = ms => new Promise(r => setTimeout(r, ms));

const opened = [];
test.after(() => opened.forEach(w => w.close()));

function open(url = 'http://localhost/') {
  const errors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', e => errors.push(String(e.stack || e)));
  vc.on('error', (...a) => errors.push(a.join(' ')));
  const dom = new JSDOM(fs.readFileSync(SITE, 'utf8'), { runScripts: 'dangerously', pretendToBeVisual: true, url, virtualConsole: vc });
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

test('a link with the name a story had before goes to the story under its name now', async () => {
  const { win, doc, errors } = open('http://localhost/stories.html#Z3');
  await sleep(100);
  assert.equal(decodeURIComponent(win.location.hash), '#conflict/delete-while-typing');
  assert.ok(doc.getElementById('conflict/delete-while-typing'), 'the story is there');
  // a link that names nothing stays as it is
  assert.equal(decodeURIComponent(open('http://localhost/stories.html#nothing-like-it').win.location.hash), '#nothing-like-it');
  assert.deepEqual(errors, []);
});

test('pause freezes the story, play resumes it', async () => {
  const { doc } = open();
  const card = doc.getElementById('conflict/move-while-typing');
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
  const card = doc.getElementById('conflict/move-while-typing');
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
  const card = doc.getElementById('conflict/move-while-typing');
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
  const card = doc.getElementById('conflict/delete-while-typing');
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
  const st = JSON.parse(doc.getElementById('data').textContent).stories['conflict/move-while-typing'];
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
  const st = JSON.parse(doc.getElementById('data').textContent).stories['conflict/delete-while-typing'];
  const ctrl = win.NbScenario.mount(el, st, { autoplay: false });
  ctrl.measure();
  const h = parseInt(el.querySelector('.nbs-board').style.getPropertyValue('--nbs-h'), 10);
  // the most any frame of Z3 holds in a window is four cells (two tabs typing and deleting, plus the recovered copy of an option)
  assert.ok(h >= 60 + 40 * 3, 'tall enough for the fullest window, got ' + h);
  assert.ok(h <= 560);
});

test('what a lane does is said above its window, in a row every lane has, so no window\'s cells move', async () => {
  const { doc } = open();
  const card = doc.getElementById('conflict/move-while-typing');
  const segs = card.querySelectorAll('.nbs-seg');
  segs[3].click(); // a step in which a tab goes offline
  const board = card.querySelector('.nbs-board');
  const lanes = board.querySelectorAll('.nbs-col-lane');
  assert.equal(lanes.length, board.querySelectorAll('.nbs-panel').length);
  lanes.forEach(l => {
    assert.equal(l.querySelectorAll(':scope > .nbs-actrow').length, 1, 'one row above every window');
    assert.ok(l.firstElementChild.classList.contains('nbs-actrow'), 'and it comes first');
  });
  const pill = board.querySelector('.nbs-act');
  assert.ok(pill, 'the acting lane says what it does');
  assert.equal(pill.closest('.nbs-panel'), null, 'outside the window');
  assert.match(pill.textContent, /goes offline|opens|types/);
});

test('the reading guide is its own page: the picture, the key to the cells, the principles', async () => {
  const errors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', e => errors.push(String(e.stack || e)));
  const dom = await JSDOM.fromFile(path.join(path.dirname(SITE), 'about.html'), { runScripts: 'dangerously', pretendToBeVisual: true, url: 'http://localhost/', virtualConsole: vc });
  opened.push(dom.window);
  const doc = dom.window.document;
  assert.equal(doc.querySelectorAll('#hero-trip .nbs-panel').length, 3);
  assert.equal(doc.querySelectorAll('#legend .row').length, 6);
  assert.ok(doc.querySelectorAll('.principle').length >= 5);
  assert.ok(doc.querySelectorAll('.need-list a').length >= 8);
  doc.querySelector('[data-theme-set="dark"]').click();
  assert.equal(doc.documentElement.dataset.theme, 'dark');
  assert.deepEqual(errors, []);
});

test('the stories page has no explainer above the stories, only a way to it', async () => {
  const { doc } = open();
  assert.equal(doc.getElementById('principles'), null);
  assert.equal(doc.getElementById('how'), null);
  const links = [...doc.querySelectorAll('.hero a')].map(a => a.getAttribute('href'));
  assert.ok(links.every(h => h.startsWith('about.html')));
  assert.ok(doc.querySelector('.hero').nextElementSibling.id === 'stories', 'the stories come straight after the title');
});

test('the end says whether every copy holds the same cells', async () => {
  const { doc } = open();
  const a = doc.getElementById('handshake/reconnect-after-rebuild-control');
  a.querySelectorAll('.nbs-seg')[a.querySelectorAll('.nbs-seg').length - 1].click();
  assert.match(a.querySelector('.nbs-caption').textContent, /every copy holds the same 3 cells/);
});

test('a message is drawn as an envelope that gets lost on the way when the story says it is lost', async () => {
  const { win, doc } = open();
  win.Element.prototype.animate = function () { return { pause() {}, currentTime: 0 }; };
  const el = doc.createElement('div');
  doc.body.appendChild(el);
  const st = JSON.parse(doc.getElementById('data').textContent).stories['handshake/answer-lost'];
  const ctrl = win.NbScenario.mount(el, st, { autoplay: false });
  const frames = [...st.steps.keys()].map(i => i + 1);
  const lostAt = frames.find(i => st.steps[i - 1].kind === 'fault');
  const normalAt = frames.find(i => st.steps[i - 1].kind === 'reconnect');
  ctrl.seek(normalAt);
  assert.equal(el.querySelectorAll('.nbs-dot').length, 1);
  assert.equal(el.querySelectorAll('.nbs-lostx').length, 0);
  ctrl.seek(lostAt);
  assert.equal(el.querySelectorAll('.nbs-lostx').length, 1, 'a cross where it was lost');
});

test('the list of stories can be hidden, and that is remembered', async () => {
  const { doc, win } = open();
  const layout = doc.querySelector('.layout');
  const toggle = doc.getElementById('sideToggle');
  assert.equal(toggle.getAttribute('aria-expanded'), 'true');
  assert.ok(!layout.classList.contains('side-collapsed'));
  toggle.click();
  assert.ok(layout.classList.contains('side-collapsed'));
  assert.equal(toggle.getAttribute('aria-expanded'), 'false');
  assert.equal(win.localStorage.getItem('nbs-side'), 'false');
  toggle.click();
  assert.ok(!layout.classList.contains('side-collapsed'));
  assert.equal(win.localStorage.getItem('nbs-side'), 'true');
});

test('each group of the list can be folded, and all of them at once', async () => {
  const { doc, win } = open();
  const group = doc.querySelector('.nav-group');
  const chev = group.querySelector('.nav-chev');
  assert.ok(!group.classList.contains('folded'));
  chev.click();
  assert.ok(group.classList.contains('folded'));
  assert.equal(chev.getAttribute('aria-expanded'), 'false');
  assert.ok(JSON.parse(win.localStorage.getItem('nbs-nav-folded')).includes(group.dataset.group));
  chev.click();
  assert.ok(!group.classList.contains('folded'));
  const groups = [...doc.querySelectorAll('.nav-group')];
  doc.getElementById('foldAll').click();
  assert.ok(groups.every(g => g.classList.contains('folded')));
  doc.getElementById('unfoldAll').click();
  assert.ok(groups.every(g => !g.classList.contains('folded')));
});

test('searching shows every match even in a folded group; going to a story opens its group', async () => {
  const { doc, win } = open();
  doc.getElementById('foldAll').click();
  const q = doc.getElementById('q');
  q.value = 'move';
  q.dispatchEvent(new win.Event('input'));
  assert.ok(doc.getElementById('side').classList.contains('filtering'), 'folds do not hide search results');
  q.value = '';
  q.dispatchEvent(new win.Event('input'));
  assert.ok(!doc.getElementById('side').classList.contains('filtering'));
  const z3 = doc.querySelector('.nav-story[data-id="conflict/delete-while-typing"]').closest('.nav-group');
  assert.ok(z3.classList.contains('folded'));
  win.location.hash = '#conflict/delete-while-typing';
  win.dispatchEvent(new win.HashChangeEvent('hashchange'));
  assert.ok(!z3.classList.contains('folded'), 'the group of the story you went to is open');
});

test('the button that hides the list is a hamburger icon, first in the bar, on the left', async () => {
  const { doc } = open();
  const toggle = doc.getElementById('sideToggle');
  assert.equal(doc.querySelector('.topbar').firstElementChild, toggle);
  assert.ok(toggle.querySelector('svg'));
  assert.equal(toggle.textContent.trim(), '', 'an icon, no word');
  assert.match(toggle.getAttribute('aria-label'), /list of stories/);
  assert.equal(toggle.querySelectorAll('path').length, 1);
});

test('the welcome page is short, with the real Jupyter mark, and leads to the stories', async () => {
  const dom = await JSDOM.fromFile(path.join(path.dirname(SITE), 'index.html'), { runScripts: 'dangerously', pretendToBeVisual: true, url: 'http://localhost/' });
  opened.push(dom.window);
  const doc = dom.window.document;
  assert.equal(doc.querySelectorAll('h1').length, 1);
  assert.equal(doc.querySelectorAll('.story-card').length, 0, 'no stories on the welcome page');
  assert.ok(doc.querySelector('.welcome-lead'));
  assert.ok(doc.querySelector('.welcome-links a[href="stories.html"]'));
  // the mark is the orange arcs and the planets of the Jupyter logo
  const logo = doc.querySelector('.brand svg.logo');
  assert.ok(logo);
  assert.equal(logo.querySelectorAll('path').length, 2, 'the arcs, and the planets');
  assert.ok(logo.innerHTML.includes('#F37726'));
  assert.ok((doc.body.textContent.match(/\S+/g) || []).length < 250, 'a few lines, not a wall of text');
});

const read = name => JSDOM.fromFile(path.join(path.dirname(SITE), name), { runScripts: 'dangerously', pretendToBeVisual: true, url: 'http://localhost/' }).then(dom => (opened.push(dom.window), dom.window.document));

test('the current state lists every story once, with a tag, and the tags filter it', async () => {
  const doc = await read('current.html');
  const rows = [...doc.querySelectorAll('.state-row')];
  assert.ok(rows.length >= 60);
  assert.equal(new Set(rows.map(r => r.querySelector('.state-id').textContent)).size, rows.length, 'each story once');
  assert.ok(rows.every(r => r.querySelector('.tag') && r.querySelector('.state-result').textContent.length > 0));
  const chip = [...doc.querySelectorAll('.chip-filter')].find(b => b.dataset.filter === 'provisional');
  chip.click();
  assert.deepEqual([...new Set(rows.filter(r => !r.hidden).map(r => r.dataset.status))], ['provisional']);
  assert.ok([...doc.querySelectorAll('.state-group')].every(g => g.hidden === !g.querySelector('.state-row:not([hidden])')), 'a group with no row is hidden');
  [...doc.querySelectorAll('.chip-filter')].find(b => b.dataset.filter === 'all').click();
  assert.ok(rows.every(r => !r.hidden));
});

test('a story of the current state plays where it is, once its row is opened', async () => {
  const doc = await read('current.html');
  await sleep(100);
  const row = doc.getElementById('offline/second-tab-adds-cell');
  assert.ok(row.matches('details.state-row') && !row.open, 'a row starts folded');
  assert.equal(doc.querySelectorAll('.nbs-board').length, 0, 'nothing is played until a row is opened');
  row.open = true;
  row.dispatchEvent(new doc.defaultView.Event('toggle'));
  await sleep(150);
  assert.ok(row.querySelector('.nbs-board'), 'the story is mounted');
  assert.ok(row.querySelector('.nbs-play'), 'and can be played');
  assert.equal(doc.querySelectorAll('.nbs-board').length, 1, 'only the opened one');
  assert.ok(row.querySelector('a[href="stories.html#offline/second-tab-adds-cell"]'), 'with a way to it among all the stories');
});

test('up for discussion plays each story on the page, with its question and a way to the story', async () => {
  const doc = await read('discussion.html');
  await sleep(250);
  const talks = [...doc.querySelectorAll('.talk')];
  assert.ok(talks.length >= 1 && talks.length <= 20, 'a small list');
  for (const t of talks) {
    assert.ok(t.querySelector('.talk-question').textContent.length > 0, t.id + ' asks its question');
    assert.ok(t.querySelector('.nbs-board'), t.id + ' plays without a click');
    assert.ok(t.querySelector('a[href^="stories.html#"]'), t.id + ' links to its story');
  }
  assert.ok(talks.some(t => t.querySelector('.nbs-decision .nbs-opt')), 'the answers are in the player, with their endings');
});

test('every page of the site has the same bar with the same pages', async () => {
  for (const name of ['index.html', 'current.html', 'discussion.html', 'stories.html', 'about.html']) {
    const doc = await read(name);
    assert.deepEqual([...doc.querySelectorAll('.topnav a')].map(a => a.getAttribute('href')), ['current.html', 'discussion.html', 'stories.html', 'about.html'], name);
    assert.ok(doc.querySelector('.brand svg.logo'), name + ' has the mark');
  }
});

test('a preview of a change plays the new and the changed stories and says what moved', async () => {
  const { spawnSync } = require('node:child_process');
  const os = require('node:os');
  const root = path.join(__dirname, '..');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'preview-'));
  const head = path.join(tmp, 'head');
  fs.cpSync(path.join(root, 'stories'), head, { recursive: true });
  const file = path.join(head, 'storyboards', 'conflict.yaml');
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(/(  conflict\/move-same-cell:[\s\S]*?\n    result: )"[^\n]*"/, '$1"A different result."'));
  const run = spawnSync('python3', ['-I', path.join(root, 'examples', 'storyboards', 'build.py'), '--data', head, '--base-data', path.join(root, 'stories'), '--pr', '9', '-o', path.join(tmp, 'out')], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  const dom = await JSDOM.fromFile(path.join(tmp, 'out', 'index.html'), { runScripts: 'dangerously', pretendToBeVisual: true, url: 'http://localhost/' });
  opened.push(dom.window);
  await sleep(150);
  const doc = dom.window.document;
  assert.match(doc.querySelector('.preview-banner').textContent, /pull request #9/);
  const cards = [...doc.querySelectorAll('.story-card')];
  assert.deepEqual(cards.map(c => c.id), ['conflict/move-same-cell']);
  assert.ok(cards[0].querySelector('.nbs-board'), 'the changed story is mounted and played');
  assert.match(doc.querySelector('.change-diff').textContent, /A different result\./);
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('the edit link of a story goes away with the story when the list is filtered', async () => {
  const { doc } = open();
  await sleep(100);
  const rows = [...doc.querySelectorAll('.edit-story-row')];
  assert.ok(rows.length >= 60 && rows.every(r => r.previousElementSibling.classList.contains('story-card')), 'one after each story');
  const q = doc.getElementById('q');
  q.value = 'tab adds a cell while offline';
  q.dispatchEvent(new doc.defaultView.Event('input'));
  const shown = rows.filter(r => !r.hidden);
  assert.ok(shown.length >= 1 && shown.length < 10, 'only the matching stories keep a link');
  assert.ok(shown.every(r => !r.previousElementSibling.hidden), 'a link is shown exactly when its story is');
  assert.ok(shown[0].querySelector('a[href*="/edit/main/stories/storyboards/"]'));
});
