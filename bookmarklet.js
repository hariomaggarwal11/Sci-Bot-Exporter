/*
 * Sci-Bot Exporter - Bookmarklet loader (no Tampermonkey needed).
 *
 * HOW TO USE:
 *   1. Host sci-bot-export.user.js somewhere reachable over HTTPS
 *      (e.g. a GitHub raw URL or gist raw URL), and put that URL below.
 *   2. Create a new browser bookmark and paste the MINIFIED one-liner
 *      (see README, "Bookmarklet") as its URL.
 *   3. Open any https://sci-bot.ru/... answer page and click the bookmark.
 *      A blue "Export" button appears bottom-right.
 *
 * The loader first injects JSZip (required for .docx), then the exporter.
 */
(function () {
  var SCRIPT_URL = 'REPLACE_WITH_HTTPS_URL_TO/sci-bot-export.user.js';
  var JSZIP_URL = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';

  function inject(src, cb) {
    var s = document.createElement('script');
    s.src = src; s.onload = cb;
    s.onerror = function () { alert('Sci-Bot Exporter: failed to load ' + src); };
    document.head.appendChild(s);
  }
  if (window.SciBotExport) { alert('Sci-Bot Exporter already loaded. Use the Export button.'); return; }
  if (window.JSZip) { inject(SCRIPT_URL, noop); }
  else { inject(JSZIP_URL, function () { inject(SCRIPT_URL, noop); }); }
  function noop() {}
})();
