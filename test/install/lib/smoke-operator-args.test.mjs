// Pins the operator install test's command line
// (test/install/lib/smoke-operator-args.mjs): a source build by default; a
// packaged chart with source-built images; a published release, which needs
// its version and its packaged chart and runs only the profiles that build
// nothing; and a sentence for every argument it cannot act on. The install
// itself is exercised by running the test (`make smoke-operator`), not here.
// Run via `npm run test:scripts`.

import assert from "node:assert/strict";
import { test } from "node:test";

import { PROFILES, PUBLISHED_PROFILES, parseSmokeOperatorArgs } from "./smoke-operator-args.mjs";

test("no flags is a source build of the bundled and byo profiles from the checkout's chart", () => {
  assert.deepEqual(parseSmokeOperatorArgs([]), {
    profiles: ["bundled", "byo"],
    cluster: "",
    keep: false,
    fakeModel: "reply",
    chart: undefined,
    published: undefined,
  });
});

test("a packaged chart with source-built images takes any profile", () => {
  const args = parseSmokeOperatorArgs(["--chart=dist/stigmer-operator-0.3.0.tgz", `--profiles=${PROFILES.join(",")}`, "--keep"]);
  assert.equal(args.chart, "dist/stigmer-operator-0.3.0.tgz");
  assert.deepEqual(args.profiles, [...PROFILES]);
  assert.equal(args.published, undefined);
  assert.equal(args.keep, true);
});

test("a published release: its tag with a v, from a version given with or without one", () => {
  for (const version of ["v0.3.0", "0.3.0"]) {
    const args = parseSmokeOperatorArgs(["--published", `--version=${version}`, "--chart=c.tgz", "--profiles=bundled"]);
    assert.deepEqual(args.published, { tag: "v0.3.0" });
  }
  assert.deepEqual(parseSmokeOperatorArgs(["--published", "--version=v0.3.0-rc.1", "--chart=c.tgz"]).published, { tag: "v0.3.0-rc.1" });
});

test("a published release needs its version and its packaged chart, and runs only the profiles that build nothing", () => {
  assert.throws(() => parseSmokeOperatorArgs(["--published", "--chart=c.tgz"]), /--published needs --version=vX\.Y\.Z/);
  assert.throws(() => parseSmokeOperatorArgs(["--published", "--version=0.3", "--chart=c.tgz"]), /--published needs --version=vX\.Y\.Z.*"0\.3"/);
  assert.throws(() => parseSmokeOperatorArgs(["--published", "--version=v0.3.0"]), /--published needs --chart=/);
  assert.throws(
    () => parseSmokeOperatorArgs(["--published", "--version=v0.3.0", "--chart=c.tgz", "--profiles=bundled,substrate,upgrade"]),
    /--published runs only bundled, byo: substrate, upgrade need a source build/,
  );
  assert.deepEqual(PUBLISHED_PROFILES, ["bundled", "byo"]);
});

test("a version without --published, an unknown profile and a stray flag are refused in words", () => {
  assert.throws(() => parseSmokeOperatorArgs(["--version=v0.3.0"]), /--version names a published release: pass it with --published/);
  assert.throws(() => parseSmokeOperatorArgs(["--profiles=bundled,fleet"]), /unknown profile 'fleet'/);
  assert.throws(() => parseSmokeOperatorArgs(["--build"]), /unknown argument: --build/);
  assert.throws(() => parseSmokeOperatorArgs(["--fake-model=maybe"]), /--fake-model must be one of/);
});
