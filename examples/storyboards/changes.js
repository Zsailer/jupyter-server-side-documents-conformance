/* The page of what a pull request changes: the new and changed stories, each played. */
(function () {
  'use strict';
  var data = JSON.parse(document.getElementById('data').textContent);
  Array.prototype.forEach.call(document.querySelectorAll('.story-card'), function (card) {
    try { window.NbScenario.mount(card, data.stories[card.id], { config: data.config }); } catch (e) { console.error('story ' + card.id, e); }
  });
})();
