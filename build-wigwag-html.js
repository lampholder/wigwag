// Builds wigwag.html from the readable sources under src/ -- see
// docs/EDITING.md ("Primary workflow") for the full picture. Run this
// (or `npm run build`, which also runs sync-wigwag-core.js first) after
// editing src/wigwag-app.js or src/wigwag-template.html.
//
// Three sources, spliced together exactly like the original bundler
// tool's own pristine output:
//   src/wigwag-shell.html    -- Layer 1 (outer file bytes), with the
//                                __bundler/template tag's body left
//                                empty as the splice point.
//   src/wigwag-template.html -- Layer 2, the decoded secondary HTML
//                                document, with the text/x-dc script's
//                                body left empty as the splice point.
//   src/wigwag-app.js        -- the real application logic (the
//                                text/x-dc script's content), as a
//                                genuine standalone .js file.
//
// Escaping step (3) matches the REAL file's own convention, confirmed
// by direct inspection -- not docs/EDITING.md's older prose, which
// describes a narrower </ -> </ replace. The actual bundler
// output escapes every literal < to < across the whole JSON
// string; this script does the same so the result matches what's
// already shipped.

const fs = require('fs');
const { execFileSync } = require('child_process');

const APP = 'src/wigwag-app.js';
const TEMPLATE = 'src/wigwag-template.html';
const SHELL = 'src/wigwag-shell.html';
const OUT = 'wigwag.html';

// 1. Fail fast, before any string surgery.
execFileSync(process.execPath, ['--check', APP], { stdio: 'inherit' });

const appJs = fs.readFileSync(APP, 'utf8');
const templateSrc = fs.readFileSync(TEMPLATE, 'utf8');
const shellSrc = fs.readFileSync(SHELL, 'utf8');

function spliceIntoEmptyHole(haystack, openMarker, closeMarker, payload, label) {
  const firstIdx = haystack.indexOf(openMarker);
  if (firstIdx === -1) throw new Error(label + ': open marker not found');
  if (haystack.indexOf(openMarker, firstIdx + 1) !== -1) throw new Error(label + ': open marker not unique');
  const holeStart = firstIdx + openMarker.length;
  const holeEnd = haystack.indexOf(closeMarker, holeStart);
  if (holeEnd === -1) throw new Error(label + ': close marker not found');
  if (holeEnd !== holeStart) throw new Error(label + ': hole not empty -- source files out of sync with the build script\'s expected markers?');
  return haystack.slice(0, holeStart) + payload + haystack.slice(holeStart);
}

// 2. Splice appJs into the template's text/x-dc hole.
const DC_OPEN = '<script type="text/x-dc" data-dc-script="" data-props="{}">';
const decodedDoc = spliceIntoEmptyHole(templateSrc, DC_OPEN, '\n</script>', appJs, 'template');

// 3. Encode using the file's REAL convention: blanket < -> <.
const encoded = JSON.stringify(decodedDoc).split('<').join('\\u003C');
if (encoded.includes('<')) throw new Error('escaping left a literal < behind');

// 4. Splice encoded JSON into the shell's __bundler/template hole.
const TPL_OPEN = '<script type="__bundler/template">';
const outHtml = spliceIntoEmptyHole(shellSrc, TPL_OPEN, '</script>', encoded, 'shell');

// 5. Built-in sanity check: re-decode what was just built, before
// writing, and confirm it round-trips exactly.
const reStart = outHtml.indexOf(TPL_OPEN) + TPL_OPEN.length;
const reEnd = outHtml.indexOf('</script>', reStart);
const reDecoded = JSON.parse(outHtml.slice(reStart, reEnd));
if (reDecoded !== decodedDoc) throw new Error('round-trip mismatch -- refusing to write ' + OUT);

fs.writeFileSync(OUT, outHtml);
console.log('build-wigwag-html: wrote ' + OUT + ' (' + outHtml.length + ' bytes)');
