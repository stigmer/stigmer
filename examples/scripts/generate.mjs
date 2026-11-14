#!/usr/bin/env node

/**
 * Writes src/catalogue.gen.ts, the one list of Stigmer's example agents (the
 * React kit's launcher and create picker read it), and src/journey/slugs.gen.ts,
 * their agents' slugs alone (the journey entry's), from the files people
 * download: catalogue.json (the card's words, the first
 * message, the message for a person's own file, which files belong to each
 * job), each example's manifest (the agent's only definition), its sample
 * files (inlined: they are small text files, so a reader needs no file
 * system to attach them) and the ready-made skills under skills/ (each
 * SKILL.md inlined, so the console can make the skill without a download).
 *
 * The module is committed, so a changed example shows as a reviewable diff;
 * `--check` fails when it is not what this script would write now. Every
 * rule an example must keep (each folder listed, each listed file present,
 * the output named in the instructions, the first message naming its
 * samples, a message for a person's own file, no two ids or agent slugs
 * alike) and every rule a skill keeps (its SKILL.md present, its
 * frontmatter naming it by its id with a description) is checked before
 * anything is written, by `problems`, which scripts/generate.test.mjs also
 * drives.
 *
 * Usage:
 *   node examples/scripts/generate.mjs           # write both generated modules
 *   node examples/scripts/generate.mjs --check   # exit 1 when it is stale
 */

import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { parse } from "yaml";

/** The examples folder: the package root, beside this script's folder. */
export const ROOT = fileURLToPath(new URL("../", import.meta.url));

/** Folders of the package itself, never an example; `skills` holds the ready-made skills. */
const PACKAGE_DIRS = new Set(["scripts", "src", "dist", "node_modules", "skills"]);

/** The generated module's path, relative to the package root. */
export const GENERATED = "src/catalogue.gen.ts";

/** The generated slug list's path: the journey entry's data-free half. */
export const GENERATED_SLUGS = "src/journey/slugs.gen.ts";

const MEDIA_TYPES = { ".csv": "text/csv", ".md": "text/markdown", ".txt": "text/plain", ".json": "application/json" };

/** A sample's media type, from its extension; undefined for one a reader can't be sure the agent reads. */
export function mediaTypeOf(name) {
  const dot = name.lastIndexOf(".");
  return dot === -1 ? undefined : MEDIA_TYPES[name.slice(dot)];
}

/** An agent's display name from its slug: "variance-reporter" is "Variance Reporter". */
export function displayName(slug) {
  return slug
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/** Reads the catalogue and every file it names, as plain data, from a root folder. */
export function readTree(root = ROOT) {
  const catalogue = JSON.parse(readFileSync(join(root, "catalogue.json"), "utf8"));
  const folders = readdirSync(root)
    .filter((name) => !PACKAGE_DIRS.has(name) && !name.startsWith(".") && statSync(join(root, name)).isDirectory())
    .sort();
  const read = (folder, file) => {
    const path = join(root, folder, file);
    return existsSync(path) ? readFileSync(path, "utf8") : undefined;
  };
  return { catalogue, folders, read };
}

/**
 * A SKILL.md's frontmatter as plain data, or undefined when the file does
 * not open with one: the block between a first line of `---` and the next.
 */
export function frontmatterOf(text) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(text);
  if (match === null) return undefined;
  try {
    const parsed = parse(match[1]);
    return typeof parsed === "object" && parsed !== null ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/** Every rule the tree breaks, as one sentence each; empty when it keeps them all. */
export function problems({ catalogue, folders, read }) {
  const found = [];
  const entries = Array.isArray(catalogue?.examples) ? catalogue.examples : [];
  if (entries.length === 0) found.push("catalogue.json lists no examples");
  const ids = new Set();
  const slugs = new Set();
  for (const entry of entries) {
    const id = entry.id;
    for (const field of ["id", "for", "name", "gives", "gets", "category", "manifest", "sampleName", "output", "message", "ownFileMessage"]) {
      if (typeof entry[field] !== "string" || entry[field].trim() === "") found.push(`${id ?? "an example"}: "${field}" is missing`);
    }
    if (ids.has(id)) found.push(`${id}: two examples share this id`);
    ids.add(id);
    if (!folders.includes(id)) found.push(`${id}: no folder of that name`);
    const samples = Array.isArray(entry.samples) ? entry.samples : [];
    if (samples.length === 0) found.push(`${id}: lists no sample`);
    for (const sample of samples) {
      if (read(id, sample) === undefined) found.push(`${id}: sample ${sample} is not in its folder`);
      if (mediaTypeOf(sample) === undefined) found.push(`${id}: sample ${sample} is not a text type an agent reads`);
      if (typeof entry.message === "string" && !entry.message.includes(sample)) found.push(`${id}: the first message doesn't name ${sample}`);
    }
    const manifestText = typeof entry.manifest === "string" ? read(id, entry.manifest) : undefined;
    if (manifestText === undefined) {
      found.push(`${id}: manifest ${entry.manifest} is not in its folder`);
      continue;
    }
    const manifest = parse(manifestText);
    const slug = manifest?.metadata?.name;
    const instructions = manifest?.spec?.instructions;
    if (manifest?.kind !== "Agent" || typeof slug !== "string") {
      found.push(`${id}: ${entry.manifest} is not an Agent with a name`);
      continue;
    }
    if (slugs.has(slug)) found.push(`${id}: two examples make the agent ${slug}`);
    slugs.add(slug);
    if (typeof instructions !== "string" || typeof entry.output !== "string" || !instructions.includes(entry.output)) {
      found.push(`${id}: the instructions don't name the output ${entry.output}`);
    }
  }
  for (const folder of folders) {
    if (!ids.has(folder)) found.push(`${folder}: a folder catalogue.json doesn't list`);
  }
  const skills = Array.isArray(catalogue?.skills) ? catalogue.skills : [];
  const skillIds = new Set();
  for (const skill of skills) {
    const id = skill.id;
    for (const field of ["id", "name", "file"]) {
      if (typeof skill[field] !== "string" || skill[field].trim() === "") found.push(`skill ${id ?? "?"}: "${field}" is missing`);
    }
    if (skillIds.has(id)) found.push(`skill ${id}: two skills share this id`);
    skillIds.add(id);
    const text = typeof skill.file === "string" ? read(".", skill.file) : undefined;
    if (text === undefined) {
      found.push(`skill ${id}: ${skill.file} is not in the package`);
      continue;
    }
    const front = frontmatterOf(text);
    if (front === undefined) {
      found.push(`skill ${id}: ${skill.file} opens with no frontmatter`);
      continue;
    }
    if (front.name !== id) found.push(`skill ${id}: its frontmatter names it ${front.name ?? "nothing"}`);
    if (typeof front.description !== "string" || front.description.trim() === "") found.push(`skill ${id}: its frontmatter has no description`);
  }
  return found;
}

/** The generated module's text, for a tree that keeps every rule. */
export function render({ catalogue, read }) {
  const examples = catalogue.examples.map((entry) => {
    const manifestText = read(entry.id, entry.manifest);
    const manifest = parse(manifestText);
    const spec = manifest.spec ?? {};
    return {
      id: entry.id,
      for: entry.for,
      name: entry.name,
      gives: entry.gives,
      gets: entry.gets,
      category: entry.category,
      tags: entry.tags ?? [],
      message: entry.message,
      ownFileMessage: entry.ownFileMessage,
      output: entry.output,
      agent: {
        name: displayName(manifest.metadata.name),
        slug: manifest.metadata.name,
        description: spec.description ?? "",
        instructions: spec.instructions ?? "",
        disallowedTools: spec.disallowed_tools ?? [],
      },
      manifest: { name: entry.manifest, text: manifestText },
      sampleName: entry.sampleName,
      samples: entry.samples.map((name) => ({ name, type: mediaTypeOf(name), text: read(entry.id, name) })),
    };
  });
  const skills = (catalogue.skills ?? []).map((skill) => {
    const text = read(".", skill.file);
    return { id: skill.id, name: skill.name, description: frontmatterOf(text).description, file: skill.file, text };
  });
  return [
    "// Code generated by examples/scripts/generate.mjs from catalogue.json, the",
    "// manifests, the samples and the skills. DO NOT EDIT: change those files",
    "// and run `npm run generate -w @stigmer/examples`.",
    "",
    'import type { Example, ExampleSkill } from "./types.js";',
    "",
    "/** Every example, in the order the catalogue lists them. */",
    `export const EXAMPLES: readonly Example[] = ${JSON.stringify(examples, null, 2)};`,
    "",
    "/** Every ready-made skill, in the order the catalogue lists them. */",
    `export const SKILLS: readonly ExampleSkill[] = ${JSON.stringify(skills, null, 2)};`,
    "",
  ].join("\n");
}

/**
 * The generated slug list's text: every example's agent slug, in the
 * catalogue's order, read from the manifests alone, so a reader that only
 * asks "is this an example's agent?" (the server, a first download) carries
 * none of the examples' data.
 */
export function renderSlugs({ catalogue, read }) {
  const slugs = catalogue.examples.map((entry) => parse(read(entry.id, entry.manifest)).metadata.name);
  return [
    "// Code generated by examples/scripts/generate.mjs from catalogue.json and",
    "// the manifests. DO NOT EDIT: change those files and run",
    "// `npm run generate -w @stigmer/examples`.",
    "",
    "/** Every example's agent slug, in the catalogue's order. */",
    `export const EXAMPLE_AGENT_SLUGS: readonly string[] = ${JSON.stringify(slugs)};`,
    "",
  ].join("\n");
}

function main() {
  const check = process.argv.includes("--check");
  const tree = readTree();
  const broken = problems(tree);
  if (broken.length > 0) {
    for (const line of broken) console.error(`examples: ${line}`);
    process.exit(1);
  }
  const outputs = [
    [GENERATED, render(tree)],
    [GENERATED_SLUGS, renderSlugs(tree)],
  ];
  for (const [path, text] of outputs) {
    const target = join(ROOT, path);
    const current = existsSync(target) ? readFileSync(target, "utf8") : "";
    if (check) {
      if (current !== text) {
        console.error(`examples: ${path} is stale; run \`npm run generate -w @stigmer/examples\``);
        process.exit(1);
      }
      console.log(`examples: ${path} is current (${tree.catalogue.examples.length} examples)`);
      continue;
    }
    writeFileSync(target, text);
    console.log(`examples: wrote ${path} (${tree.catalogue.examples.length} examples)`);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
