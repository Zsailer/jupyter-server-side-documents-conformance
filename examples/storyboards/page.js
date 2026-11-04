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
      });
    }, { rootMargin: '-30% 0px -60% 0px' });
    cards.forEach(function (c) { io.observe(c); });
  }

  /* ---- small screens: the story list opens over the page ---- */
  var side = document.getElementById('side');
  var menu = document.getElementById('menuBtn');
  menu.addEventListener('click', function () {
    var open = side.classList.toggle('open');
    menu.setAttribute('aria-expanded', String(open));
  });
  side.addEventListener('click', function (e) {
    if (e.target.closest('a')) { side.classList.remove('open'); menu.setAttribute('aria-expanded', 'false'); }
  });
})();
