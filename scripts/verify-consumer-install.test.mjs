// Runs the consumer-install smoke end to end against a local fake registry
// and pins its exit codes, the contract publish-standalone.mjs retries on
// (stigmer/stigmer#1367). A release's stamped manifest pins its @stigmer/*
// libs to the version it just published; when npm does not serve one yet
// (ETARGET, as on v3.38.0, or a 404, as on v3.33.0) the smoke exits 75 so
// the release waits and retries. The same failure on a package the release
// does not pin is a real break and exits 1, as before. And npm's own error
// text still reaches the log, since the smoke now reads it to decide.
//
// Hermetic: npm's registry and cache point at a server and a directory this
// file owns, so no test touches npmjs.com. Run via
// `node --test scripts/verify-consumer-install.test.mjs` (wired into the root
// `npm test`).

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";

import { REGISTRY_LAG_EXIT } from "./lib/registry-lag.mjs";

const SMOKE = fileURLToPath(new URL("verify-consumer-install.mjs", import.meta.url));

let server;
let registry;
const scratch = mkdtempSync(join(tmpdir(), "consumer-install-test-"));

// A registry that lists only 1.0.0 of @stigmer/apis and of left-pad, and
// knows no other package: asking for any other version is ETARGET, any
// other package a 404 on its document.
before(async () => {
  server = createServer((request, response) => {
    const name = decodeURIComponent(request.url.slice(1));
    if (name !== "@stigmer/apis" && name !== "left-pad") {
      response.writeHead(404, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "Not found" }));
      return;
    }
    response.writeHead(200, { "content-type": "application/json" });
    response.end(
      JSON.stringify({
        name,
        "dist-tags": { latest: "1.0.0" },
        versions: {
          "1.0.0": { name, version: "1.0.0", dist: { tarball: `${registry}never-fetched.tgz` } },
        },
      }),
    );
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  registry = `http://127.0.0.1:${server.address().port}/`;
});

after(() => {
  server.close();
  rmSync(scratch, { recursive: true, force: true });
});

/** A built package whose manifest carries `dependencies`, as a release's stamp leaves it. */
function fixturePackage(label, dependencies) {
  const dir = join(scratch, label);
  mkdirSync(join(dir, "dist"), { recursive: true });
  writeFileSync(join(dir, "dist", "main.js"), "export {};\n");
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({
      name: "@stigmer/consumer-fixture",
      version: "3.38.0",
      type: "module",
      main: "dist/main.js",
      files: ["dist"],
      dependencies,
      stigmerPublish: { consumerCheck: { singleCopy: [], boot: ["dist/main.js"] } },
    }),
  );
  return dir;
}

/** Runs the smoke over `dir` with npm pointed at the fake registry; resolves its exit code and stderr. */
function smoke(dir) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [SMOKE, "--package", dir], {
      env: {
        ...process.env,
        npm_config_registry: registry,
        npm_config_cache: join(scratch, "npm-cache"),
        npm_config_update_notifier: "false",
      },
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stderr }));
  });
}

test("a pinned @stigmer lib npm does not list yet exits 75, with npm's own error still in the log", async () => {
  const { code, stderr } = await smoke(fixturePackage("etarget", { "@stigmer/apis": "3.38.0" }));
  assert.equal(code, REGISTRY_LAG_EXIT, stderr);
  assert.match(stderr, /npm error code ETARGET/);
  assert.match(stderr, /NOT YET — npm does not serve the pinned @stigmer\/apis yet/);
});

test("a pinned @stigmer lib whose document npm does not serve yet exits 75", async () => {
  const { code, stderr } = await smoke(fixturePackage("e404", { "@stigmer/outbound": "3.38.0" }));
  assert.equal(code, REGISTRY_LAG_EXIT, stderr);
  assert.match(stderr, /npm error code E404/);
});

test("the same miss on a package the release does not pin is a real failure: exit 1", async () => {
  const { code, stderr } = await smoke(fixturePackage("third-party", { "left-pad": "9.9.9" }));
  assert.equal(code, 1, stderr);
  assert.match(stderr, /npm error code ETARGET/);
  assert.match(stderr, /verify-consumer-install: FAIL — npm install exited 1/);
  assert.doesNotMatch(stderr, /NOT YET/);
});
