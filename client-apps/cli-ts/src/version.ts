// The CLI's reported version, read from the package's own package.json at runtime
// so the published artifact always reports its real semver — package.json is the
// single source of truth (publish-libs.mjs stamps the release version into the
// published dist/package.json). A repo/source build reports the workspace
// sentinel "0.0.0-dev".
//
// Resolution walks up from this module to the nearest package.json named
// "@stigmer/cli". The relative depth differs across layouts (src/ in dev, dist/
// when compiled, the package root once published), so we search rather than
// hard-code a path. The name guard avoids picking up an unrelated ancestor
// package.json; if none is found, we fall back to the sentinel.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SENTINEL = "0.0.0-dev";
const PACKAGE_NAME = "@stigmer/cli";

function resolveVersion(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 8; i += 1) {
    const version = readVersionIfOwnPackage(join(dir, "package.json"));
    if (version !== null) return version;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return SENTINEL;
}

function readVersionIfOwnPackage(packageJsonPath: string): string | null {
  let raw: string;
  try {
    raw = readFileSync(packageJsonPath, "utf8");
  } catch {
    return null; // no package.json here — keep walking up
  }
  const pkg = JSON.parse(raw) as { name?: unknown; version?: unknown };
  if (pkg.name === PACKAGE_NAME && typeof pkg.version === "string") {
    return pkg.version;
  }
  return null;
}

export const VERSION = resolveVersion();
