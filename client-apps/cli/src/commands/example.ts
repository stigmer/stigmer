// `stigmer example list|get` — Stigmer's example agents, as files in your repository.
//
//   example list                  every example: the job, what goes in, what comes back;
//                                 then the ready-made skills
//   example get <id> [dir]        write an example's manifest and samples into dir
//                                 (default stigmer/<id>), or a skill's SKILL.md
//                                 (default stigmer/skills/<id>)
//
// The list is `@stigmer/examples`, the one the console's first question and
// its Make it yours tab read, so every door offers the same agents with the
// same words. `get` writes the manifest people would download and the sample
// files a first run attaches, then says the two commands that make the agent
// and run it once on the samples (`stigmer apply -f`, `stigmer run --attach`).
// An agent made from an example keeps the example's slug, which is how the
// console's journey knows it.
//
// It never overwrites: a file already there is refused unless `--force`, so a
// manifest a person (or their coding agent) has edited is not lost.

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import type { Command } from "commander";
import type { Example, ExampleSkill } from "@stigmer/examples";
import { CliExitError, ExitCode } from "../errors/index.js";
import { type OutputFlags, CommandResult, renderResult } from "../output/index.js";
import { addResultFlags, resultFormat } from "./shared.js";

interface GetFlags extends OutputFlags {
  force?: boolean;
}

/** Where the output of a first run goes, as the guide's step 4 names it. */
export const RUN_OUTPUT_DIR = "stigmer-output";

export function registerExample(program: Command): void {
  const group = program
    .command("example")
    .description("the example agents and skills, written into your repository as files");

  const list = group
    .command("list")
    .description("list the example agents (the job, what goes in, what comes back) and the ready-made skills")
    .action(async (options: OutputFlags) => {
      const { EXAMPLES, SKILLS } = await import("@stigmer/examples");
      renderResult(exampleListResult(EXAMPLES, SKILLS), resultFormat(options));
    });
  addResultFlags(list);

  const get = group
    .command("get <id> [dir]")
    .description("write an example's manifest and sample files (or a skill's SKILL.md) into dir")
    .option("-f, --force", "overwrite files that are already there")
    .action(async (id: string, dir: string | undefined, options: GetFlags) => {
      const { exampleById, skillById, EXAMPLES, SKILLS } = await import("@stigmer/examples");
      const example = exampleById(id);
      const skill = example === undefined ? skillById(id) : undefined;
      if (example === undefined && skill === undefined) {
        throw new CliExitError(`no example or skill named "${id}"`, ExitCode.Usage, [
          `Examples: ${EXAMPLES.map((e) => e.id).join(", ")}`,
          `Skills: ${SKILLS.map((s) => s.id).join(", ")}`,
          "See them with: stigmer example list",
        ]);
      }
      const result =
        example !== undefined
          ? writeExample(example, dir ?? join("stigmer", example.id), options.force === true)
          : writeSkill(skill as ExampleSkill, dir ?? join("stigmer", "skills", (skill as ExampleSkill).id), options.force === true);
      renderResult(result, resultFormat(options));
    });
  addResultFlags(get);
}

/** The list a person reads: each example's job, then the skills. Pure. */
export function exampleListResult(examples: readonly Example[], skills: readonly ExampleSkill[]): CommandResult {
  const result = CommandResult.success(`${examples.length} example agents`).withData({
    examples: examples.map((e) => ({
      id: e.id,
      name: e.name,
      for: e.for,
      gives: e.gives,
      gets: e.gets,
      agent: e.agent.slug,
    })),
    skills: skills.map((s) => ({ id: s.id, name: s.name, description: s.description })),
  });
  for (const example of examples) {
    result
      .addSection(`${example.id} — ${example.name}`)
      .field("For", example.for.replace(/^For /, ""))
      .field("Gives", example.gives)
      .field("Gets", example.gets)
      .field("Agent", example.agent.slug);
  }
  if (skills.length > 0) {
    const section = result.addSection("Skills");
    for (const skill of skills) section.field(skill.id, skill.name);
  }
  return result
    .hint("Write one into this repository:  stigmer example get <id>")
    .hint("Or describe your own agent in a manifest and: stigmer apply -f <file>");
}

/** Write an example's manifest and samples into `dir`, refusing to overwrite unless `force`. */
export function writeExample(example: Example, dir: string, force: boolean): CommandResult {
  const files = [example.manifest, ...example.samples.map((s) => ({ name: s.name, text: s.text }))];
  const written = writeFiles(dir, files, force);
  const shown = displayPath(dir);
  const attach = example.samples.map((s) => `--attach ${join(shown, s.name)}`).join(" ");
  return CommandResult.success(`Wrote ${example.name} into ${shown}`)
    .withData({ dir: shown, files: written, agent: example.agent.slug })
    .hint(`Make the agent:  stigmer apply -f ${join(shown, example.manifest.name)}`)
    .hint(
      `Run it once on the ${example.sampleName}:  stigmer run ${example.agent.slug} -m ${JSON.stringify(example.message)} ${attach} --download ${RUN_OUTPUT_DIR}/`,
    );
}

/** Write a skill's SKILL.md into `dir`, refusing to overwrite unless `force`. */
export function writeSkill(skill: ExampleSkill, dir: string, force: boolean): CommandResult {
  const written = writeFiles(dir, [{ name: "SKILL.md", text: skill.text }], force);
  const shown = displayPath(dir);
  return CommandResult.success(`Wrote the ${skill.name} skill into ${shown}`)
    .withData({ dir: shown, files: written, skill: skill.id })
    .hint(`Push it to your organization:  stigmer push skill ${shown}`)
    .hint(`Then add it to an agent's skill_refs and apply the agent again.`);
}

function writeFiles(dir: string, files: readonly { name: string; text: string }[], force: boolean): string[] {
  const target = resolve(dir);
  const existing = files.map((f) => join(target, f.name)).filter((path) => existsSync(path));
  if (existing.length > 0 && !force) {
    throw new CliExitError(
      `${existing.map(displayPath).join(", ")} ${existing.length === 1 ? "is" : "are"} already there`,
      ExitCode.Usage,
      ["Keep your copy, write somewhere else (stigmer example get <id> <dir>), or overwrite with --force."],
    );
  }
  mkdirSync(target, { recursive: true });
  for (const file of files) writeFileSync(join(target, file.name), file.text);
  return files.map((f) => displayPath(join(target, f.name)));
}

/** A path as the person typed it: relative to where they stand when it is inside. */
function displayPath(path: string): string {
  const rel = relative(process.cwd(), resolve(path));
  return rel === "" ? "." : rel.startsWith("..") ? resolve(path) : rel;
}
