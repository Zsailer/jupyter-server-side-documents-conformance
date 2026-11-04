/* The theme control shared by the pages: auto follows the system; light and dark are remembered. */
(function () {
  'use strict';
  var root = document.documentElement;
  var buttons = document.querySelectorAll('[data-theme-set]');
  function setTheme(mode) {
    if (mode === 'light' || mode === 'dark') root.dataset.theme = mode;
    else delete root.dataset.theme;
    try { if (mode === 'auto') localStorage.removeItem('nbs-theme'); else localStorage.setItem('nbs-theme', mode); } catch (e) { /* private mode */ }
    buttons.forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.themeSet === mode)); });
  }
  var saved = 'auto';
  try { saved = localStorage.getItem('nbs-theme') || 'auto'; } catch (e) { /* private mode */ }
  setTheme(saved);
  buttons.forEach(function (b) { b.addEventListener('click', function () { setTheme(b.dataset.themeSet); }); });
})();
