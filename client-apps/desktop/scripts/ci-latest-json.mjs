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
// release.desktop.yaml and nothing here. The lane builds aarch64 only today;
// see stigmer-cloud 20260912.01 DD-001 for why the universal build was retired.
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
  if (bundleName.endsWith('.AppImage') || bundleName.endsWith('.AppImage.tar.gz')) {
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
