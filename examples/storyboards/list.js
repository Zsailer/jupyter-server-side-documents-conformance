/* The filter of the "current state" page: show the rows of one tag, and only the groups that have any. */
(function () {
  'use strict';
  var filters = document.getElementById('filters');
  if (!filters) return;
  var rows = Array.prototype.slice.call(document.querySelectorAll('.state-row'));
  var groups = Array.prototype.slice.call(document.querySelectorAll('.state-group'));
  filters.addEventListener('click', function (e) {
    var b = e.target.closest('.chip-filter');
    if (!b) return;
    var want = b.dataset.filter;
    filters.querySelectorAll('.chip-filter').forEach(function (x) {
      x.classList.toggle('on', x === b);
      x.setAttribute('aria-pressed', String(x === b));
    });
    rows.forEach(function (r) { r.hidden = want !== 'all' && r.dataset.status !== want; });
    groups.forEach(function (g) { g.hidden = !g.querySelector('.state-row:not([hidden])'); });
  });
})();
