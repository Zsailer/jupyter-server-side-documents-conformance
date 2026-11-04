/* The page around the stories: search and filter, navigation. The stories are mounted by player/nbscenario.js. */
(function () {
  'use strict';
  var data = JSON.parse(document.getElementById('data').textContent);
  var NB = window.NbScenario;

  /* ---- the stories: mounted up front, so the page does not jump; each plays only while it is on screen ---- */
  var cards = Array.prototype.slice.call(document.querySelectorAll('.story-card'));
  cards.forEach(function (card) {
    var st = data.stories[card.id];
    try { NB.mount(card, st, { config: data.config }); } catch (e) { console.error('story ' + card.id, e); }
  });

  /* ---- search and filter ---- */
  var q = document.getElementById('q');
  var filters = document.getElementById('filters');
  var state = { text: '', filter: 'all' };
  function matches(card) {
    if (state.text && card.dataset.search.indexOf(state.text) < 0) return false;
    if (state.filter === 'need') return card.dataset.need === '1';
    if (state.filter.indexOf('feature:') === 0) return (' ' + card.dataset.features + ' ').indexOf(' ' + state.filter.slice(8) + ' ') >= 0;
    return true;
  }
  function apply() {
    var shown = 0;
    cards.forEach(function (card) {
      var ok = matches(card);
      card.hidden = !ok;
      var link = document.querySelector('.nav-story[data-id="' + card.id + '"]');
      if (link) link.hidden = !ok;
      if (ok) shown++;
    });
    document.querySelectorAll('.group').forEach(function (g) {
      var any = g.querySelector('.story-card:not([hidden])');
      g.hidden = !any;
      var nav = document.querySelector('.nav-group[data-group="' + g.dataset.group + '"]');
      if (nav) nav.hidden = !any;
    });
    document.getElementById('side').classList.toggle('filtering', !!state.text || state.filter !== 'all');
    document.getElementById('count').textContent = shown + ' of ' + cards.length + ' stories';
    document.getElementById('empty').hidden = shown > 0;
  }
  q.addEventListener('input', function () { state.text = q.value.trim().toLowerCase(); apply(); });
  filters.addEventListener('click', function (e) {
    var b = e.target.closest('.chip-filter');
    if (!b) return;
    state.filter = b.dataset.filter;
    filters.querySelectorAll('.chip-filter').forEach(function (x) { x.classList.toggle('on', x === b); });
    apply();
  });
  apply();

  /* ---- the side bar follows where you are ---- */
  var links = {};
  document.querySelectorAll('.nav-story').forEach(function (a) { links[a.dataset.id] = a; });
  if ('IntersectionObserver' in window) {
    var current = null;
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (!en.isIntersecting) return;
        if (current) current.classList.remove('current');
        current = links[en.target.id];
        if (current) current.classList.add('current');
        groups.forEach(function (g) { g.classList.toggle('has-current', !!current && g.contains(current)); });
      });
    }, { rootMargin: '-30% 0px -60% 0px' });
    cards.forEach(function (c) { io.observe(c); });
  }

  /* ---- the list can be hidden, and each group folded; both are remembered ---- */
  var layout = document.querySelector('.layout');
  var side = document.getElementById('side');
  var toggle = document.getElementById('sideToggle');
  function load(key, fallback) {
    try { var v = localStorage.getItem(key); return v === null ? fallback : JSON.parse(v); } catch (e) { return fallback; }
  }
  function save(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* private mode */ }
  }
  var narrow = window.matchMedia ? window.matchMedia('(max-width: 1000px)') : { matches: false };

  function showList(open, remember) {
    layout.classList.toggle('side-collapsed', !open);
    toggle.setAttribute('aria-expanded', String(open));
    if (remember && !narrow.matches) save('nbs-side', open);
  }
  // on a wide screen the list is open unless it was hidden; on a narrow one it opens over the page, and starts shut
  showList(narrow.matches ? false : load('nbs-side', true), false);
  toggle.addEventListener('click', function () { showList(layout.classList.contains('side-collapsed'), true); });
  side.addEventListener('click', function (e) {
    if (narrow.matches && e.target.closest('a')) showList(false, false);
  });

  var groups = Array.prototype.slice.call(document.querySelectorAll('.nav-group'));
  var folded = new Set(load('nbs-nav-folded', []));
  function fold(group, isFolded) {
    group.classList.toggle('folded', isFolded);
    group.querySelector('.nav-chev').setAttribute('aria-expanded', String(!isFolded));
    if (isFolded) folded.add(group.dataset.group); else folded.delete(group.dataset.group);
  }
  groups.forEach(function (g) { fold(g, folded.has(g.dataset.group)); });
  side.addEventListener('click', function (e) {
    var chev = e.target.closest('.nav-chev');
    if (!chev) return;
    var g = chev.closest('.nav-group');
    fold(g, !g.classList.contains('folded'));
    save('nbs-nav-folded', Array.from(folded));
  });
  document.getElementById('foldAll').addEventListener('click', function () {
    groups.forEach(function (g) { fold(g, true); });
    save('nbs-nav-folded', Array.from(folded));
  });
  document.getElementById('unfoldAll').addEventListener('click', function () {
    groups.forEach(function (g) { fold(g, false); });
    save('nbs-nav-folded', Array.from(folded));
  });
  // going to a story, or to a group, opens its group in the list
  function reveal() {
    var id = decodeURIComponent(location.hash.slice(1));
    var target = id && document.getElementById(id);
    var group = target && (target.closest('.group') || target);
    var navGroup = group && document.querySelector('.nav-group[data-group="' + (group.dataset && group.dataset.group) + '"]');
    if (navGroup && navGroup.classList.contains('folded')) fold(navGroup, false);
  }
  window.addEventListener('hashchange', reveal);
  reveal();
})();
