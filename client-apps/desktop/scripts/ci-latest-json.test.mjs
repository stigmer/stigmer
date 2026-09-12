// Tests for scripts/ci-latest-json.mjs: how a signed updater bundle on disk
// becomes a latest.json platform entry, and how per-leg fragments merge.
// Run via `node --test scripts/ci-latest-json.test.mjs` (wired into the
// desktop package's `npm test`).
//
// What these guard: the manifest URL must name the asset as tauri-action
// uploads it (macOS bundles gain an arch suffix on upload), and the platform
// key must follow the Rust target the leg built. Getting either wrong ships a
// latest.json whose download 404s, which the updater reports as "could not
// check for updates" on every installed Mac.

import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import {
  buildFragment,
  mergeFragments,
  platformKeysFor,
  uploadedBundleName,
} from './ci-latest-json.mjs';

const TARGET_DIR = '/work/client-apps/desktop/src-tauri/target';

function sigPath(triple, ...rest) {
  return join(TARGET_DIR, triple, 'release', 'bundle', ...rest);
}

test('macOS updater bundles are keyed by the target triple in their path', () => {
  assert.deepEqual(
    platformKeysFor('Stigmer.app.tar.gz', sigPath('aarch64-apple-darwin', 'macos', 'Stigmer.app.tar.gz.sig')),
    ['darwin-aarch64'],
  );
  assert.deepEqual(
    platformKeysFor('Stigmer.app.tar.gz', sigPath('x86_64-apple-darwin', 'macos', 'Stigmer.app.tar.gz.sig')),
    ['darwin-x86_64'],
  );
  assert.deepEqual(
    platformKeysFor('Stigmer.app.tar.gz', sigPath('universal-apple-darwin', 'macos', 'Stigmer.app.tar.gz.sig')),
    ['darwin-aarch64', 'darwin-x86_64'],
  );
});

test('a macOS bundle under an unknown target maps to no platform', () => {
  assert.equal(
    platformKeysFor('Stigmer.app.tar.gz', sigPath('riscv64-apple-darwin', 'macos', 'Stigmer.app.tar.gz.sig')),
    null,
  );
});

test('Linux and Windows bundles are keyed by their names', () => {
  const linux = sigPath('x86_64-unknown-linux-gnu', 'appimage');
  assert.deepEqual(platformKeysFor('Stigmer_3.15.0_amd64.AppImage', linux), ['linux-x86_64']);
  const windows = sigPath('x86_64-pc-windows-msvc', 'nsis');
  assert.deepEqual(platformKeysFor('Stigmer_3.15.0_x64-setup.exe', windows), ['windows-x86_64']);
  assert.deepEqual(platformKeysFor('Stigmer_3.15.0_x64_en-US.msi', windows), ['windows-x86_64']);
  assert.equal(platformKeysFor('Stigmer_3.15.0_amd64.deb', linux), null, 'deb is not an updater target');
});

test('macOS bundle names take the arch suffix tauri-action adds on upload', () => {
  assert.equal(
    uploadedBundleName('Stigmer.app.tar.gz', sigPath('aarch64-apple-darwin', 'macos', 'x')),
    'Stigmer_aarch64.app.tar.gz',
  );
  assert.equal(
    uploadedBundleName('Stigmer.app.tar.gz', sigPath('x86_64-apple-darwin', 'macos', 'x')),
    'Stigmer_x64.app.tar.gz',
  );
  assert.equal(
    uploadedBundleName('Stigmer.app.tar.gz', sigPath('universal-apple-darwin', 'macos', 'x')),
    'Stigmer_universal.app.tar.gz',
  );
  assert.equal(
    uploadedBundleName('Stigmer_aarch64.app.tar.gz', sigPath('aarch64-apple-darwin', 'macos', 'x')),
    'Stigmer_aarch64.app.tar.gz',
    'an already-suffixed name is left alone',
  );
  assert.equal(
    uploadedBundleName('Stigmer_3.15.0_x64-setup.exe', sigPath('x86_64-pc-windows-msvc', 'nsis', 'x')),
    'Stigmer_3.15.0_x64-setup.exe',
    'non-macOS names already carry their arch',
  );
});

function scratchTargetDir(files) {
  const root = mkdtempSync(join(tmpdir(), 'ci-latest-json-'));
  for (const [relative, contents] of Object.entries(files)) {
    const full = join(root, relative);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, contents);
  }
  return root;
}

test('a fragment for the aarch64 macOS leg names the uploaded asset and one platform', () => {
  const targetDir = scratchTargetDir({
    'aarch64-apple-darwin/release/bundle/macos/Stigmer.app.tar.gz.sig': 'SIG-MAC\n',
    // Not an updater bundle; the DMG has no signature file, but guard anyway.
    'aarch64-apple-darwin/release/bundle/dmg/Stigmer_3.15.0_aarch64.dmg': 'dmg',
    // Heavy compilation subtrees are pruned from the walk.
    'aarch64-apple-darwin/release/deps/bundle/fake.app.tar.gz.sig': 'SIG-IGNORED\n',
  });
  try {
    const fragment = buildFragment({ targetDir, tag: 'v3.15.0', repo: 'stigmer/stigmer' });
    assert.deepEqual(fragment, {
      platforms: {
        'darwin-aarch64': {
          signature: 'SIG-MAC',
          url: 'https://github.com/stigmer/stigmer/releases/download/v3.15.0/Stigmer_aarch64.app.tar.gz',
        },
      },
    });
  } finally {
    rmSync(targetDir, { recursive: true, force: true });
  }
});

test('the Windows fragment prefers the NSIS installer over the MSI', () => {
  const targetDir = scratchTargetDir({
    'x86_64-pc-windows-msvc/release/bundle/msi/Stigmer_3.15.0_x64_en-US.msi.sig': 'SIG-MSI\n',
    'x86_64-pc-windows-msvc/release/bundle/nsis/Stigmer_3.15.0_x64-setup.exe.sig': 'SIG-NSIS\n',
  });
  try {
    const fragment = buildFragment({ targetDir, tag: 'v3.15.0', repo: 'stigmer/stigmer' });
    assert.equal(fragment.platforms['windows-x86_64'].signature, 'SIG-NSIS');
    assert.match(fragment.platforms['windows-x86_64'].url, /x64-setup\.exe$/);
  } finally {
    rmSync(targetDir, { recursive: true, force: true });
  }
});

test('a leg with no signed updater bundle fails rather than emitting an empty fragment', () => {
  const targetDir = scratchTargetDir({
    'aarch64-apple-darwin/release/bundle/dmg/Stigmer_3.15.0_aarch64.dmg': 'dmg',
  });
  try {
    assert.throws(
      () => buildFragment({ targetDir, tag: 'v3.15.0', repo: 'stigmer/stigmer' }),
      /No signed updater bundles found/,
    );
  } finally {
    rmSync(targetDir, { recursive: true, force: true });
  }
});

test('merge unions the per-leg fragments under one version', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ci-latest-json-merge-'));
  try {
    writeFileSync(
      join(dir, 'updater-fragment-macos.json'),
      JSON.stringify({ platforms: { 'darwin-aarch64': { signature: 'a', url: 'https://x/a' } } }),
    );
    writeFileSync(
      join(dir, 'updater-fragment-linux.json'),
      JSON.stringify({ platforms: { 'linux-x86_64': { signature: 'b', url: 'https://x/b' } } }),
    );
    const manifest = mergeFragments({ fragmentsDir: dir, version: '3.15.0' });
    assert.equal(manifest.version, '3.15.0');
    assert.deepEqual(Object.keys(manifest.platforms).sort(), ['darwin-aarch64', 'linux-x86_64']);
    assert.ok(!Number.isNaN(Date.parse(manifest.pub_date)), 'pub_date is an ISO instant');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
