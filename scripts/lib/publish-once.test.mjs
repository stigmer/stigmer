/**
 * publish-once.test.mjs — what publishOnce does with a package the registry
 * lacks, already holds unchanged, or holds with other contents, so a stopped
 * release's npm run can be run again (stigmer/stigmer#3168); the decision,
 * the accepted commit, and the command line. npm is a recording fake: each
 * case reads which npm calls ran, so a skip that still published, or a
 * refusal after publishing, fails here.
 */

import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";

import {
  acceptFromEnv,
  isNotFound,
  parseArgs,
  publishDecision,
  publishOnce,
  readRegistry,
} from "./publish-once.mjs";

const RELEASE = "9c0d6f651cda5a5fc0acd35a98570c7e379b5359";
const OTHER = "1111111111111111111111111111111111111111";

/** A package dir holding @stigmer/demo@0.2.0, removed after `body`. */
function withPackage(body) {
  const dir = mkdtempSync(join(tmpdir(), "publish-once-"));
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({ name: "@stigmer/demo", version: "0.2.0" }),
  );
  try {
    return body(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * A fake npm: `view` answers `registry` (an object, or "404" for npm's E404),
 * `pack` answers `local`'s integrity, `publish` records. Every call's first
 * argument is kept in `calls`.
 */
function fakeNpm({ registry, local = "sha512-local" }) {
  const calls = [];
  const npm = (args) => {
    calls.push(args[0]);
    if (args[0] === "view") {
      if (registry === "404") {
        const err = new Error("npm view failed");
        err.stderr =
          "npm error code E404\nnpm error 404 No match found for version 0.2.0";
        throw err;
      }
      return registry === undefined ? "" : JSON.stringify(registry);
    }
    if (args[0] === "pack") return JSON.stringify([{ integrity: local }]);
    if (args[0] === "publish") return "";
    throw new Error(`unexpected npm ${args[0]}`);
  };
  return { npm, calls };
}

test("a version npm answers 404 for is published", () => {
  withPackage((dir) => {
    const { npm, calls } = fakeNpm({ registry: "404" });
    assert.equal(
      publishOnce(dir, { tag: "latest", npm, acceptFrom: undefined }),
      "publish",
    );
    assert.deepEqual(calls, ["view", "publish"]);
  });
});

test("an empty npm view answer counts as not published", () => {
  withPackage((dir) => {
    const { npm, calls } = fakeNpm({ registry: undefined });
    assert.equal(
      publishOnce(dir, { tag: "latest", npm, acceptFrom: undefined }),
      "publish",
    );
    assert.deepEqual(calls, ["view", "publish"]);
  });
});

test("the original stop: a version already on npm with the same contents is skipped, never published again", () => {
  withPackage((dir) => {
    const { npm, calls } = fakeNpm({
      registry: { "dist.integrity": "sha512-same", gitHead: RELEASE },
      local: "sha512-same",
    });
    assert.equal(
      publishOnce(dir, { tag: "latest", npm, acceptFrom: undefined }),
      "skip",
    );
    assert.deepEqual(calls, ["view", "pack"]);
  });
});

test("other contents are refused before any publish, naming both hashes", () => {
  withPackage((dir) => {
    const { npm, calls } = fakeNpm({
      registry: { "dist.integrity": "sha512-theirs", gitHead: RELEASE },
      local: "sha512-ours",
    });
    assert.throws(
      () => publishOnce(dir, { tag: "latest", npm, acceptFrom: undefined }),
      /@stigmer\/demo@0\.2\.0: .*sha512-theirs.*sha512-ours/,
    );
    assert.deepEqual(calls, ["view", "pack"]);
  });
});

test("other contents published from the accepted commit are kept, with no publish", () => {
  withPackage((dir) => {
    const { npm, calls } = fakeNpm({
      registry: { "dist.integrity": "sha512-theirs", gitHead: RELEASE },
      local: "sha512-ours",
    });
    assert.equal(
      publishOnce(dir, { tag: "latest", npm, acceptFrom: RELEASE }),
      "skip",
    );
    assert.deepEqual(calls, ["view", "pack"]);
  });
});

test("other contents from another commit are refused even when a commit is accepted", () => {
  withPackage((dir) => {
    const { npm, calls } = fakeNpm({
      registry: { "dist.integrity": "sha512-theirs", gitHead: OTHER },
      local: "sha512-ours",
    });
    assert.throws(
      () => publishOnce(dir, { tag: "latest", npm, acceptFrom: RELEASE }),
      /sha512-theirs/,
    );
    assert.deepEqual(calls, ["view", "pack"]);
  });
});

test("a dry run never reads the registry and rehearses the publish", () => {
  withPackage((dir) => {
    const { npm, calls } = fakeNpm({
      registry: { "dist.integrity": "sha512-x", gitHead: RELEASE },
    });
    assert.equal(
      publishOnce(dir, {
        tag: "next",
        dryRun: true,
        npm,
        acceptFrom: undefined,
      }),
      "publish",
    );
    assert.deepEqual(calls, ["publish"]);
  });
});

test("a registry failure other than 404 stops the run", () => {
  const npm = () => {
    const err = new Error("npm view failed");
    err.stderr = "npm error code ETIMEDOUT";
    throw err;
  };
  assert.throws(
    () => readRegistry("@stigmer/demo", "0.2.0", { npm }),
    /npm view failed/,
  );
});

test("publishDecision's three outcomes", () => {
  assert.deepEqual(publishDecision(undefined, "sha512-local", undefined), {
    act: "publish",
  });
  assert.deepEqual(
    publishDecision(
      { integrity: "sha512-same", gitHead: RELEASE },
      "sha512-same",
      undefined,
    ),
    {
      act: "skip",
    },
  );
  assert.equal(
    publishDecision({ integrity: "a", gitHead: undefined }, "b", RELEASE).act,
    "refuse",
  );
});

test("acceptFromEnv takes a full commit id, nothing when unset, and refuses anything else", () => {
  assert.equal(acceptFromEnv({}), undefined);
  assert.equal(acceptFromEnv({ PUBLISH_ONCE_ACCEPT_FROM: "" }), undefined);
  assert.equal(acceptFromEnv({ PUBLISH_ONCE_ACCEPT_FROM: RELEASE }), RELEASE);
  assert.throws(
    () => acceptFromEnv({ PUBLISH_ONCE_ACCEPT_FROM: "9c0d6f651c" }),
    /40-character/,
  );
  assert.throws(
    () => acceptFromEnv({ PUBLISH_ONCE_ACCEPT_FROM: "v0.2.0" }),
    /40-character/,
  );
});

test("isNotFound reads npm's E404 and nothing else", () => {
  assert.equal(
    isNotFound("npm error code E404\nnpm error 404 Not Found"),
    true,
  );
  assert.equal(isNotFound("npm error code E403"), false);
  assert.equal(isNotFound("npm error code ETIMEDOUT"), false);
});

test("parseArgs reads the directory, the tag and --dry-run in any order", () => {
  assert.deepEqual(parseArgs(["--tag", "latest", "pkgs/a"]), {
    dir: resolve("pkgs/a"),
    tag: "latest",
    dryRun: false,
  });
  assert.deepEqual(parseArgs(["pkgs/a", "--dry-run", "--tag", "next"]), {
    dir: resolve("pkgs/a"),
    tag: "next",
    dryRun: true,
  });
});

test("parseArgs refuses a missing directory or tag", () => {
  assert.throws(() => parseArgs(["--tag", "latest"]), /usage/);
  assert.throws(() => parseArgs(["pkgs/a"]), /usage/);
});

/** The lines of `text` that publish to npm without publish-once: a shell `npm publish`, or an argv starting `"publish", "--access"`. Comments are not commands. */
function barePublishes(text) {
  return text
    .split("\n")
    .filter((line) => !/^\s*(#|\/\/|\*)/.test(line))
    .filter(
      (line) =>
        /\bnpm publish\b/.test(line) || /\["publish",\s*"--access"/.test(line),
    );
}

test("the release lane publishes only through publish-once", () => {
  const root = resolve(import.meta.dirname, "..", "..");
  for (const path of [
    "scripts/publish-libs.mjs",
    "scripts/publish-standalone.mjs",
    ".github/workflows/release.npm-libs.yaml",
  ]) {
    assert.deepEqual(
      barePublishes(readFileSync(join(root, path), "utf8")),
      [],
      path,
    );
  }
});

test("barePublishes finds each form the release lane used before publish-once", () => {
  assert.equal(
    barePublishes(
      "      let publishCmd = `npm publish ${distDir} --access public --tag ${pkgTag}`;",
    ).length,
    1,
  );
  assert.equal(
    barePublishes(
      '    const publishArgs = ["publish", "--access", "public", "--tag", tag];',
    ).length,
    1,
  );
  assert.equal(
    barePublishes(
      '            (cd "$pkg" && npm publish --access public --tag "$NPM_TAG")',
    ).length,
    1,
  );
  assert.equal(
    barePublishes("          # Before the npm publish so a failed upload")
      .length,
    0,
  );
});
