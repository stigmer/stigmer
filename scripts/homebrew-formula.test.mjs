// Tests for scripts/homebrew-formula.mjs, the one author of the Homebrew
// formula reconcile-homebrew.yaml pushes to stigmer/homebrew-tap.
// Run via `node --test scripts/homebrew-formula.test.mjs` (wired into root `npm test`).
//
// What these pin: the rendered formula is the Language::Node shape the tap has
// always carried, with the tarball and its sha256 in place and nothing else
// bundled; an input that is not an npm @stigmer/cli tarball or a sha256 is
// refused rather than rendered. And DESC passes the rules `brew style`
// enforces, each cited to Homebrew's rubocops/shared/desc_helper.rb, so a
// wording change the tap would refuse fails here first. What DESC says is
// the brand test's (brand/__tests__/positioning.test.ts).

import assert from "node:assert/strict";
import { test } from "node:test";

import { DESC, HOMEPAGE, renderFormula } from "./homebrew-formula.mjs";

const TARBALL = "https://registry.npmjs.org/@stigmer/cli/-/cli-0.1.0.tgz";
const SHA256 = "7bd8c669245049ba632464b53a3f2f869eef1d79fb4bdb732ab47d0a8d13c252";

test("the formula is the Language::Node shape, pinned to one tarball", () => {
  const formula = renderFormula({ tarballUrl: TARBALL, sha256: SHA256 });
  const lines = formula.split("\n");
  assert.equal(lines[0], 'require "language/node"');
  assert.equal(lines[2], "class Stigmer < Formula");
  assert.ok(lines.includes(`  desc "${DESC}"`), "desc carries DESC");
  assert.ok(lines.includes(`  homepage "${HOMEPAGE}"`), "homepage carries HOMEPAGE");
  assert.ok(lines.includes(`  url "${TARBALL}"`), "url is the tarball");
  assert.ok(lines.includes(`  sha256 "${SHA256}"`), "sha256 is the tarball's");
  assert.ok(lines.includes('  depends_on "node"'), "node is the only dependency");
  assert.ok(lines.includes('    system "npm", "install", *std_npm_args'), "installs from the npm tarball");
  assert.ok(lines.includes('    system "#{bin}/stigmer", "--version"'), "the test block runs the launcher");
  assert.ok(formula.endsWith("end\n"), "ends with the class's end and a newline");
  assert.equal(formula.match(/^\s*url /gm)?.length, 1, "one url: nothing else is bundled");
});

test("the reconcile's version parse reads the tarball's version back", () => {
  // reconcile-homebrew.yaml: sed -n 's#.*/cli/-/cli-\(.*\)\.tgz".*#\1#p'
  const formula = renderFormula({ tarballUrl: TARBALL, sha256: SHA256 });
  const versions = [...formula.matchAll(/\/cli\/-\/cli-(.*)\.tgz"/g)].map((m) => m[1]);
  assert.deepEqual(versions, ["0.1.0"]);
});

test("an input that is not an npm @stigmer/cli tarball or a sha256 is refused", () => {
  assert.throws(() => renderFormula({ tarballUrl: "https://example.com/cli-0.1.0.tgz", sha256: SHA256 }), /tarball/);
  assert.throws(() => renderFormula({ tarballUrl: "", sha256: SHA256 }), /tarball/);
  assert.throws(() => renderFormula({ tarballUrl: TARBALL, sha256: SHA256.toUpperCase() }), /sha256/);
  assert.throws(() => renderFormula({ tarballUrl: TARBALL, sha256: "" }), /sha256/);
});

// Homebrew's description rules, in desc_helper.rb's order (audit_desc).
test("DESC passes the rules brew style enforces", () => {
  assert.ok(DESC.length > 0, "not empty");
  assert.doesNotMatch(DESC, /^\s+/, "no leading spaces");
  assert.doesNotMatch(DESC, /\s+$/, "no trailing spaces");
  assert.doesNotMatch(DESC, /command ?line/i, 'spelled "command-line"');
  assert.doesNotMatch(DESC, /^(?:the|an?)(?=\s)/i, "does not start with an article");
  assert.doesNotMatch(DESC, /^[a-z]/, "starts with a capital letter");
  assert.doesNotMatch(DESC, /^stigmer\b/i, "does not start with the formula's name");
  assert.doesNotMatch(DESC, /\.$/, "no full stop at the end");
  assert.doesNotMatch(DESC, /\p{So}/u, "no emoji or other symbols");
  assert.ok(DESC.length <= 80, `at most 80 characters (MAX_DESC_LENGTH), got ${DESC.length}`);
});
