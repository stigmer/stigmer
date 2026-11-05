#!/usr/bin/env node
// Single-writer assembly of the Tauri updater manifest (latest.json) for the
// desktop release pipeline.
//
// The platform builds run in parallel, so we cannot let tauri-action write
// latest.json from each leg (the read-modify-write of the shared asset races
// and 404s — see tauri-apps/tauri-action#1270). Instead each leg emits a small
// per-platform "fragment" describing its signed updater bundle, and a single
// downstream job merges those fragments into one manifest. This keeps the
// manifest deterministic while allowing fully concurrent builds.
//
// macOS bundles are keyed by the Rust target triple in their path
// (MACOS_TARGETS), so adding or removing a macOS leg is a matrix change in
// release.desktop.yaml and nothing here. The lane builds aarch64 only: the
// embedded runner's natives are staged for the build host, so a universal
// shell would carry arm64-only natives.
//
// Every signature must be signed for the tag's version. The app turns on the
// updater's `requireSignedVersion` (tauri.conf.json), so it refuses an update
// whose signature's trusted comment names no version, or another one, than the
// version latest.json announces. A leg whose bundle would be refused fails here,
// and the publish job, which needs every leg, never uploads latest.json: no
// installed app is offered an update it would refuse. (On a tag the leg's
// installers may already be on the release; only the update feed is withheld.)
//
// Usage:
//   node ci-latest-json.mjs fragment --target-dir <dir> --tag <vX.Y.Z> --out <file>
//   node ci-latest-json.mjs merge --fragments-dir <dir> --version <X.Y.Z> --out <file>

import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, basename } from 'node:path';
import { pathToFileURL } from 'node:url';

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i];
    if (!key.startsWith('--')) continue;
    args[key.slice(2)] = argv[i + 1];
  }
  return args;
}

// Rust target dirs hold tens of thousands of intermediate files; pruning the
// heavy compilation subtrees keeps the bundle scan fast and predictable.
const PRUNE_DIRS = new Set([
  'deps',
  'build',
  'incremental',
  '.fingerprint',
  'examples',
  '.cargo',
  'node_modules',
]);

function findSignatureFiles(root) {
  const results = [];
  let entries;
  try {
    entries = readdirSync(root, { withFileTypes: true });
  } catch {
    return results;
  }
  for (const entry of entries) {
    const full = join(root, entry.name);
    if (entry.isDirectory()) {
      if (PRUNE_DIRS.has(entry.name)) continue;
      results.push(...findSignatureFiles(full));
    } else if (entry.isFile() && entry.name.endsWith('.sig')) {
      results.push(full);
    }
  }
  return results;
}

// The macOS Rust targets the desktop lane may build, keyed by the target
// triple that appears in the bundle's path under src-tauri/target/. Each row
// gives the arch suffix tauri-action puts on the uploaded asset name
// (tauri-action utils.ts: universal -> "universal", aarch64 -> "aarch64",
// anything else -> "x64") and the latest.json platform key(s) the bundle
// serves. A universal bundle serves both.
const MACOS_TARGETS = {
  'aarch64-apple-darwin': { uploadArch: 'aarch64', platformKeys: ['darwin-aarch64'] },
  'x86_64-apple-darwin': { uploadArch: 'x64', platformKeys: ['darwin-x86_64'] },
  'universal-apple-darwin': {
    uploadArch: 'universal',
    platformKeys: ['darwin-aarch64', 'darwin-x86_64'],
  },
};

function macosTargetOf(sigPath) {
  return Object.keys(MACOS_TARGETS).find((triple) => sigPath.includes(triple)) ?? null;
}

// Map a signed updater bundle to the latest.json platform key(s). macOS keys
// come from the target triple in the signature's path, since the on-disk
// bundle name (Stigmer.app.tar.gz) carries no arch. Returns null for
// non-updater signatures we should ignore, and for a macOS bundle under an
// unknown target.
export function platformKeysFor(bundleName, sigPath) {
  if (bundleName.endsWith('.app.tar.gz')) {
    const triple = macosTargetOf(sigPath);
    return triple ? MACOS_TARGETS[triple].platformKeys : null;
  }
  // Only the AppImage itself: the app's updater is built without its `zip`
  // feature, which is what unpacks a compressed `.AppImage.tar.gz`, and the
  // bundler signs the AppImage raw.
  if (bundleName.endsWith('.AppImage')) {
    return ['linux-x86_64'];
  }
  if (bundleName.endsWith('-setup.exe') || bundleName.endsWith('.msi')) {
    return ['windows-x86_64'];
  }
  return null;
}

// The asset name as tauri-action uploads it. macOS updater bundles are
// renamed with the arch suffix on upload (Stigmer.app.tar.gz ->
// Stigmer_aarch64.app.tar.gz), so the manifest URL must use the uploaded
// name, not the on-disk one. Every other bundle already carries its arch.
export function uploadedBundleName(bundleName, sigPath) {
  if (!bundleName.endsWith('.app.tar.gz')) return bundleName;
  const triple = macosTargetOf(sigPath);
  if (!triple) return bundleName;
  const suffix = `_${MACOS_TARGETS[triple].uploadArch}`;
  const stem = bundleName.slice(0, -'.app.tar.gz'.length);
  return stem.endsWith(suffix) ? bundleName : `${stem}${suffix}.app.tar.gz`;
}

// The version a `.sig` file was signed for. The file is the base64 of a
// minisign signature; the Tauri CLI writes its trusted comment as
// tab-separated `key:value` fields (`timestamp:…\tfile:…\tversion:…`). Read
// the way the updater reads it (tauri-plugin-updater `signed_version`): the
// first field that starts with `version:`. Returns null when the comment has
// no such field, and throws when there is no trusted comment at all.
export function signedVersionOf(signature, sigPath) {
  const text = Buffer.from(signature, 'base64').toString('utf8');
  const line = text.split(/\r?\n/).find((l) => l.startsWith('trusted comment: '));
  if (line === undefined) {
    throw new Error(`${sigPath} has no trusted comment: it is not a minisign signature.`);
  }
  const field = line
    .slice('trusted comment: '.length)
    .split('\t')
    .find((f) => f.startsWith('version:'));
  return field === undefined ? null : field.slice('version:'.length);
}

// The updater's comparison (tauri-plugin-updater `verify_signed_version`): as
// semver once leading `v`s are dropped, so `v1.2.3` matches `1.2.3`, or
// literally when either side is not semver. Semver forbids leading zeros, so
// two valid versions are equal exactly when their texts are.
const SEMVER =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;

export function sameVersion(signed, announced) {
  const a = signed.replace(/^v+/, '');
  const b = announced.replace(/^v+/, '');
  if (SEMVER.test(a) && SEMVER.test(b)) return a === b;
  return signed === announced;
}

function assertSignedFor(signature, sigPath, tag) {
  const signed = signedVersionOf(signature, sigPath);
  if (signed === null) {
    throw new Error(
      `${sigPath} carries no signed version, and the app refuses an update without one ` +
        `(requireSignedVersion). Sign it with Tauri CLI 2.12 or later for ${tag}.`,
    );
  }
  if (!sameVersion(signed, tag)) {
    throw new Error(
      `${sigPath} is signed for ${signed}, but this release is ${tag}; ` +
        'every installed app would refuse the update.',
    );
  }
}

function downloadUrl(repo, tag, bundleName) {
  return `https://github.com/${repo}/releases/download/${encodeURIComponent(
    tag,
  )}/${encodeURIComponent(bundleName)}`;
}

export function buildFragment({ targetDir, tag, repo }) {
  const sigFiles = findSignatureFiles(targetDir).filter((p) =>
    p.includes('bundle'),
  );

  const platforms = {};
  for (const sigPath of sigFiles) {
    const bundleName = uploadedBundleName(
      basename(sigPath).replace(/\.sig$/, ''),
      sigPath,
    );
    const keys = platformKeysFor(bundleName, sigPath);
    if (!keys) continue;

    const signature = readFileSync(sigPath, 'utf8').trim();
    assertSignedFor(signature, sigPath, tag);
    const url = downloadUrl(repo, tag, bundleName);

    for (const key of keys) {
      // Prefer the NSIS installer over the MSI when both are signed, matching
      // Tauri's default Windows updater target.
      if (
        key === 'windows-x86_64' &&
        platforms[key] &&
        platforms[key].url.endsWith('-setup.exe')
      ) {
        continue;
      }
      platforms[key] = { signature, url };
    }
  }

  if (Object.keys(platforms).length === 0) {
    throw new Error(
      `No signed updater bundles found under ${targetDir}. ` +
        'Ensure createUpdaterArtifacts is enabled and signing keys are set.',
    );
  }

  return { platforms };
}

export function mergeFragments({ fragmentsDir, version }) {
  const platforms = {};

  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile() && entry.name.endsWith('.json')) {
        const fragment = JSON.parse(readFileSync(full, 'utf8'));
        Object.assign(platforms, fragment.platforms || {});
      }
    }
  };
  walk(fragmentsDir);

  if (Object.keys(platforms).length === 0) {
    throw new Error(`No updater fragments found under ${fragmentsDir}`);
  }

  return {
    version,
    notes: 'See the release notes for details.',
    pub_date: new Date().toISOString(),
    platforms,
  };
}

function main() {
  const [command, ...rest] = process.argv.slice(2);
  const args = parseArgs(rest);
  const repo = process.env.GITHUB_REPOSITORY || 'stigmer/stigmer';

  if (command === 'fragment') {
    const manifest = buildFragment({
      targetDir: args['target-dir'],
      tag: args.tag,
      repo,
    });
    writeFileSync(args.out, JSON.stringify(manifest, null, 2));
    console.log(`Wrote fragment ${args.out}:`);
    console.log(JSON.stringify(manifest, null, 2));
    return;
  }

  if (command === 'merge') {
    const version = args.version.replace(/^v/, '');
    const manifest = mergeFragments({
      fragmentsDir: args['fragments-dir'],
      version,
    });
    writeFileSync(args.out, JSON.stringify(manifest, null, 2));
    console.log(`Wrote ${args.out} with platforms:`, Object.keys(manifest.platforms));
    return;
  }

  console.error('Usage: ci-latest-json.mjs <fragment|merge> [options]');
  process.exit(1);
}

// Run only when invoked directly, so ci-latest-json.test.mjs can import the
// mapping functions without triggering the CLI.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
