// Tauri's frontendDist must be a directory -- the real app lives in a
// single bundled file at the repo root (never hand-edited, see
// docs/EDITING.md). This just stages a copy as dist/index.html before
// each dev/build run, so src-tauri never becomes a second source of truth.
const fs = require('fs');
const path = require('path');

const src = path.join(__dirname, '..', 'Git-native Project Tracker.html');
const destDir = path.join(__dirname, 'dist');
fs.mkdirSync(destDir, { recursive: true });
fs.copyFileSync(src, path.join(destDir, 'index.html'));
console.log('copied "Git-native Project Tracker.html" -> src-tauri/dist/index.html');
