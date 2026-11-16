// Applies the saved (or system) colour theme before the app paints, so there is no flash.
// Kept as a tiny external file because the Content-Security-Policy forbids inline scripts.
(function () {
  var choice = 'system'
  try { choice = localStorage.getItem('gq-theme') || 'system' } catch (e) {}
  var dark = choice === 'dark' || (choice !== 'light' && window.matchMedia('(prefers-color-scheme: dark)').matches)
  document.documentElement.dataset.theme = dark ? 'dark' : 'light'
})()
