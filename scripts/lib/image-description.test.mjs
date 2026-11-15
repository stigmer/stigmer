// Pins how scripts/lib/image-description.mjs reads an image's description
// from its Dockerfile, the value the release lanes write as the index
// annotation GHCR shows: stage chains (a later stage inherits an earlier
// one's label until it sets its own), ARG defaults and --build-arg overrides
// (applied only to an ARG the stage declares), global ARGs, quoting and
// continuations, an image with no description, and the CLI's contract (prints
// the words; exits non-zero on none). Run via `npm run test:scripts`.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { imageDescription } from "./image-description.mjs";

const CLI = resolve(dirname(fileURLToPath(import.meta.url)), "image-description.mjs");

const CHAIN = `
# a comment
FROM debian AS base
ARG IMAGE_DESCRIPTION="the base: tools, with no runner"
LABEL org.opencontainers.image.source="https://example.test" \\
      org.opencontainers.image.description="\${IMAGE_DESCRIPTION}"

FROM scratch AS layer
LABEL org.opencontainers.image.description='literal \${NOT_EXPANDED}'

FROM base AS sandbox
COPY a b

FROM sandbox AS compose
ARG IMAGE_DESCRIPTION="compose: the runner and the CLI"
LABEL org.opencontainers.image.description="\${IMAGE_DESCRIPTION}"
`;

test("the target stage's own label wins", () => {
  assert.equal(imageDescription(CHAIN, { target: "compose" }), "compose: the runner and the CLI");
});

test("a stage with no label inherits the nearest one on its FROM chain", () => {
  assert.equal(imageDescription(CHAIN, { target: "sandbox" }), "the base: tools, with no runner");
});

test("with no target the last stage is read, as docker build does", () => {
  assert.equal(imageDescription(CHAIN), "compose: the runner and the CLI");
});

test("single quotes are literal", () => {
  assert.equal(imageDescription(CHAIN, { target: "layer" }), "literal ${NOT_EXPANDED}");
});

test("a --build-arg overrides the ARG default of the stage that declares it", () => {
  assert.equal(
    imageDescription(CHAIN, { target: "base", buildArgs: { IMAGE_DESCRIPTION: "overridden" } }),
    "overridden",
  );
});

test("a --build-arg the stage does not declare changes nothing", () => {
  assert.equal(
    imageDescription(CHAIN, { target: "layer", buildArgs: { IMAGE_DESCRIPTION: "ignored" } }),
    "literal ${NOT_EXPANDED}",
  );
});

test("stage names match case-insensitively, as Docker's do", () => {
  assert.equal(imageDescription(CHAIN, { target: "SANDBOX" }), "the base: tools, with no runner");
});

test("an image with no description reads as undefined", () => {
  assert.equal(imageDescription("FROM node\nLABEL org.opencontainers.image.vendor=x\n"), undefined);
});

test("a FROM of an outside image is not followed", () => {
  const text = "FROM base AS base\nRUN true\n";
  assert.equal(imageDescription(text), undefined);
});

test("a global ARG gives its default to a stage that redeclares it bare", () => {
  const text = 'ARG WORDS="from the top"\nFROM node\nARG WORDS\nLABEL org.opencontainers.image.description="$WORDS"\n';
  assert.equal(imageDescription(text), "from the top");
});

test("${NAME:-default} falls back when the ARG is empty", () => {
  const text = 'FROM node\nARG WORDS=""\nLABEL org.opencontainers.image.description="${WORDS:-the fallback}"\n';
  assert.equal(imageDescription(text), "the fallback");
});

test("the last LABEL of a stage wins, and the legacy key-value form is read", () => {
  const text =
    "FROM node\nLABEL org.opencontainers.image.description first words\nLABEL org.opencontainers.image.description=\"second words\"\n";
  assert.equal(imageDescription(text), "second words");
});

test("a variable the stage never declares is refused, not read as empty", () => {
  const text = 'FROM node\nLABEL org.opencontainers.image.description="${UNDECLARED}"\n';
  assert.throws(() => imageDescription(text), /UNDECLARED.*not an ARG/);
});

test("an unknown target is refused", () => {
  assert.throws(() => imageDescription(CHAIN, { target: "nope" }), /no stage named nope/);
});

test("escaped quotes inside double quotes are kept", () => {
  const text = 'FROM node\nLABEL org.opencontainers.image.description="Stigmer\'s \\"MCP\\" server"\n';
  assert.equal(imageDescription(text), 'Stigmer\'s "MCP" server');
});

function cli(text, ...args) {
  const dir = mkdtempSync(join(tmpdir(), "image-description-"));
  try {
    const file = join(dir, "Dockerfile");
    writeFileSync(file, text);
    return spawnSync(process.execPath, [CLI, "--file", file, ...args], { encoding: "utf8" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("the CLI prints the description of the named stage with build-arg overrides", () => {
  const plain = cli(CHAIN, "--target", "sandbox");
  assert.equal(plain.status, 0, plain.stderr);
  assert.equal(plain.stdout, "the base: tools, with no runner\n");
  const overridden = cli(CHAIN, "--target", "base", "--build-arg", "IMAGE_DESCRIPTION=a=b c");
  assert.equal(overridden.stdout, "a=b c\n");
});

test("the CLI exits non-zero, naming the file, when the image has no description", () => {
  const result = cli("FROM node\n");
  assert.notEqual(result.status, 0);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /sets no org\.opencontainers\.image\.description label/);
});

test("the CLI reads every published Dockerfile in this repository", () => {
  const root = resolve(dirname(CLI), "..", "..");
  for (const [file, target] of [
    ["mcp-server/Dockerfile", undefined],
    ["backend/services/stigmer-server/Dockerfile", undefined],
    ["deploy/all-in-one/Dockerfile", undefined],
    ["backend/services/runner/Dockerfile.sandbox", "sandbox"],
  ]) {
    const result = spawnSync(
      process.execPath,
      [CLI, "--file", join(root, file), ...(target ? ["--target", target] : [])],
      { encoding: "utf8" },
    );
    assert.equal(result.status, 0, `${file}: ${result.stderr}`);
    assert.ok(result.stdout.trim().length > 0, file);
  }
});
