// `stigmer push <type> [path]` — package and upload an artifact to the registry.
// Only skills are pushable today. Two source modes: a local directory (default,
// git provenance auto-detected) or a remote repo via --git-url (cloned to a
// temp dir, then pushed). Heavy modules are lazy-imported so `--help` stays fast.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Command } from "commander";
import { ensureAuthenticated, resolveOrganization } from "../config/index.js";
import { UsageError } from "../errors/index.js";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { defaultRegistry, Verb } from "../registry/index.js";
import { globalOrg } from "./shared.js";

interface PushFlags {
  tag?: string;
  message?: string;
  dryRun?: boolean;
  gitUrl?: string;
  gitRef?: string;
  subdir?: string;
  ignore?: string[];
  include?: string[];
  gitignore?: boolean; // false when --no-gitignore is passed (commander negation)
  verbose?: boolean;
}

const collect = (value: string, previous: string[]): string[] => [...previous, value];

export function registerPush(program: Command): void {
  program
    .command("push <type> [path]")
    .description("push an artifact to the registry (supported types: skill)")
    .option("--tag <tag>", "version tag for the artifact", "latest")
    .option("-m, --message <message>", "version message describing what changed")
    .option("--dry-run", "validate without pushing")
    .option("--git-url <url>", "push from a remote git repository URL")
    .option("--git-ref <ref>", "git reference (tag, branch, or commit SHA) for remote push")
    .option("--subdir <dir>", "subdirectory within the git repository containing the artifact")
    .option("--ignore <pattern>", "additional pattern to ignore (repeatable)", collect, [])
    .option("--include <pattern>", "pattern to force-include (repeatable)", collect, [])
    .option("--no-gitignore", "don't respect .gitignore patterns")
    .option("--verbose", "show detailed output including ignore decisions")
    .action((type: string, path: string | undefined, options: PushFlags, command: Command) =>
      runPush(type, path, options, command),
    );
}

async function runPush(type: string, path: string | undefined, options: PushFlags, command: Command): Promise<void> {
  const info = defaultRegistry().getByAlias(type);
  if (info === undefined) {
    throw new UsageError(`unknown resource type: ${type}\n\nAvailable types: skill`);
  }
  if (!info.supportedVerbs.has(Verb.Push)) {
    throw new UsageError(`${info.displayName} does not support 'push'`);
  }
  if (info.kind !== ApiResourceKind.skill) {
    throw new UsageError(`push not implemented for ${info.displayName}`);
  }

  const [{ connectBackend }, skill] = await Promise.all([import("../backend.js"), import("../resources/skill.js")]);
  const client = connectBackend();
  ensureAuthenticated(client.config);
  const org = resolveOrganization(client.config, globalOrg(command));

  const ignoreOptions = {
    respectGitignore: options.gitignore !== false,
    extraIgnore: options.ignore ?? [],
    extraInclude: options.include ?? [],
  };
  const decisionSink = options.verbose === true ? (line: string) => process.stderr.write(`${line}\n`) : undefined;
  const tag = options.tag ?? "latest";
  const message = options.message ?? "";

  if (options.gitUrl !== undefined && options.gitUrl !== "") {
    await pushRemote(client.stigmer, skill, { org, tag, message, ignoreOptions, decisionSink, options });
    return;
  }

  const directory = path !== undefined && path !== "" ? path : process.cwd();
  if (!skill.hasSkillFile(directory)) {
    throw new UsageError(
      `SKILL.md not found in ${directory}\n\nA skill directory must contain a SKILL.md file defining the skill interface`,
    );
  }
  // Validate metadata early so dry-run and real pushes fail the same way.
  skill.parseSkillMetadata(directory);

  if (options.dryRun === true) {
    process.stdout.write(renderDryRun(directory, skill.analyzeDryRun(directory, ignoreOptions), skill));
    return;
  }

  const result = await skill.pushSkill(client.stigmer, directory, org, tag, message, ignoreOptions, decisionSink);
  process.stdout.write(renderResult(result, skill));
}

interface RemoteContext {
  org: string;
  tag: string;
  message: string;
  ignoreOptions: { respectGitignore: boolean; extraIgnore: string[]; extraInclude: string[] };
  decisionSink?: (line: string) => void;
  options: PushFlags;
}

async function pushRemote(
  client: import("@stigmer/sdk").Stigmer,
  skill: typeof import("../resources/skill.js"),
  ctx: RemoteContext,
): Promise<void> {
  const gitUrl = ctx.options.gitUrl ?? "";
  const gitRef = ctx.options.gitRef ?? "";
  const subdir = ctx.options.subdir ?? "";

  if (ctx.options.dryRun === true) {
    process.stdout.write(renderRemoteDryRun(gitUrl, gitRef, subdir, ctx));
    return;
  }

  const { cloneRepository } = await import("../resources/git.js");
  const tempDir = mkdtempSync(join(tmpdir(), "stigmer-skill-"));
  try {
    cloneRepository(gitUrl, gitRef, tempDir);
    const skillDir = subdir !== "" ? join(tempDir, subdir) : tempDir;
    if (!skill.hasSkillFile(skillDir)) {
      throw new UsageError(
        `SKILL.md not found in ${subdir !== "" ? subdir : "repository root"}\n\n` +
          "The skill directory must contain a SKILL.md file with YAML frontmatter",
      );
    }
    const result = await skill.pushSkillFromClone(
      client,
      skillDir,
      { gitUrl, gitRef, subdir, org: ctx.org, tag: ctx.tag, message: ctx.message, options: ctx.ignoreOptions },
      ctx.decisionSink,
    );
    process.stdout.write(renderResult(result, skill));
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

function renderResult(result: import("../resources/skill.js").PushResult, skill: typeof import("../resources/skill.js")): string {
  const status = result.isNewResource ? "new resource" : result.versionChanged ? "new version" : "unchanged";
  const lines = [
    "",
    `Pushed skill '${result.skillName}'`,
    `  ID:       ${result.id}`,
    `  Slug:     ${result.slug}`,
    `  Tag:      ${result.tag}`,
    `  Version:  ${skill.shortHash(result.versionHash)}`,
    `  Size:     ${skill.formatBytes(result.artifactSize)}`,
    `  Status:   ${status}`,
  ];
  if (result.message !== "") lines.push(`  Message:  ${result.message}`);
  lines.push("");
  return `${lines.join("\n")}\n`;
}

function renderDryRun(
  directory: string,
  analysis: import("../resources/skill.js").DryRunAnalysis,
  skill: typeof import("../resources/skill.js"),
): string {
  const { stats } = analysis;
  const lines = [
    "",
    `Dry run - analyzing skill directory: ${directory}`,
    "",
    "Pattern sources:",
    ...analysis.patternSources.map((s) => `  - ${s}`),
    "",
    `Files to include:    ${stats.filesIncluded} (${skill.formatBytes(stats.totalSize)})`,
    `Files ignored:       ${stats.filesIgnored}`,
    `Directories skipped: ${stats.dirsSkipped}`,
  ];
  if (analysis.sampleIncluded.length > 0) {
    lines.push("", "Sample included:", ...analysis.sampleIncluded.map((f) => `  + ${f}`));
  }
  if (analysis.sampleIgnored.length > 0) {
    lines.push("", "Sample ignored:", ...analysis.sampleIgnored.map((f) => `  - ${f}`));
  }
  lines.push("", "Run without --dry-run to push the skill artifact.", "");
  return `${lines.join("\n")}\n`;
}

function renderRemoteDryRun(gitUrl: string, gitRef: string, subdir: string, ctx: RemoteContext): string {
  const lines = ["", "Dry run mode - would push skill from remote git repository:", "", "Git Source:", `  URL:    ${gitUrl}`];
  if (gitRef !== "") lines.push(`  Ref:    ${gitRef}`);
  if (subdir !== "") lines.push(`  Subdir: ${subdir}`);
  lines.push(`  Tag:    ${ctx.tag}`, "", "Ignore Configuration:");
  lines.push(`  Gitignore:         ${ctx.ignoreOptions.respectGitignore ? "enabled" : "disabled"}`);
  lines.push("  Security defaults: enabled");
  lines.push("  Stigmerignore:     will load if present");
  if (ctx.ignoreOptions.extraIgnore.length > 0) lines.push(`  Extra ignore:      ${ctx.ignoreOptions.extraIgnore.join(", ")}`);
  if (ctx.ignoreOptions.extraInclude.length > 0) lines.push(`  Force include:     ${ctx.ignoreOptions.extraInclude.join(", ")}`);
  lines.push(
    "",
    "Note: Full analysis requires cloning the repository.",
    "Run without --dry-run to push the skill artifact.",
    "",
  );
  return `${lines.join("\n")}\n`;
}
