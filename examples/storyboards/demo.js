/* The demos on the "current state" and "up for discussion" pages. A story plays where it is: on the discussion page at once,
   on the current state page when its row is opened (it is measured when it is on screen, so not while it is folded away). */
(function () {
  'use strict';
  var NB = window.NbScenario;
  var data = JSON.parse(document.getElementById('data').textContent);
  // a link written with a name a story had before (stories.html#Z3) goes to the story under the name it has now
  (function () {
    var id = decodeURIComponent(location.hash.slice(1));
    if (!id || document.getElementById(id)) return;
    var now = Object.keys(data.stories).filter(function (k) { return (data.stories[k].aliases || []).indexOf(id) >= 0; })[0];
    if (now) location.replace('#' + now);
  })();
  function mount(card) {
    if (!card || card.dataset.mounted) return;
    card.dataset.mounted = '1';
    try { NB.mount(card, data.stories[card.dataset.story], { config: data.config }); } catch (e) { console.error('story ' + card.dataset.story, e); }
  }
  Array.prototype.forEach.call(document.querySelectorAll('.talk .story-card'), mount);
  var rows = Array.prototype.slice.call(document.querySelectorAll('details.state-row'));
  rows.forEach(function (row) {
    row.addEventListener('toggle', function () { if (row.open) mount(row.querySelector('.story-card')); });
  });
  // a link to current.html#conflict/delete-while-typing opens that story
  function reveal() {
    var row = location.hash.length > 1 && document.getElementById(decodeURIComponent(location.hash.slice(1)));
    if (row && row.matches('details.state-row')) { row.open = true; row.scrollIntoView(); }
  }
  window.addEventListener('hashchange', reveal);
  reveal();
})();
