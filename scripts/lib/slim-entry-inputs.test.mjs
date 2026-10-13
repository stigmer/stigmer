// Pins the one-copy rule for a slim bundle built from another package's
// entry (bundle-slim.mjs --entry-package): every package taken from that
// package's own node_modules is named, once, with its directory; the server's
// inputs, the linked libraries' and the package's own sources pass. A rule that stopped
// matching would let a second copy of a shared package ship silently, because
// the check fails only when the rule finds something.
// Run via `node --test scripts/lib/*.test.mjs` (wired into the root `npm test`).

import assert from "node:assert/strict";
import { test } from "node:test";

import { entryPackageCopies } from "./slim-entry-inputs.mjs";

const OWN = "../../../ee/server/node_modules";

test("a bundle whose inputs come from the server's tree has no copy", () => {
  const inputs = [
    "../../../ee/server/dist/main.js",
    "../../../ee/server/dist/editions/enterprise.js",
    "dist/index.js",
    "node_modules/@bufbuild/protobuf/dist/cjs/index.js",
    "node_modules/pg/lib/index.js",
    "../../../apis/stubs/ts/dist/ai/stigmer/platform/v1/server_info_pb.js",
    "../../../node_modules/@bufbuild/protobuf/dist/cjs/index.js",
  ];
  assert.deepEqual(entryPackageCopies(inputs, OWN), []);
});

test("each package from the entry's own node_modules is named once, scoped or not, sorted", () => {
  const inputs = [
    "../../../ee/server/dist/main.js",
    `${OWN}/pg/lib/index.js`,
    `${OWN}/pg/lib/client.js`,
    `${OWN}/@bufbuild/protobuf/dist/cjs/index.js`,
    `${OWN}/@bufbuild/protobuf/dist/cjs/wkt/index.js`,
    `${OWN}/@connectrpc/connect/dist/cjs/index.js`,
    "node_modules/pg/lib/index.js",
  ];
  assert.deepEqual(entryPackageCopies(inputs, OWN), [
    { name: "@bufbuild/protobuf", dir: `${OWN}/@bufbuild/protobuf` },
    { name: "@connectrpc/connect", dir: `${OWN}/@connectrpc/connect` },
    { name: "pg", dir: `${OWN}/pg` },
  ]);
});

test("a package nested under another in the entry's tree is named by its outer package", () => {
  const inputs = [`${OWN}/pg/node_modules/pg-types/index.js`];
  assert.deepEqual(entryPackageCopies(inputs, OWN), [{ name: "pg", dir: `${OWN}/pg` }]);
});

test("Windows separators, a trailing separator and a namespaced input read the same", () => {
  const inputs = [
    "..\\..\\..\\ee\\server\\node_modules\\pg\\lib\\index.js",
    `(disabled):${OWN}/@bufbuild/protobuf/dist/cjs/index.js`,
  ];
  assert.deepEqual(entryPackageCopies(inputs, "..\\..\\..\\ee\\server\\node_modules\\"), [
    { name: "@bufbuild/protobuf", dir: `${OWN}/@bufbuild/protobuf` },
    { name: "pg", dir: `${OWN}/pg` },
  ]);
});

test("a sibling directory that merely shares the prefix is not the entry's tree", () => {
  const inputs = ["../../../ee/server/node_modules_cache/pg/index.js", "../../../ee/server/node_modules.js"];
  assert.deepEqual(entryPackageCopies(inputs, OWN), []);
});
