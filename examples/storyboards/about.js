/* The reading guide: the one-picture triptych and the key to the cells. */
(function () {
  'use strict';
  var data = JSON.parse(document.getElementById('data').textContent);
  var NB = window.NbScenario;

  NB.triptych(document.getElementById('hero-trip'), [
    { title: 'Your tab', status: 'online', cells: ['c0', 'c1', 'c2'], active: 'c1', caption: 'You are editing the notebook.' },
    { title: 'Your tab', status: 'offline', cells: ['c0', 'c1=+OFFLINE', 'c2'], active: 'c1', editing: true, caption: 'The connection drops. You keep typing.' },
    { title: 'Your tab', status: 'online', cells: ['c0', 'c1=+OFFLINE', 'c2'], active: 'c1', caption: 'You reconnect. Your typing is still there.' }
  ], data.config);

  var legend = [
    ['+NEW-B', 'A cell that was added'],
    ['c1=+B-TYPED', 'A cell that was edited, with what changed'],
    ['^c1', 'A cell that was moved'],
    ['?c1=recovered', 'A copy set aside for the user'],
    ['-c2', 'A cell that was removed'],
    ['!c1=twice', 'Something that must never happen']
  ];
  document.getElementById('legend').innerHTML = legend.map(function (l) {
    return '<div class="row">' + NB.miniHTML([l[0]], data.config) + '<span>' + l[1] + '</span></div>';
  }).join('');
})();
