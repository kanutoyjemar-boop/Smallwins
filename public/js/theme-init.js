// Applied before first paint so there's no flash of the wrong theme.
// Kept as an external file (not an inline script) so the Content-Security-Policy can forbid inline scripts.
(function () {
  try {
    var t = localStorage.getItem('selfup_theme');
    if (t === 'light') document.documentElement.dataset.theme = 'light';
  } catch (err) { /* storage unavailable: keep the default theme */ }
})();
