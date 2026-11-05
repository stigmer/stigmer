// The hosted console's image builds from every package the console reaches,
// and a change to any of them builds the image.
// Run via `node --test scripts/console-image-closure.test.mjs` (wired into root `npm test`).
//
// client-apps/web/Dockerfile copies the console's workspace closure into its
// builder stage by hand: each member's manifest first (for the install
// layer), then each member's directory, then an `npm run build… -w` for each
// member whose exports a consumer resolves from compiled output. Service Hub
// builds that image only when a merge touches a path in
// client-apps/web/service.yaml's `build.triggers.paths` or its
// `projectRoot`. Both lists are kept by hand, and no CI lane builds the
// image, so a package added to the closure and to neither list fails only
// at the deploy: #2762 added @stigmer/react-core, which @stigmer/react-sdk
// depends on, and every hosted console build failed for six days on 624
// "Can't resolve '@stigmer/react-core'" errors before anyone saw it (#3006).
//
// So this test reads the closure from the manifests, with the walk
// lane-triggers.test.mjs uses (scripts/package-links.mjs, from the
// console as a workspace member), and holds three rules, each failure naming
// the package and the line it lacks:
//   1. the Dockerfile copies each member's package.json and its directory;
//   2. each member whose exports map names a ./dist/ file has an
//      `npm run build… -w <its name>` in the builder's RUN;
//   3. every member, and every other source the Dockerfile copies from the
//      build context (brand/, the root manifests, the console's own files),
//      is under a trigger path or the project root, so a change to it
//      builds the image.
// A member the Dockerfile copies that the console no longer reaches is not
// refused: an extra copy costs a layer, not a broken console.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, posix, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { parse } from "yaml";

import { linkClosure, trackedManifests, workspaceDirsByName } from "./package-links.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CONSOLE = "client-apps/web";
const DOCKERFILE = `${CONSOLE}/Dockerfile`;
const SERVICE = `${CONSOLE}/service.yaml`;

/** A Dockerfile's instructions, continuation lines joined, each with the line it starts on. */
export function instructions(text) {
  const out = [];
  let pending = null;
  text.split("\n").forEach((raw, index) => {
    const line = raw.trim();
    if (pending === null && (line === "" || line.startsWith("#"))) return;
    if (pending === null) pending = { line: index + 1, text: "" };
    if (line.startsWith("#")) return; // a comment inside a continued instruction
    const continued = line.endsWith("\\");
    pending.text += `${continued ? line.slice(0, -1) : line} `;
    if (!continued) {
      out.push({ line: pending.line, text: pending.text.trim() });
      pending = null;
    }
  });
  if (pending) out.push({ line: pending.line, text: pending.text.trim() });
  return out;
}

/**
 * What a Dockerfile takes from its build context, and what its RUN lines
 * build: `copies` holds each source of a COPY or ADD without `--from` (a
 * trailing slash dropped), with its line; `builds` holds each workspace an
 * `npm run build… -w <name>` names.
 */
export function readDockerfile(text) {
  const copies = [];
  const builds = new Set();
  for (const { line, text: instruction } of instructions(text)) {
    const [keyword, ...words] = instruction.split(/\s+/);
    if (/^(COPY|ADD)$/i.test(keyword)) {
      if (words.some((word) => word.startsWith("--from="))) continue;
      const operands = words.filter((word) => !word.startsWith("--"));
      for (const source of operands.slice(0, -1)) {
        copies.push({ line, source: source.replace(/\/$/, "") });
      }
    } else if (/^RUN$/i.test(keyword)) {
      for (const [, name] of instruction.matchAll(
        /npm run build(?::[\w:-]+)?\s+(?:-w|--workspace)[=\s]+(\S+)/g,
      )) {
        builds.add(name);
      }
    }
  }
  return { copies, builds };
}

/** True when an exports map resolves any condition to a file under ./dist/. */
export function exportsDist(exports) {
  if (typeof exports === "string") return exports.startsWith("./dist/");
  if (exports && typeof exports === "object") {
    return Object.values(exports).some(exportsDist);
  }
  return false;
}

/** True when `path` is `base` or below it. */
function under(path, base) {
  return path === base || path.startsWith(`${base}/`);
}

/**
 * Every rule the image breaks, one line each, for a closure (directory ->
 * manifest), a Dockerfile's text and a service's trigger paths and project
 * root.
 */
export function closureProblems({ closure, dockerfile, triggers, projectRoot }) {
  const { copies, builds } = readDockerfile(dockerfile);
  const copied = new Set(copies.map(({ source }) => source));
  const problems = [];
  for (const [dir, manifest] of closure) {
    const name = manifest.name;
    if (!copied.has(`${dir}/package.json`)) {
      problems.push(
        `${DOCKERFILE} copies no manifest for ${name}: add \`COPY ${dir}/package.json ${dir}/\` beside the other manifests`,
      );
    }
    if (!copied.has(dir)) {
      problems.push(
        `${DOCKERFILE} copies no source for ${name}: add \`COPY ${dir}/ ${dir}/\` beside the other packages`,
      );
    }
    if (exportsDist(manifest.exports) && !builds.has(name)) {
      problems.push(
        `${DOCKERFILE} builds no ${name}, whose exports name ./dist/: add \`npm run build -w ${name}\` to the builder's RUN`,
      );
    }
  }
  const watched = [projectRoot, ...triggers].map((path) => path.replace(/\/$/, ""));
  const unwatched = (path) => !watched.some((base) => under(path, base));
  for (const [dir, manifest] of closure) {
    if (unwatched(dir)) {
      problems.push(
        `${SERVICE} watches no ${dir}, where ${manifest.name} lives: add \`- ${dir}\` to build.triggers.paths`,
      );
    }
  }
  for (const { line, source } of copies) {
    if (closure.has(source) || closure.has(posix.dirname(source))) continue; // named above
    if (unwatched(source)) {
      problems.push(
        `${DOCKERFILE}:${line} copies ${source}, which no trigger path in ${SERVICE} watches: add \`- ${source}\` to build.triggers.paths`,
      );
    }
  }
  return problems;
}

test("the console image copies, builds and watches every package the console reaches", () => {
  const manifests = trackedManifests(ROOT);
  const byName = workspaceDirsByName(ROOT, manifests);
  const dirs = linkClosure(CONSOLE, manifests, byName, { member: true });
  assert.ok(
    dirs.length > 0,
    `${CONSOLE} reaches no workspace package; the closure walk is not reading its manifest`,
  );
  const service = parse(readFileSync(join(ROOT, SERVICE), "utf8"));
  const problems = closureProblems({
    closure: new Map(dirs.map((dir) => [dir, manifests.get(dir)])),
    dockerfile: readFileSync(join(ROOT, DOCKERFILE), "utf8"),
    triggers: service.spec.build.triggers.paths,
    projectRoot: service.spec.gitRepo.projectRoot,
  });
  assert.deepEqual(problems, []);
});

test("a workspace member's closure follows the members it names; a standalone package's does not", () => {
  const fake = new Map([
    ["app", { name: "app", dependencies: { "@stigmer/a": "*" } }],
    ["libs/a", { name: "@stigmer/a", dependencies: { "@stigmer/b": "*" } }],
    ["libs/b", { name: "@stigmer/b" }],
  ]);
  const names = new Map([
    ["app", "app"],
    ["@stigmer/a", "libs/a"],
    ["@stigmer/b", "libs/b"],
  ]);
  assert.deepEqual(linkClosure("app", fake, names, { member: true }), ["libs/a", "libs/b"]);
  assert.deepEqual(linkClosure("app", fake, names), []);
});

test("a missing manifest, source, build line or trigger path is each named", () => {
  const dockerfile = [
    "FROM node AS builder",
    "COPY package.json package-lock.json ./",
    "COPY libs/a/package.json libs/a/",
    "COPY libs/a/ libs/a/",
    "COPY libs/b/ libs/b/",
    "COPY --chown=node app/ app/",
    "COPY brand/ brand/",
    "RUN npm ci && \\",
    "    # the library's dist/",
    "    npm run build:css -w @stigmer/a",
    "FROM nginx",
    "COPY --from=builder /app/out /html",
  ].join("\n");
  const problems = closureProblems({
    closure: new Map([
      ["libs/a", { name: "@stigmer/a", exports: { "./x.css": "./dist/x.css" } }],
      ["libs/b", { name: "@stigmer/b", exports: { ".": { import: "./dist/index.js" } } }],
    ]),
    dockerfile,
    triggers: ["package.json", "package-lock.json", "libs/a/"],
    projectRoot: "app",
  });
  assert.deepEqual(problems, [
    `${DOCKERFILE} copies no manifest for @stigmer/b: add \`COPY libs/b/package.json libs/b/\` beside the other manifests`,
    `${DOCKERFILE} builds no @stigmer/b, whose exports name ./dist/: add \`npm run build -w @stigmer/b\` to the builder's RUN`,
    `${SERVICE} watches no libs/b, where @stigmer/b lives: add \`- libs/b\` to build.triggers.paths`,
    `${DOCKERFILE}:7 copies brand, which no trigger path in ${SERVICE} watches: add \`- brand\` to build.triggers.paths`,
  ]);
});
