#!/usr/bin/env node
// Convenience wrapper over migrate-v1-to-v2.js/verify-v1-to-v2-migration.js:
// migrates every .jsonl file in a source directory to a destination
// directory, verifying each one against a pre-migration wigwag-core.js
// (fetched automatically via `git show`, from this same repo checkout --
// no manual one-time setup step needed). Entirely local: reads/writes
// only the directories you point it at.
//
// Usage:
//   node migrate-all.js [sourceDir] [destDir]
//
// Defaults to the paths from this session's own conversation:
//   sourceDir: ~/Desktop/wigwag/wigwag-all-projects-2026-11-01
//   destDir:   ~/Desktop/wigwag/migrated

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');
const { migrateFile } = require('./migrate-v1-to-v2.js');
const { verify } = require('./verify-v1-to-v2-migration.js');

function expandHome(p) {
  return p.startsWith('~') ? path.join(os.homedir(), p.slice(1)) : p;
}

const sourceDir = expandHome(process.argv[2] || '~/Desktop/wigwag/wigwag-all-projects-2026-11-01');
const destDir = expandHome(process.argv[3] || '~/Desktop/wigwag/migrated');

// The pre-migration wigwag-core.js, fetched from THIS repo's own git
// history (ada997f is the last commit before tracker #227/3212e2ff) --
// same thing the standalone verify script's own usage comment tells
// you to do by hand; done here automatically so this wrapper needs no
// separate setup step.
function oldWigwagCorePath() {
  const tmp = path.join(os.tmpdir(), 'old-wigwag-core-ada997f.js');
  if (!fs.existsSync(tmp)) {
    const text = execFileSync('git', ['show', 'ada997f:wigwag-core.js'], { cwd: __dirname, encoding: 'utf8' });
    fs.writeFileSync(tmp, text);
  }
  return tmp;
}

function main() {
  if (!fs.existsSync(sourceDir)) {
    console.error(`Source directory does not exist: ${sourceDir}`);
    process.exit(1);
  }
  fs.mkdirSync(destDir, { recursive: true });

  const files = fs.readdirSync(sourceDir).filter(f => f.toLowerCase().endsWith('.jsonl'));
  if (!files.length) {
    console.error(`No .jsonl files found in ${sourceDir}`);
    process.exit(1);
  }

  const oldCorePath = oldWigwagCorePath();
  console.log(`Migrating ${files.length} file(s) from ${sourceDir}\n  to ${destDir}\n`);

  const results = [];
  for (const file of files) {
    const inputPath = path.join(sourceDir, file);
    const outputPath = path.join(destDir, file);
    process.stdout.write(`${file} ... `);
    try {
      const { issueCount } = migrateFile(inputPath, outputPath);
      const check = verify(inputPath, outputPath, oldCorePath);
      if (check.ok) {
        console.log(`OK (${issueCount} issues)`);
        results.push({ file, ok: true, issueCount });
      } else {
        console.log(`MISMATCH (${check.mismatches.length} value mismatch(es), ${check.missing.length} missing, ${check.extra.length} extra)`);
        for (const m of check.mismatches.slice(0, 5)) {
          console.log(`    ${m.id.slice(0, 8)} ${m.colId}: ${JSON.stringify(m.before)} -> ${JSON.stringify(m.after)}`);
        }
        if (check.mismatches.length > 5) console.log(`    ...and ${check.mismatches.length - 5} more`);
        results.push({ file, ok: false, check });
      }
    } catch (e) {
      console.log(`FAILED: ${e.message}`);
      results.push({ file, ok: false, error: e.message });
    }
  }

  const okCount = results.filter(r => r.ok).length;
  console.log(`\n${okCount}/${results.length} migrated and verified cleanly.`);
  if (okCount < results.length) {
    console.log(`Files needing a closer look: ${results.filter(r => !r.ok).map(r => r.file).join(', ')}`);
    process.exit(1);
  }
}

main();
