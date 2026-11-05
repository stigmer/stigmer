// Tests for scripts/ci-latest-json.mjs: how a signed updater bundle on disk
// becomes a latest.json platform entry, and how per-leg fragments merge.
// Run via `node --test scripts/ci-latest-json.test.mjs` (wired into the
// desktop package's `npm test`).
//
// What these guard: the manifest URL must name the asset as tauri-action
// uploads it (macOS bundles gain an arch suffix on upload), and the platform
// key must follow the Rust target the leg built. Getting either wrong ships a
// latest.json whose download 404s, which the updater reports as "could not
// check for updates" on every installed Mac. And every signature must be
// signed for the tag's version: the app sets `requireSignedVersion`, so an
// update whose signature names no version, or another one, is refused by every
// installed app, and the leg fails before anything is published.

import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import {
  buildFragment,
  mergeFragments,
  platformKeysFor,
  sameVersion,
  uploadedBundleName,
} from './ci-latest-json.mjs';

const TARGET_DIR = '/work/client-apps/desktop/src-tauri/target';

// A `.sig` file as the Tauri CLI writes it: the base64 of a minisign
// signature whose trusted comment carries tab-separated `key:value` fields.
// The signature lines are placeholders; only the trusted comment is read here.
function minisignSig({ file = 'bundle', version } = {}) {
  const fields = ['timestamp:1700000000', `file:${file}`];
  if (version !== undefined) fields.push(`version:${version}`);
  const text = [
    'untrusted comment: signature from tauri secret key',
    'RUTDb25YqLVUbMPLACEHOLDERSIGNATURE',
    `trusted comment: ${fields.join('\t')}`,
    'PLACEHOLDERGLOBALSIGNATURE',
    '',
  ].join('\n');
  return Buffer.from(text).toString('base64');
}

const SIG_MAC = minisignSig({ file: 'Stigmer.app.tar.gz', version: '3.15.0' });
const SIG_MSI = minisignSig({ file: 'Stigmer_3.15.0_x64_en-US.msi', version: '3.15.0' });
const SIG_NSIS = minisignSig({ file: 'Stigmer_3.15.0_x64-setup.exe', version: '3.15.0' });

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

test('a compressed AppImage maps to no platform, because the app cannot install one', () => {
  // The updater is built without its `zip` feature, which is what unpacks a
  // `.AppImage.tar.gz`; the bundler signs the AppImage itself.
  const linux = sigPath('x86_64-unknown-linux-gnu', 'appimage');
  assert.equal(platformKeysFor('Stigmer_3.15.0_amd64.AppImage.tar.gz', linux), null);
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
    'aarch64-apple-darwin/release/bundle/macos/Stigmer.app.tar.gz.sig': `${SIG_MAC}\n`,
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
          signature: SIG_MAC,
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
    'x86_64-pc-windows-msvc/release/bundle/msi/Stigmer_3.15.0_x64_en-US.msi.sig': `${SIG_MSI}\n`,
    'x86_64-pc-windows-msvc/release/bundle/nsis/Stigmer_3.15.0_x64-setup.exe.sig': `${SIG_NSIS}\n`,
  });
  try {
    const fragment = buildFragment({ targetDir, tag: 'v3.15.0', repo: 'stigmer/stigmer' });
    assert.equal(fragment.platforms['windows-x86_64'].signature, SIG_NSIS);
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

function macLeg(signature) {
  return scratchTargetDir({
    'aarch64-apple-darwin/release/bundle/macos/Stigmer.app.tar.gz.sig': `${signature}\n`,
  });
}

test('a signature signed for the tag\'s version passes, with or without the tag\'s v', () => {
  for (const signed of ['3.15.0', 'v3.15.0']) {
    for (const tag of ['v3.15.0', '3.15.0']) {
      const targetDir = macLeg(minisignSig({ file: 'Stigmer.app.tar.gz', version: signed }));
      try {
        const fragment = buildFragment({ targetDir, tag, repo: 'stigmer/stigmer' });
        assert.ok(fragment.platforms['darwin-aarch64'], `signed ${signed}, tag ${tag}`);
      } finally {
        rmSync(targetDir, { recursive: true, force: true });
      }
    }
  }
});

test('a signature with no signed version fails the leg, naming the file', () => {
  const targetDir = macLeg(minisignSig({ file: 'Stigmer.app.tar.gz' }));
  try {
    assert.throws(
      () => buildFragment({ targetDir, tag: 'v3.15.0', repo: 'stigmer/stigmer' }),
      /Stigmer\.app\.tar\.gz\.sig.*no signed version.*3\.15\.0/s,
    );
  } finally {
    rmSync(targetDir, { recursive: true, force: true });
  }
});

test('a signature signed for another version fails the leg, naming both versions', () => {
  // The release a downgrade would replay: 3.14.0's genuine signature under
  // 3.15.0's tag. Every installed app would refuse it.
  const targetDir = macLeg(minisignSig({ file: 'Stigmer.app.tar.gz', version: '3.14.0' }));
  try {
    assert.throws(
      () => buildFragment({ targetDir, tag: 'v3.15.0', repo: 'stigmer/stigmer' }),
      /Stigmer\.app\.tar\.gz\.sig.*signed for 3\.14\.0.*v3\.15\.0/s,
    );
  } finally {
    rmSync(targetDir, { recursive: true, force: true });
  }
});

test('a signature that is not a minisign signature fails the leg', () => {
  const targetDir = macLeg('SIG-MAC');
  try {
    assert.throws(
      () => buildFragment({ targetDir, tag: 'v3.15.0', repo: 'stigmer/stigmer' }),
      /Stigmer\.app\.tar\.gz\.sig.*no trusted comment/s,
    );
  } finally {
    rmSync(targetDir, { recursive: true, force: true });
  }
});

test('a version field that only ends in "version:" is not a signed version', () => {
  // The updater reads only a field that starts with `version:`; a file name
  // that contains it must not satisfy the check.
  const sig = Buffer.from(
    'untrusted comment: x\nRUTx\ntrusted comment: timestamp:1\tfile:app-version:3.15.0.tar.gz\nG\n',
  ).toString('base64');
  const targetDir = macLeg(sig);
  try {
    assert.throws(
      () => buildFragment({ targetDir, tag: 'v3.15.0', repo: 'stigmer/stigmer' }),
      /no signed version/,
    );
  } finally {
    rmSync(targetDir, { recursive: true, force: true });
  }
});

test('versions compare the way the updater compares them', () => {
  const cases = [
    // [signed, announced, same]
    ['3.15.0', '3.15.0', true],
    ['3.15.0', 'v3.15.0', true],
    ['v3.15.0', '3.15.0', true],
    ['0.0.0-12345', 'v0.0.0-12345', true, 'a dev build\'s prerelease'],
    ['3.15.0', '3.15.1', false],
    ['3.15.0-rc.1', '3.15.0', false, 'a prerelease is not its release'],
    ['3.15.0+a', '3.15.0+b', false, 'build metadata counts, as in the semver crate'],
    ['nightly', 'nightly', true, 'not semver: compared literally'],
    ['vnightly', 'nightly', false, 'not semver: no v is dropped'],
  ];
  for (const [signed, announced, same, why] of cases) {
    assert.equal(sameVersion(signed, announced), same, `${signed} vs ${announced}${why ? ` (${why})` : ''}`);
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
