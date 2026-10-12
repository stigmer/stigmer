/**
 * Packs a standalone package's dev-tree `@stigmer/*` `file:` links into
 * tarballs a consumer install can resolve, for
 * scripts/verify-consumer-install.mjs.
 *
 * A packed tarball keeps its manifest as committed, so a `file:` link inside
 * it names a path that does not exist where the tarball is installed. The
 * check therefore rewrites each link to a packed tarball before packing.
 * A standalone package may link another standalone package, whose own
 * manifest carries `file:` links of its own; so packing a linked directory
 * first packs ITS links, recursively, rewrites its manifest to name those
 * tarballs, packs, and restores the manifest whether or not the pack
 * succeeds. Packing is memoised per directory, so a lib two packages link is
 * packed once and every manifest names the same tarball.
 *
 * `pack(dir)` is injected: the script packs with `npm pack` (after checking
 * the directory is built), and the test packs without npm.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const FILE_PREFIX = "file:";

/**
 * Returns `{ packDir, consumerResolvableSpecs }` over one memo.
 *
 * `pack(dir)` packs a directory as it stands and returns the tarball path.
 * `onRewrite(dir, name, spec)`, optional, is told of each link rewritten.
 */
export function linkedPacker(pack, onRewrite = () => {}) {
  const packed = new Map();
  const packing = new Set();

  /** Packs `dir` with its own `@stigmer/*` links packed first; returns the tarball path. */
  function packDir(dir) {
    const key = resolve(dir);
    if (packed.has(key)) return packed.get(key);
    if (packing.has(key)) {
      throw new Error(`file: links form a cycle through ${key}`);
    }
    packing.add(key);
    try {
      const manifestPath = join(key, "package.json");
      const original = readFileSync(manifestPath, "utf8");
      const manifest = JSON.parse(original);
      const rewritten = consumerResolvableSpecs(manifest.dependencies, key);
      const changed = Object.entries(rewritten).filter(
        ([name, spec]) => manifest.dependencies[name] !== spec,
      );
      let tarball;
      if (changed.length === 0) {
        tarball = pack(key);
      } else {
        for (const [name, spec] of changed) {
          manifest.dependencies[name] = spec;
          onRewrite(key, name, spec);
        }
        writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
        try {
          tarball = pack(key);
        } finally {
          writeFileSync(manifestPath, original);
        }
      }
      packed.set(key, tarball);
      return tarball;
    } finally {
      packing.delete(key);
    }
  }

  /**
   * For a manifest's `@stigmer/*` dependencies, returns the spec a consumer
   * install can resolve: a packed tarball for each dev-tree `file:` link,
   * the spec itself otherwise (a version the release lane already pinned).
   */
  function consumerResolvableSpecs(deps, baseDir) {
    const out = {};
    for (const [name, spec] of Object.entries(deps ?? {})) {
      if (!name.startsWith("@stigmer/")) continue;
      out[name] = spec.startsWith(FILE_PREFIX)
        ? `${FILE_PREFIX}${packDir(resolve(baseDir, spec.slice(FILE_PREFIX.length)))}`
        : spec;
    }
    return out;
  }

  return { packDir, consumerResolvableSpecs };
}
