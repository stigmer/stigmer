// Tests for scripts/macos-codesign-tree.sh: the Mach-O walk that signs the
// staged runner tree before Tauri packs it, and verifies the finished app the
// way Apple's notary will.
// Run via `node --test scripts/macos-codesign-tree.test.mjs` (wired into the
// desktop package's `npm test`). Skipped off macOS: codesign is the subject.
//
// What these guard: the walk must find every Mach-O and nothing else (a
// shell script with the executable bit is not code to codesign), must put the
// hardened runtime on executables and not on libraries (Tauri's discipline),
// and `verify` must refuse an authority the files do not carry, since that
// refusal is what stands between a green build and a notary rejection.
//
// The ad-hoc identity "-" is what a certificate-less Mac can sign with; the
// script accepts it for exactly this purpose.

import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), 'macos-codesign-tree.sh');
const onMacOS = process.platform === 'darwin';

// A system dylib that ships on disk (most of /usr/lib lives in the dyld
// shared cache and has no file to copy). The first that exists is used; if
// none does, the library assertions are skipped rather than faked.
const DYLIB_CANDIDATES = ['/usr/lib/libgmalloc.dylib', '/usr/lib/libffi-trampolines.dylib', '/usr/lib/libLeaksAtExit.dylib'];

function run(args, env = {}) {
  return spawnSync(SCRIPT, args, { encoding: 'utf8', env: { ...process.env, ...env } });
}

// codesign -dvv writes its report to stderr; both streams are joined so the
// assertions read the same text a human sees.
function reportOf(path) {
  const result = spawnSync('codesign', ['-dvv', path], { encoding: 'utf8' });
  return `${result.stdout}${result.stderr}`;
}

function scratchTree() {
  const root = mkdtempSync(join(tmpdir(), 'codesign-tree-'));
  const tree = join(root, 'runner');
  mkdirSync(join(tree, 'bin'), { recursive: true });
  copyFileSync('/bin/ls', join(tree, 'bin', 'tool'));
  const dylib = DYLIB_CANDIDATES.find((p) => existsSync(p));
  if (dylib) copyFileSync(dylib, join(tree, 'native.node'));
  writeFileSync(join(tree, 'run.sh'), '#!/bin/sh\necho hi\n');
  chmodSync(join(tree, 'run.sh'), 0o755);
  writeFileSync(join(tree, 'notes.txt'), 'not code\n');
  return { root, tree, hasDylib: Boolean(dylib) };
}

test('sign walks the Mach-O files only, with the runtime flag on executables', { skip: !onMacOS }, () => {
  const { root, tree, hasDylib } = scratchTree();
  try {
    const result = run(['sign', tree], { APPLE_SIGNING_IDENTITY: '-' });
    assert.equal(result.status, 0, result.stderr);
    const expected = hasDylib ? 2 : 1;
    assert.match(result.stdout, new RegExp(`sign — ${expected} Mach-O file\\(s\\)`));
    assert.match(result.stdout, /sign\s+\[executable\] .*\/bin\/tool$/m);
    assert.doesNotMatch(result.stdout, /run\.sh|notes\.txt/, 'non-Mach-O files are not touched');

    const executable = reportOf(join(tree, 'bin', 'tool'));
    assert.match(executable, /^Signature=adhoc$/m);
    assert.match(executable, /flags=0x[0-9a-f]+\([^)]*runtime[^)]*\)/, 'hardened runtime on the executable');

    if (hasDylib) {
      assert.match(result.stdout, /sign\s+\[library\] .*\/native\.node$/m);
      const library = reportOf(join(tree, 'native.node'));
      assert.match(library, /^Signature=adhoc$/m);
      assert.doesNotMatch(library, /flags=0x[0-9a-f]+\([^)]*runtime[^)]*\)/, 'no runtime flag on a library');
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('verify accepts the authority the files carry and refuses one they do not', { skip: !onMacOS }, () => {
  const { root, tree } = scratchTree();
  try {
    assert.equal(run(['sign', tree], { APPLE_SIGNING_IDENTITY: '-' }).status, 0);

    const accepted = run(['verify', tree, '-']);
    assert.equal(accepted.status, 0, accepted.stderr);
    assert.match(accepted.stdout, /verify\s+\[executable\] .*\/bin\/tool$/m);

    const refused = run(['verify', tree, 'Developer ID Application: Nobody (NOTEAM0000)']);
    assert.notEqual(refused.status, 0);
    assert.match(refused.stderr, /not signed by "Developer ID Application: Nobody \(NOTEAM0000\)": .*\/bin\/tool/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('verify refuses an executable that was signed without the hardened runtime', { skip: !onMacOS }, () => {
  const { root, tree } = scratchTree();
  try {
    // Signed by hand the way the notary would reject it: valid ad-hoc, no runtime.
    execFileSync('codesign', ['--force', '--sign', '-', join(tree, 'bin', 'tool')], { stdio: 'pipe' });
    const refused = run(['verify', tree, '-']);
    assert.notEqual(refused.status, 0);
    assert.match(refused.stderr, /hardened runtime not enabled on executable: .*\/bin\/tool/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a tree with no Mach-O is an error for both verbs', { skip: !onMacOS }, () => {
  const root = mkdtempSync(join(tmpdir(), 'codesign-tree-empty-'));
  try {
    writeFileSync(join(root, 'notes.txt'), 'not code\n');
    const signed = run(['sign', root], { APPLE_SIGNING_IDENTITY: '-' });
    assert.notEqual(signed.status, 0);
    assert.match(signed.stderr, /no Mach-O files under/);
    const verified = run(['verify', root, '-']);
    assert.notEqual(verified.status, 0);
    assert.match(verified.stderr, /no Mach-O files under/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('sign without an identity, or with bad arguments, fails before touching anything', { skip: !onMacOS }, () => {
  const { root, tree } = scratchTree();
  try {
    const unset = run(['sign', tree], { APPLE_SIGNING_IDENTITY: '' });
    assert.notEqual(unset.status, 0);
    assert.match(unset.stderr, /APPLE_SIGNING_IDENTITY is not set/);
    assert.equal(run(['sign']).status, 2, 'usage');
    assert.equal(run(['verify', tree]).status, 2, 'verify needs an authority');
    assert.equal(run(['frobnicate', tree]).status, 2, 'unknown verb');
    assert.notEqual(run(['sign', join(root, 'missing')], { APPLE_SIGNING_IDENTITY: '-' }).status, 0);
    assert.doesNotMatch(reportOf(join(tree, 'bin', 'tool')), /runtime/, 'the fixture was left unsigned by us');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
