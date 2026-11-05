/**
 * What a package reaches through its links, read from the tracked manifests:
 * the one reading of "this package builds against that one" the repository's
 * guards share.
 *
 * scripts/lane-triggers.test.mjs holds each standalone package's lanes to
 * the packages it links (a lane that misses a link lets a change to that
 * library merge without the lane that builds against it, #1055). A second
 * guard that walked the manifests its own way would drift from that one on
 * what "reaches" means, so the walk lives here and both import it.
 *
 * A link is a `file:` specifier, or a root `workspaces` member named by
 * version (`"@stigmer/client": "*"`), which npm resolves to the member's
 * directory. From the package itself the walk reads its own install fields
 * (dependencies, devDependencies, optionalDependencies); from each package it
 * reaches, what a consumer compiles or runs from it (dependencies,
 * optionalDependencies, peerDependencies). A reached package's
 * devDependencies are its own build tools.
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, posix, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** The install fields a package's own build reads. */
const OWN_FIELDS = ["dependencies", "devDependencies", "optionalDependencies"];
/** The fields of a reached package that its consumer compiles or runs. */
const REACHED_FIELDS = [
  "dependencies",
  "optionalDependencies",
  "peerDependencies",
];

/** Every tracked manifest below the root, as repo-relative POSIX directory -> manifest. */
export function trackedManifests(rootDir = ROOT) {
  const listed = execFileSync(
    "git",
    ["ls-files", "-z", "--", ":(glob)**/package.json"],
    { cwd: rootDir, encoding: "utf8" },
  );
  const manifests = new Map();
  for (const file of listed.split("\0").filter(Boolean)) {
    const dir = posix.dirname(file);
    if (dir === ".") continue; // the workspace root itself
    manifests.set(dir, JSON.parse(readFileSync(join(rootDir, file), "utf8")));
  }
  return manifests;
}

/** The root `workspaces` members, as package name -> directory. */
export function workspaceDirsByName(rootDir, manifests) {
  const { workspaces } = JSON.parse(
    readFileSync(join(rootDir, "package.json"), "utf8"),
  );
  return new Map(workspaces.map((dir) => [manifests.get(dir).name, dir]));
}

/**
 * The directories a package links through the given fields: `file:` targets,
 * plus workspace members named by version when `byName` is given (a
 * standalone package cannot resolve those, so its own role passes none).
 */
function linksOf(dir, manifest, fields, byName) {
  const links = [];
  for (const field of fields) {
    for (const [name, spec] of Object.entries(manifest[field] ?? {})) {
      if (spec.startsWith("file:")) {
        links.push(
          posix.normalize(posix.join(dir, spec.slice("file:".length))),
        );
      } else if (byName?.has(name)) {
        links.push(byName.get(name));
      }
    }
  }
  return links;
}

/** Every package a standalone package's build reads through its links, sorted. */
export function linkClosure(dir, manifests, byName) {
  const reached = new Set();
  const visit = (from, fields, names) => {
    for (const target of linksOf(from, manifests.get(from), fields, names)) {
      if (target === dir || reached.has(target)) continue;
      if (!manifests.has(target)) {
        throw new Error(
          `${from}/package.json links ${target}, which has no tracked package.json`,
        );
      }
      reached.add(target);
      visit(target, REACHED_FIELDS, byName);
    }
  };
  visit(dir, OWN_FIELDS, undefined);
  return [...reached].sort();
}
