// Every step that writes an image to a registry gives the index it writes the
// description GHCR shows on the package page. Run via
// `node --test scripts/release-image-annotations.test.mjs` (wired into root
// `npm test`).
//
// GHCR reads a multi-platform image's description from the index annotation
// `org.opencontainers.image.description`, not from the image config's label,
// and `docker buildx imagetools create` writes a new index that keeps no
// annotation it is not given. So one unannotated tag move (a `latest`
// promotion) blanks the page again. The rule, in two halves:
//   - a step that builds and pushes reads the words from the Dockerfile with
//     scripts/lib/image-description.mjs (or states them once in its `env:`,
//     as the Enterprise build passes them to its label too) and passes them
//     as `--annotation "index:org.opencontainers.image.description=…"`;
//   - a step that writes an index with `imagetools create` reads the words
//     from its source index, refuses a source with none, and passes them on.
// Each writing command carries the annotation, counted per step, because the
// sandbox build pushes through an argument array shared with a cache-only
// branch. Every workflow and local action is read, so a new lane is held to
// the rule without being listed here. The checker itself is pinned against
// small steps first, so a parser that finds nothing cannot pass vacuously.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { parse } from "yaml";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const RESOLVER = join(ROOT, "scripts/lib/image-description.mjs");

const ANNOTATION = /--annotation\s+"index:org\.opencontainers\.image\.description=\$\{IMAGE_DESCRIPTION\}"/g;
const ANY_DESCRIPTION_ANNOTATION = /--annotation\s+\S*org\.opencontainers\.image\.description/g;
const SOURCE_READ =
  /imagetools\s+inspect\s+"\$SOURCE"\s+--format\s+'\{\{ index \.Manifest\.Annotations "org\.opencontainers\.image\.description" \}\}'/;
const REFUSAL = /\[ -n "\$IMAGE_DESCRIPTION" \] \|\| \{[^}]*exit 1; \}/;
const RESOLVED = /IMAGE_DESCRIPTION="\$\(node scripts\/lib\/image-description\.mjs --file \S+( --target \S+)?\)"/;

/** A step's shell with its comment lines dropped, so prose never counts as a command. */
function shell(run) {
  return run
    .split("\n")
    .filter((line) => !line.trim().startsWith("#"))
    .join("\n");
}

const count = (text, re) => (text.match(new RegExp(re.source, "g")) ?? []).length;

/**
 * What is wrong with one step, or [] when nothing is. A step writes an image
 * when it runs `imagetools create`, or builds in a step that pushes.
 */
function stepProblems(step) {
  const problems = [];
  const uses = String(step.uses ?? "");
  if (/^docker\/build-push-action@/.test(uses) && String(step.with?.push) === "true") {
    if (!/org\.opencontainers\.image\.description/.test(String(step.with?.annotations ?? ""))) {
      problems.push("pushes with docker/build-push-action and no description annotation");
    }
  }
  if (typeof step.run !== "string") return problems;
  const text = shell(step.run);
  const creates = count(text, /\bimagetools\s+create\b/);
  const pushes = /--push\b|push=true|--output[= ]["']?type=registry/.test(text);
  const builds = pushes ? count(text, /\bdocker\s+(?:buildx\s+)?build\b/) : 0;
  const writers = creates + builds;
  if (writers === 0) {
    if (count(text, ANY_DESCRIPTION_ANNOTATION) > 0) {
      problems.push("annotates a description in a step that writes no image");
    }
    return problems;
  }
  const annotations = count(text, ANNOTATION);
  if (annotations !== writers) {
    problems.push(
      `writes ${writers} image index(es) but carries ${annotations} --annotation "index:org.opencontainers.image.description=\${IMAGE_DESCRIPTION}"`,
    );
  }
  if (count(text, ANY_DESCRIPTION_ANNOTATION) !== annotations) {
    problems.push("annotates the description with words other than ${IMAGE_DESCRIPTION}");
  }
  if (creates > 0) {
    if (!SOURCE_READ.test(text)) problems.push("writes an index without reading the description from its $SOURCE");
    if (!REFUSAL.test(text)) problems.push("writes an index without refusing a source that carries no description");
  }
  if (builds > 0) {
    const stated = typeof step.env?.IMAGE_DESCRIPTION === "string" && step.env.IMAGE_DESCRIPTION.trim() !== "";
    if (!RESOLVED.test(text) && !stated) {
      problems.push("builds without reading the description from its Dockerfile (scripts/lib/image-description.mjs) or stating it in env");
    }
  }
  return problems;
}

/** Every workflow and local composite action, with each step and where it is. */
function everyStep() {
  const out = [];
  const workflows = join(ROOT, ".github/workflows");
  for (const file of readdirSync(workflows).filter((f) => /\.ya?ml$/.test(f)).sort()) {
    const doc = parse(readFileSync(join(workflows, file), "utf8"));
    for (const [job, body] of Object.entries(doc?.jobs ?? {})) {
      (body.steps ?? []).forEach((step, i) => {
        out.push({ where: `${file} ${job} step "${step.name ?? i}"`, file, step });
      });
    }
  }
  const actions = join(ROOT, ".github/actions");
  for (const dir of readdirSync(actions)) {
    for (const name of ["action.yml", "action.yaml"]) {
      const path = join(actions, dir, name);
      if (!existsSync(path)) continue;
      const doc = parse(readFileSync(path, "utf8"));
      (doc?.runs?.steps ?? []).forEach((step, i) => {
        out.push({ where: `.github/actions/${dir}/${name} step "${step.name ?? i}"`, file: name, step });
      });
    }
  }
  return out;
}

test("the checker refuses a tag move that writes no description", () => {
  assert.notDeepEqual(stepProblems({ run: 'docker buildx imagetools create --tag "$I:latest" "$I:v1"' }), []);
});

test("the checker refuses a pushed build that writes no description", () => {
  assert.notDeepEqual(stepProblems({ run: "docker buildx build --tag x --push ." }), []);
});

test("the checker refuses a tag move that does not refuse an empty source", () => {
  const run = [
    'SOURCE="$I:v1"',
    `IMAGE_DESCRIPTION="$(docker buildx imagetools inspect "$SOURCE" --format '{{ index .Manifest.Annotations "org.opencontainers.image.description" }}')"`,
    'docker buildx imagetools create --annotation "index:org.opencontainers.image.description=${IMAGE_DESCRIPTION}" --tag "$I:latest" "$SOURCE"',
  ].join("\n");
  assert.deepEqual(stepProblems({ run }), ["writes an index without refusing a source that carries no description"]);
});

test("the checker refuses words written into the workflow instead of read", () => {
  const run = 'docker buildx build --annotation "index:org.opencontainers.image.description=Some words" --push .';
  assert.ok(stepProblems({ run }).length > 0);
});

test("the checker accepts a move that carries its source's words", () => {
  const run = [
    'SOURCE="$I:v1"',
    `IMAGE_DESCRIPTION="$(docker buildx imagetools inspect "$SOURCE" --format '{{ index .Manifest.Annotations "org.opencontainers.image.description" }}')"`,
    '[ -n "$IMAGE_DESCRIPTION" ] || { echo "none" >&2; exit 1; }',
    'docker buildx imagetools create --annotation "index:org.opencontainers.image.description=${IMAGE_DESCRIPTION}" --tag "$I:latest" "$SOURCE"',
  ].join("\n");
  assert.deepEqual(stepProblems({ run }), []);
});

test("the checker accepts a push through an argument array, and ignores a build that pushes nothing", () => {
  const run = [
    'IMAGE_DESCRIPTION="$(node scripts/lib/image-description.mjs --file a/Dockerfile --target sandbox)"',
    'OUTPUT=(--tag x --annotation "index:org.opencontainers.image.description=${IMAGE_DESCRIPTION}" --push)',
    'docker buildx build "${OUTPUT[@]}" .',
  ].join("\n");
  assert.deepEqual(stepProblems({ run }), []);
  assert.deepEqual(stepProblems({ run: "docker buildx build --builder default --tag probe/x ." }), []);
});

test("the checker reads prose in a comment as prose", () => {
  assert.deepEqual(stepProblems({ run: "# docker buildx imagetools create moves latest\necho hi" }), []);
});

test("every step that writes an image gives its index the description GHCR shows", () => {
  const problems = [];
  let writing = 0;
  const files = new Set();
  for (const { where, file, step } of everyStep()) {
    const text = typeof step.run === "string" ? shell(step.run) : "";
    if (/\bimagetools\s+create\b/.test(text) || (/--push\b/.test(text) && /\bbuild\b/.test(text))) {
      writing++;
      files.add(file);
    }
    for (const problem of stepProblems(step)) problems.push(`${where}: ${problem}`);
  }
  assert.deepEqual(problems, []);
  // The three release lanes write every image Stigmer publishes; a reader
  // that found fewer writing steps would be checking nothing.
  assert.ok(writing >= 14, `found only ${writing} image-writing steps`);
  for (const lane of ["release.mcp-server.yaml", "release.npm-libs.yaml", "release.runner-images.yaml"]) {
    assert.ok(files.has(lane), `${lane} has no image-writing step`);
  }
});

test("every Dockerfile and stage a lane reads its description from has one", () => {
  const seen = new Set();
  for (const { step } of everyStep()) {
    if (typeof step.run !== "string") continue;
    for (const match of shell(step.run).matchAll(/image-description\.mjs --file (\S+)(?: --target (\S+))?\)/g)) {
      const [, file, target] = match;
      // A target named by a loop variable is read for each value in the brand test's table.
      if (target?.includes("$")) continue;
      const key = `${file} ${target ?? ""}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const result = spawnSync(
        process.execPath,
        [RESOLVER, "--file", join(ROOT, file), ...(target ? ["--target", target] : [])],
        { encoding: "utf8" },
      );
      assert.equal(result.status, 0, `${file}${target ? ` --target ${target}` : ""}: ${result.stderr}`);
    }
  }
  assert.ok(seen.size >= 5, `the lanes read only ${seen.size} descriptions`);
});
