#!/usr/bin/env node

/**
 * Copies one release's @stigmer/* packages from npmjs.com into Stigmer's own
 * npm repository, byte for byte, so a consumer that routes the @stigmer scope
 * there installs a release and a dev build from one place. The npm twin of an
 * image mirror: a release publishes once, to npmjs.com, and this copies what
 * was published; it never rebuilds.
 *
 * The release set is read from the scripts that publish it, never re-listed:
 * publish-libs.mjs's PACKAGES and publish-standalone.mjs's
 * STANDALONE_PACKAGES, each package named by its manifest.
 *
 * For each package, in that order (a package's @stigmer/* dependencies
 * publish before it, so the copy is installable the moment it lands):
 *   1. Read the version from npmjs.com: its tarball, its `dist.integrity`, and
 *      the dist-tag that names it there (`latest`, `next`, ...; a version no
 *      tag names any more is copied under `mirrored`, so a backfill of an old
 *      release never moves the target's `latest` back).
 *   2. Read the target. A version already there with the same integrity is
 *      done (a re-run is a no-op); one with another integrity is refused,
 *      because the two registries would then serve different bytes under one
 *      version, and npm never lets a version be replaced.
 *   3. Download the tarball, check its sha512 against the integrity npmjs.com
 *      published, and `npm publish <tarball> --tag <tag>`. npm sends a scoped
 *      package to the scope's registry, which the workflow points at the
 *      target (setup-node's `registry-url` and `scope`), with its token.
 *   4. Read the target again until it lists the version, and require the
 *      same integrity.
 * Every refusal says the release is on npmjs.com only until the mirror is
 * re-run, which is the whole recovery: each step is idempotent.
 *
 * Usage (release.npm-mirror.yaml):
 *   node scripts/mirror-npm-release.mjs --version 0.1.0
 *   node scripts/mirror-npm-release.mjs --version 0.1.0 --list   # print the release set
 *
 * The target is the registry npm is configured to send @stigmer/* to
 * (`configuredRegistry`), and it must not be npmjs.com. Reads send
 * NODE_AUTH_TOKEN as a bearer token when it is set; both registries also
 * answer anonymously.
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

import { PACKAGES } from "./publish-libs.mjs";
import { configuredRegistry, STANDALONE_PACKAGES } from "./publish-standalone.mjs";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

export const SOURCE_REGISTRY = "https://registry.npmjs.org/";

/** The dist-tag a version no tag names any more is copied under. */
export const UNTAGGED = "mirrored";

/** How long one registry request may take. */
export const REQUEST_TIMEOUT_MS = 30_000;

/** How often, and how many times, step 4 asks the target for the new version. */
export const SETTLE_INTERVAL_MS = 5_000;
export const SETTLE_ATTEMPTS = 24;

const RECOVERY = "the release is on npmjs.com only until this mirror is re-run";

/** A release's npm package names, in publish order, read from the publishing scripts. */
export function releaseSet(readManifest = (dir) => JSON.parse(readFileSync(resolve(repoRoot, dir, "package.json"), "utf8"))) {
  return [...PACKAGES, ...STANDALONE_PACKAGES].map((dir) => readManifest(dir).name);
}

/**
 * The dist-tag to copy a version under: the one npmjs.com names it by, with
 * `latest` and then `next` preferred when several do, or UNTAGGED.
 */
export function tagFor(distTags, version) {
  const naming = Object.entries(distTags ?? {})
    .filter(([, v]) => v === version)
    .map(([tag]) => tag);
  for (const preferred of ["latest", "next"]) {
    if (naming.includes(preferred)) return preferred;
  }
  return naming.sort()[0] ?? UNTAGGED;
}

/** The `sha512-<base64>` integrity npm records for these bytes. */
export function integrityOf(bytes) {
  return `sha512-${createHash("sha512").update(bytes).digest("base64")}`;
}

/** A registry's packument URL for a scoped name, escaped as npm's client does. */
export function packumentUrl(registry, name) {
  const base = registry.endsWith("/") ? registry : `${registry}/`;
  return `${base}${name.replaceAll("/", "%2f")}`;
}

function authHeaders(token) {
  return token ? { authorization: `Bearer ${token}` } : {};
}

/** A package's packument, or `null` when the registry has never seen the name. */
export async function readPackument(registry, name, { fetchImpl = fetch, token } = {}) {
  const url = packumentUrl(registry, name);
  const response = await fetchImpl(url, {
    headers: { accept: "application/json", ...authHeaders(token) },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`${url} answered HTTP ${response.status}`);
  return response.json();
}

/**
 * Mirror one package's version. Returns "copied" or "present"; throws with
 * the recovery on anything else. Every outside effect is a parameter, so the
 * test drives it with a fake registry pair and a fake publish.
 */
export async function mirrorPackage(
  name,
  version,
  { target, source = SOURCE_REGISTRY, fetchImpl = fetch, token, publish, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), workDir },
) {
  const origin = await readPackument(source, name, { fetchImpl });
  const published = origin?.versions?.[version];
  if (!published) throw new Error(`${name}@${version} is not on npmjs.com, so there is nothing to mirror`);
  const { tarball, integrity } = published.dist ?? {};
  if (!tarball || !integrity?.startsWith("sha512-")) {
    throw new Error(`${name}@${version} on npmjs.com names no tarball with a sha512 integrity`);
  }

  const already = (await readPackument(target, name, { fetchImpl, token }))?.versions?.[version];
  if (already) {
    if (already.dist?.integrity === integrity) return "present";
    throw new Error(
      `${name}@${version} is in ${target} with integrity ${already.dist?.integrity}, not npmjs.com's ${integrity}; ` +
        "a version is never replaced, so this needs a person",
    );
  }

  const download = await fetchImpl(tarball, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  if (!download.ok) throw new Error(`${tarball} answered HTTP ${download.status}; ${RECOVERY}`);
  const bytes = Buffer.from(await download.arrayBuffer());
  if (integrityOf(bytes) !== integrity) {
    throw new Error(`${tarball} does not match the integrity npmjs.com published (${integrity}); ${RECOVERY}`);
  }
  const file = join(workDir, `${name.replace("@", "").replace("/", "-")}-${version}.tgz`);
  writeFileSync(file, bytes);
  publish(file, tagFor(origin["dist-tags"], version));

  for (let attempt = 1; attempt <= SETTLE_ATTEMPTS; attempt++) {
    const copy = (await readPackument(target, name, { fetchImpl, token }))?.versions?.[version];
    if (copy) {
      if (copy.dist?.integrity === integrity) return "copied";
      throw new Error(`${name}@${version} landed in ${target} with integrity ${copy.dist?.integrity}, not ${integrity}`);
    }
    if (attempt < SETTLE_ATTEMPTS) await sleep(SETTLE_INTERVAL_MS);
  }
  throw new Error(`${name}@${version} was published but ${target} does not list it yet; ${RECOVERY}`);
}

/** The target, refused when it is npmjs.com (a copy onto itself proves nothing). */
export function mirrorTarget(registry) {
  const normalized = registry.endsWith("/") ? registry : `${registry}/`;
  if (!/^https:\/\//.test(normalized) || normalized === SOURCE_REGISTRY) {
    throw new Error(
      `npm sends @stigmer/* to '${registry}', not to Stigmer's npm repository; ` +
        "set @stigmer:registry (setup-node's registry-url with scope: '@stigmer')",
    );
  }
  return normalized;
}

async function main() {
  const { values } = parseArgs({
    options: { version: { type: "string" }, list: { type: "boolean", default: false } },
  });
  const names = releaseSet();
  if (values.list) {
    console.log(names.join("\n"));
    return;
  }
  const version = values.version ?? "";
  if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error(`--version must be a release version (X.Y.Z or X.Y.Z-rc.N), got '${version}'`);
  }
  const target = mirrorTarget(configuredRegistry());
  const token = process.env.NODE_AUTH_TOKEN || undefined;
  const workDir = mkdtempSync(join(tmpdir(), "npm-mirror-"));
  console.log(`\n  mirror: ${names.length} packages at ${version}, ${SOURCE_REGISTRY} -> ${target}\n`);
  try {
    for (const name of names) {
      const outcome = await mirrorPackage(name, version, {
        target,
        token,
        workDir,
        publish: (file, tag) => {
          console.log(`  $ npm publish ${file} --tag ${tag}`);
          execFileSync("npm", ["publish", file, "--access", "public", "--tag", tag], { stdio: "inherit" });
        },
      });
      console.log(`  ${name}@${version}: ${outcome === "present" ? "already mirrored, same integrity" : "copied, same integrity"}`);
    }
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
  console.log(`\n=== Done: ${names.length} packages at ${version} in ${target} ===\n`);
}

// Only run when invoked directly (not when imported by tests).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`mirror-npm-release: ${message.includes(RECOVERY) ? message : `${message}; ${RECOVERY}`}`);
    process.exit(1);
  });
}
