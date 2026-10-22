// Keeps src/wigwag-shell.html's inlined window.WigwagCore IIFE (Layer 1,
// see docs/EDITING.md) byte-for-byte derived from wigwag-core.js -- the
// standalone file is the single source of truth; this script is the "build
// step that ingests it into a portable wigwag.html" (Tom, 2026-10-16).
//
// Scope: this ONLY touches Layer 1 (the outer, literal HTML shell), now
// split out as src/wigwag-shell.html. Layer 2 (the text/x-dc Component
// source -- Settings UI, dispatch logic, rendering -- now src/wigwag-app.js
// + src/wigwag-template.html) is compiled output from a separate design/
// prototyping tool and was never sourced from wigwag-core.js; this script
// does not touch it at all, same boundary docs/EDITING.md itself draws.
//
// Pipeline order: this script -> build-wigwag-html.js (splices
// src/wigwag-shell.html + src/wigwag-template.html + src/wigwag-app.js
// into wigwag.html) -> the usual verification pipeline -> node
// src-tauri/copy-dist.js. `npm run build` runs the first two in order;
// run this alone if you only touched wigwag-core.js.
//
// Mechanics: wigwag.html's IIFE shims a `module` object
// (`var module = { exports: {} };`) specifically so wigwag-core.js's own
// dual Node/browser export tail (`if (typeof module !== 'undefined' &&
// module.exports) module.exports = WigwagCoreExports; if (typeof window
// !== 'undefined') window.WigwagCore = WigwagCoreExports;`) works
// unmodified inside the browser IIFE too -- the `window.WigwagCore =`
// line there is a harmless, redundant early assignment of the exact same
// object the OUTER `window.WigwagCore = (function(){...})()` wrapper
// assigns anyway. So wigwag-core.js's content is embedded VERBATIM, no
// line-by-line transformation needed, just wrapped.
//
// Literal `</script` escaping: this file is raw HTML text (not JSON-
// encoded, unlike Layer 2), so a literal `</script`-shaped substring
// anywhere in wigwag-core.js's own source would prematurely close the
// <script> tag. Deliberately narrow (`</script` specifically, not every
// bare `</`, unlike Layer 2's own blanket JSON-string approach): a blind
// `</` -> `</` replace corrupts innocent regex literals that merely
// CONTAIN that 2-char substring across two unrelated tokens -- e.g.
// `.replace(/</g, ...)` is a regex matching a literal "<" with its own
// closing `/` delimiter immediately after, which reads as "</" to a naive
// string search but means nothing like a closing tag at all; escaping it
// corrupts the regex literal and breaks parsing (hit this for real while
// writing this script). `</script` itself can only ever appear inside an
// actual string/regex literal's body (nowhere in valid JS source is it
// unrelated-token noise the way bare `</` can be), so this narrower match
// is both safe and sufficient.

const fs = require('fs');

const corePath = 'wigwag-core.js';
const htmlPath = 'src/wigwag-shell.html';

const coreSrc = fs.readFileSync(corePath, 'utf8');
const html = fs.readFileSync(htmlPath, 'utf8');

const openMarker = '<script>window.WigwagCore = (function() {\n  var module = { exports: {} };\n';
const closeMarker = '\n  return module.exports;\n})();</script>';

const start = html.indexOf(openMarker);
if (start === -1) throw new Error('open marker not found -- has src/wigwag-shell.html changed?');
const contentStart = start + openMarker.length;
const end = html.indexOf(closeMarker, contentStart);
if (end === -1) throw new Error('close marker not found -- has src/wigwag-shell.html changed?');

let escapedCore = coreSrc.replace(/<\/script/gi, '<\\u002Fscript');
if (/<\/script/i.test(escapedCore)) throw new Error('escaping left a literal </script behind in wigwag-core.js content');

const newHtml = html.slice(0, contentStart) + escapedCore + html.slice(end);

if (newHtml === html) {
  console.log('sync-wigwag-core: no change -- src/wigwag-shell.html already matches wigwag-core.js');
} else {
  fs.writeFileSync(htmlPath, newHtml);
  console.log('sync-wigwag-core: src/wigwag-shell.html updated from wigwag-core.js (' + escapedCore.length + ' bytes)');
}
