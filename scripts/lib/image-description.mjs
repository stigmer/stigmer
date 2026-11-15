#!/usr/bin/env node

/**
 * The description an image built from a Dockerfile carries: the value of its
 * `org.opencontainers.image.description` label, read from the source without
 * building anything.
 *
 * GHCR's package page shows a multi-platform image's description from the
 * index annotation of the same name, not from the image config's label, so
 * the release lanes write it as `--annotation "index:…"` on every build and
 * tag move. The words live once, in the Dockerfile, and this reader is how a
 * lane (and the brand test that holds every published image to having one)
 * gets them: a hard-coded copy in a workflow would drift from the label.
 *
 * It follows Docker's own rules as far as a description needs:
 *  - the stage is `--target`, or the last stage when none is named, and a
 *    stage built `FROM` an earlier stage of the file inherits its labels, so
 *    the nearest stage on that chain that sets the label wins;
 *  - `${NAME}`, `$NAME` and `${NAME:-default}` resolve against that stage's
 *    `ARG` lines, a `--build-arg` overriding only an ARG the stage declares
 *    (as Docker applies one), and an `ARG` with no default inheriting a
 *    global one (declared before the first `FROM`);
 *  - single quotes are literal, a backslash escapes the next character, and
 *    a line ending in a backslash continues (comment lines inside a
 *    continuation are dropped, as Docker drops them).
 * A variable the stage never declares is refused rather than read as empty,
 * since that is a Dockerfile mistake the page would show as a blank line.
 *
 * CLI: `node scripts/lib/image-description.mjs --file <Dockerfile>
 * [--target <stage>] [--build-arg NAME=value]...` prints the description and
 * exits non-zero when the image has none.
 */

import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";

export const DESCRIPTION_KEY = "org.opencontainers.image.description";

/** The Dockerfile's instructions, each a logical line with continuations joined. */
export function instructions(text) {
  const out = [];
  let current = "";
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith("#") || (current !== "" && line === "")) continue;
    if (line.endsWith("\\")) {
      current += `${line.slice(0, -1)} `;
      continue;
    }
    current += line;
    if (current.trim() !== "") {
      const trimmed = current.trim();
      const space = trimmed.search(/\s/);
      out.push({
        cmd: (space === -1 ? trimmed : trimmed.slice(0, space)).toUpperCase(),
        args: space === -1 ? "" : trimmed.slice(space + 1).trim(),
      });
    }
    current = "";
  }
  return out;
}

/** The stages of a Dockerfile, in order, and the ARG defaults declared before the first FROM. */
export function stages(text) {
  const globalArgs = new Map();
  const list = [];
  for (const ins of instructions(text)) {
    if (ins.cmd === "FROM") {
      const words = ins.args.split(/\s+/).filter((w) => !w.startsWith("--"));
      const as = words.findIndex((w) => w.toUpperCase() === "AS");
      list.push({
        base: words[0],
        name: as >= 0 ? words[as + 1] : undefined,
        body: [],
      });
    } else if (list.length === 0) {
      if (ins.cmd === "ARG") {
        for (const [name, value] of argDeclarations(ins.args, new Map())) {
          if (value !== undefined) globalArgs.set(name, value);
        }
      }
    } else {
      list[list.length - 1].body.push(ins);
    }
  }
  return { globalArgs, stages: list };
}

/**
 * The description the image built from `text` at `target` carries, or
 * `undefined` when it carries none. `buildArgs` are `--build-arg` values.
 */
export function imageDescription(text, { target, buildArgs = {} } = {}) {
  const { globalArgs, stages: list } = stages(text);
  if (list.length === 0) throw new Error("the Dockerfile has no FROM");
  const byName = (name) =>
    list.findIndex((s) => s.name !== undefined && s.name.toLowerCase() === name.toLowerCase());
  let index = target === undefined ? list.length - 1 : byName(target);
  if (index < 0) throw new Error(`the Dockerfile has no stage named ${target}`);
  const seen = new Set();
  while (index >= 0 && !seen.has(index)) {
    seen.add(index);
    const stage = list[index];
    const value = stageDescription(stage, globalArgs, buildArgs);
    if (value !== undefined) return value;
    const parent = byName(stage.base);
    index = parent >= 0 && parent < index ? parent : -1;
  }
  return undefined;
}

/** The description one stage's own LABEL lines set (the last one wins), resolved. */
function stageDescription(stage, globalArgs, buildArgs) {
  const env = new Map();
  let description;
  for (const ins of stage.body) {
    if (ins.cmd === "ARG") {
      for (const [name, value] of argDeclarations(ins.args, env)) {
        if (Object.hasOwn(buildArgs, name)) env.set(name, buildArgs[name]);
        else if (value !== undefined) env.set(name, value);
        else env.set(name, globalArgs.get(name) ?? "");
      }
    } else if (ins.cmd === "LABEL") {
      for (const [key, value] of labelPairs(ins.args, env)) {
        if (key === DESCRIPTION_KEY) description = value;
      }
    }
  }
  return description;
}

/** `ARG A`, `ARG A=x B="y z"`: each name with its default, or undefined when it has none. */
function argDeclarations(args, env) {
  return words(args, env).map((word) => {
    const eq = word.indexOf("=");
    return eq === -1 ? [word, undefined] : [word.slice(0, eq), word.slice(eq + 1)];
  });
}

/** `LABEL k=v k2="v 2"`, or the legacy `LABEL key value with spaces`. */
function labelPairs(args, env) {
  const all = words(args, env);
  if (all.length > 0 && !all[0].includes("=")) {
    return [[all[0], all.slice(1).join(" ")]];
  }
  return all.map((word) => {
    const eq = word.indexOf("=");
    if (eq === -1) throw new Error(`LABEL ${args} mixes key=value and bare words`);
    return [word.slice(0, eq), word.slice(eq + 1)];
  });
}

/** Splits on unquoted whitespace, removing quotes and expanding variables as Docker does. */
function words(text, env) {
  const out = [];
  let word = "";
  let inWord = false;
  let quote = "";
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quote === "'") {
      if (c === "'") quote = "";
      else word += c;
      continue;
    }
    if (c === "\\" && i + 1 < text.length) {
      word += text[++i];
      inWord = true;
      continue;
    }
    if (c === "$") {
      const [value, length] = expand(text, i, env);
      word += value;
      i += length - 1;
      inWord = true;
      continue;
    }
    if (quote === '"') {
      if (c === '"') quote = "";
      else word += c;
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c;
      inWord = true;
      continue;
    }
    if (/\s/.test(c)) {
      if (inWord) out.push(word);
      word = "";
      inWord = false;
      continue;
    }
    word += c;
    inWord = true;
  }
  if (quote !== "") throw new Error(`unterminated ${quote} in: ${text}`);
  if (inWord) out.push(word);
  return out;
}

/** Expands the `$NAME`, `${NAME}` or `${NAME:-default}` at `start`: its value and the characters it spans. */
function expand(text, start, env) {
  const lookup = (name) => {
    if (!env.has(name)) throw new Error(`\${${name}} is not an ARG of this stage`);
    return env.get(name);
  };
  if (text[start + 1] === "{") {
    const end = text.indexOf("}", start);
    if (end === -1) throw new Error(`unterminated \${ in: ${text}`);
    const inner = text.slice(start + 2, end);
    const fallback = inner.indexOf(":-");
    if (fallback !== -1) {
      const name = inner.slice(0, fallback);
      const value = env.get(name) ?? "";
      return [value !== "" ? value : inner.slice(fallback + 2), end - start + 1];
    }
    return [lookup(inner), end - start + 1];
  }
  const match = /^[A-Za-z_][A-Za-z0-9_]*/.exec(text.slice(start + 1));
  if (!match) return ["$", 1];
  return [lookup(match[0]), match[0].length + 1];
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { values } = parseArgs({
    options: {
      file: { type: "string" },
      target: { type: "string" },
      "build-arg": { type: "string", multiple: true },
    },
  });
  try {
    if (!values.file) throw new Error("--file <Dockerfile> is required");
    const buildArgs = {};
    for (const pair of values["build-arg"] ?? []) {
      const eq = pair.indexOf("=");
      if (eq <= 0) throw new Error(`--build-arg ${pair} is not NAME=value`);
      buildArgs[pair.slice(0, eq)] = pair.slice(eq + 1);
    }
    const description = imageDescription(readFileSync(values.file, "utf8"), {
      target: values.target,
      buildArgs,
    });
    if (description === undefined || description.trim() === "") {
      throw new Error(
        `${values.file}${values.target ? ` (stage ${values.target})` : ""} sets no ${DESCRIPTION_KEY} label`,
      );
    }
    process.stdout.write(`${description}\n`);
  } catch (error) {
    process.stderr.write(`image-description: ${error.message}\n`);
    process.exit(1);
  }
}
