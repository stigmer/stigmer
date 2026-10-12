// Pins the consumer check's linked packer: a standalone package that links
// another standalone package packs that package's own `file:` links first,
// so every packed manifest names only tarballs; a lib two packages link is
// packed once; a manifest is restored when its pack throws; a spec that is
// not a `file:` link passes through. Packs without npm: the injected pack
// records the manifest each directory carried at pack time.
// Run via `node --test scripts/lib/*.test.mjs` (wired into the root `npm test`).

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";

import { linkedPacker } from "./linked-tarballs.mjs";

let root;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "linked-tarballs-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function writePackage(dir, manifest) {
  mkdirSync(join(root, dir), { recursive: true });
  writeFileSync(join(root, dir, "package.json"), JSON.stringify(manifest, null, 2) + "\n");
}

function readPackage(dir) {
  return readFileSync(join(root, dir, "package.json"), "utf8");
}

/** A pack that records each directory's manifest at pack time and names a fake tarball. */
function recordingPack() {
  const manifests = new Map();
  const calls = [];
  const pack = (dir) => {
    calls.push(dir);
    manifests.set(dir, JSON.parse(readFileSync(join(dir, "package.json"), "utf8")));
    return `/packed/${dir.slice(root.length + 1).replaceAll("/", "-")}.tgz`;
  };
  return { pack, manifests, calls };
}

// A layout in the shape of a package that links the server: the package
// links the server and a lib; the server links the same lib and one more.
function writeTwoLevelLayout() {
  writePackage("libs/protos", { name: "@stigmer/protos", dependencies: { "@bufbuild/protobuf": "2.12.0" } });
  writePackage("libs/outbound", { name: "@stigmer/outbound" });
  writePackage("server", {
    name: "@stigmer/server",
    dependencies: {
      "@stigmer/protos": "file:../libs/protos",
      "@stigmer/outbound": "file:../libs/outbound",
      pg: "8.23.0",
    },
  });
  writePackage("pkg/server", {
    name: "@stigmer/linking",
    dependencies: {
      "@stigmer/server": "file:../../server",
      "@stigmer/protos": "file:../../libs/protos",
      ulidx: "2.4.1",
    },
  });
}

test("a package linking a package that links a lib packs manifests naming only tarballs", () => {
  writeTwoLevelLayout();
  const { pack, manifests } = recordingPack();
  const { packDir } = linkedPacker(pack);

  assert.equal(packDir(join(root, "pkg/server")), "/packed/pkg-server.tgz");

  for (const [dir, manifest] of manifests) {
    for (const [name, spec] of Object.entries(manifest.dependencies ?? {})) {
      if (!name.startsWith("@stigmer/")) continue;
      assert.match(spec, /^file:\/packed\/.+\.tgz$/, `${dir} packed ${name} as ${spec}`);
    }
  }
  assert.deepEqual(manifests.get(join(root, "server")).dependencies, {
    "@stigmer/protos": "file:/packed/libs-protos.tgz",
    "@stigmer/outbound": "file:/packed/libs-outbound.tgz",
    pg: "8.23.0",
  });
});

test("a lib two packages link is packed once, and every manifest is restored after packing", () => {
  writeTwoLevelLayout();
  const before = ["server", "pkg/server"].map(readPackage);
  const { pack, calls } = recordingPack();
  const { packDir } = linkedPacker(pack);

  packDir(join(root, "pkg/server"));

  assert.equal(calls.filter((dir) => dir === join(root, "libs/protos")).length, 1);
  assert.equal(calls.length, 4);
  assert.deepEqual(["server", "pkg/server"].map(readPackage), before);
});

test("a manifest is restored when its pack throws", () => {
  writeTwoLevelLayout();
  const before = readPackage("server");
  const { pack: recording } = recordingPack();
  const pack = (dir) => {
    if (dir === join(root, "server")) throw new Error("pack failed");
    return recording(dir);
  };
  const { packDir } = linkedPacker(pack);

  assert.throws(() => packDir(join(root, "pkg/server")), /pack failed/);
  assert.equal(readPackage("server"), before);
});

test("a spec that is not a file: link passes through, and a package without links packs untouched", () => {
  writeTwoLevelLayout();
  const { pack, calls } = recordingPack();
  const { consumerResolvableSpecs } = linkedPacker(pack);

  assert.deepEqual(
    consumerResolvableSpecs({ "@stigmer/server": "3.41.1", "@stigmer/protos": "file:libs/protos", pg: "8.23.0" }, root),
    { "@stigmer/server": "3.41.1", "@stigmer/protos": "file:/packed/libs-protos.tgz" },
  );
  assert.deepEqual(calls, [join(root, "libs/protos")]);
});

test("a cycle of file: links is refused", () => {
  writePackage("a", { name: "@stigmer/a", dependencies: { "@stigmer/b": "file:../b" } });
  writePackage("b", { name: "@stigmer/b", dependencies: { "@stigmer/a": "file:../a" } });
  const { pack } = recordingPack();
  const { packDir } = linkedPacker(pack);

  assert.throws(() => packDir(join(root, "a")), /cycle/);
  assert.equal(JSON.parse(readPackage("a")).dependencies["@stigmer/b"], "file:../b");
});
