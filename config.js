// The public GitHub Pages site can use the optional local YouTube helper.
// On the local site, requests stay on the same origin.
window.PULSEBOX_API_BASE = location.hostname.endsWith('.github.io')
  ? 'http://127.0.0.1:4173'
  : '';

