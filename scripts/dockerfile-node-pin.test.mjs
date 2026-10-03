// Every official Node image a pinned Dockerfile names is the repository's
// .nvmrc version, by digest.
// Run via `node --test scripts/dockerfile-node-pin.test.mjs` (wired into root `npm test`).
//
// The sandbox image carries two Nodes: the runner's own (/runner/bin/node)
// and the agent's (/usr/local/bin/node). Both come from one `node:` image,
// and that image floated with its tag (`node:22-slim`) while CI, the CLI and
// the desktop app run the .nvmrc version, so the runner in a sandbox could be
// a Node nothing else had tested. This test reads each Dockerfile below and
// fails, naming the line, when a `FROM` or `COPY --from` names a `node:`
// image whose tag is not `<.nvmrc>-<variant>` or that has no `@sha256:`
// digest. A Dockerfile joins the list when its Node is pinned the same way.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PINNED_DOCKERFILES = ["backend/services/runner/Dockerfile.sandbox"];

const NODE_IMAGE = /(?:^|\s|=)((?:docker\.io\/)?(?:library\/)?node:\S+)/;

/** The `node:` image references of a Dockerfile's FROM and COPY --from lines. */
export function nodeImageReferences(text) {
  const refs = [];
  text.split("\n").forEach((line, index) => {
    const instruction = line.trim();
    if (!/^(FROM|COPY)\s/i.test(instruction)) return;
    const candidate = /^FROM/i.test(instruction)
      ? instruction
          .split(/\s+/)
          .find((word, i) => i > 0 && !word.startsWith("--"))
      : instruction.match(/--from=(\S+)/)?.[1];
    if (candidate && NODE_IMAGE.test(` ${candidate}`))
      refs.push({ line: index + 1, image: candidate });
  });
  return refs;
}

/** Why `image` is not the pinned version by digest, or null when it is. */
export function pinProblem(image, version) {
  const match = image.match(/node:([^@\s]+)(@sha256:[0-9a-f]{64})?$/);
  if (!match) return "is not a node:<tag> reference";
  const [, tag, digest] = match;
  if (tag !== version && !tag.startsWith(`${version}-`))
    return `tag ${tag} is not the .nvmrc version ${version}`;
  if (!digest) return "has no @sha256: digest";
  return null;
}

const nvmrc = readFileSync(join(ROOT, ".nvmrc"), "utf8").trim();

for (const file of PINNED_DOCKERFILES) {
  test(`${file} names Node ${nvmrc} by digest`, () => {
    const refs = nodeImageReferences(readFileSync(join(ROOT, file), "utf8"));
    assert.ok(
      refs.length > 0,
      `${file} names no node: image; remove it from PINNED_DOCKERFILES or pin its Node`,
    );
    const problems = refs
      .map(({ line, image }) => ({
        line,
        image,
        problem: pinProblem(image, nvmrc),
      }))
      .filter((r) => r.problem !== null)
      .map((r) => `${file}:${r.line} ${r.image} ${r.problem}`);
    assert.deepEqual(problems, []);
  });
}

test("a floating tag, another version and a missing digest are each refused", () => {
  const digest = `@sha256:${"a".repeat(64)}`;
  assert.equal(
    pinProblem(`node:22.22.1-bookworm-slim${digest}`, "22.22.1"),
    null,
  );
  assert.match(
    pinProblem(`node:22-slim${digest}`, "22.22.1"),
    /not the .nvmrc version/,
  );
  assert.match(
    pinProblem(`node:22.22.0-bookworm-slim${digest}`, "22.22.1"),
    /not the .nvmrc version/,
  );
  assert.match(
    pinProblem("node:22.22.1-bookworm-slim", "22.22.1"),
    /no @sha256: digest/,
  );
});

test("FROM and COPY --from are both read; stage names and other images are not", () => {
  const refs = nodeImageReferences(
    [
      "FROM node:22-slim AS libs",
      "FROM --platform=$BUILDPLATFORM node:22.22.1-bookworm-slim AS tools",
      "FROM libs AS builder",
      "COPY --from=node:22-slim /usr/local/bin/node /usr/local/bin/node",
      "COPY --from=golang:1.25-bookworm /usr/local/go /usr/local/go",
      "COPY --from=libs /out /out",
      "# FROM node:20 in a comment",
    ].join("\n"),
  );
  assert.deepEqual(refs, [
    { line: 1, image: "node:22-slim" },
    { line: 2, image: "node:22.22.1-bookworm-slim" },
    { line: 4, image: "node:22-slim" },
  ]);
});
