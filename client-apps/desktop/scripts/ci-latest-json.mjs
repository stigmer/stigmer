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
// Usage:
//   node ci-latest-json.mjs fragment --target-dir <dir> --tag <vX.Y.Z> --out <file>
//   node ci-latest-json.mjs merge --fragments-dir <dir> --version <X.Y.Z> --out <file>

import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, basename } from 'node:path';

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

// Map a signed updater bundle to the latest.json platform key(s). Tauri's
// universal macOS bundle serves both Apple Silicon and Intel, so it maps to
// two keys. Returns null for non-updater signatures we should ignore.
function platformKeysFor(bundleName) {
  if (bundleName.endsWith('.app.tar.gz')) {
    return ['darwin-aarch64', 'darwin-x86_64'];
  }
  if (bundleName.endsWith('.AppImage') || bundleName.endsWith('.AppImage.tar.gz')) {
    return ['linux-x86_64'];
  }
  if (bundleName.endsWith('-setup.exe') || bundleName.endsWith('.msi')) {
    return ['windows-x86_64'];
  }
  return null;
}

function downloadUrl(repo, tag, bundleName) {
  return `https://github.com/${repo}/releases/download/${encodeURIComponent(
    tag,
  )}/${encodeURIComponent(bundleName)}`;
}

function buildFragment({ targetDir, tag, repo }) {
  const sigFiles = findSignatureFiles(targetDir).filter((p) =>
    p.includes('bundle'),
  );

  const platforms = {};
  for (const sigPath of sigFiles) {
    let bundleName = basename(sigPath).replace(/\.sig$/, '');
    // tauri-action uploads the universal macOS bundle renamed with an arch
    // suffix (Stigmer.app.tar.gz -> Stigmer_universal.app.tar.gz), so the
    // manifest URL must use the uploaded name, not the on-disk one.
    if (
      bundleName.endsWith('.app.tar.gz') &&
      sigPath.includes('universal-apple-darwin') &&
      !bundleName.includes('_universal')
    ) {
      bundleName = bundleName.replace(/\.app\.tar\.gz$/, '_universal.app.tar.gz');
    }
    const keys = platformKeysFor(bundleName);
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

function mergeFragments({ fragmentsDir, version }) {
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

main();
