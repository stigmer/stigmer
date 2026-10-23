// `stigmer push <type> [path]` — build and upload a package to the registry.
// Three kinds are pushable: skills (a local directory with git provenance
// auto-detected, a remote repo via --git-url, or a pre-built --archive),
// plugins (a local plugin directory, installed or upgraded as one unit; the
// manifest's version is its tag, so --tag does not apply) and evals (an
// evals/ folder pushed whole under the slug --name gives, since the folder
// names nothing; --tag moves a tag only when given). Heavy modules are
// lazy-imported so `--help` stays fast.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Command } from "commander";
import { ensureAuthenticated, resolveOrganization } from "../config/index.js";
import { UsageError } from "../errors/index.js";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ApiResourceVisibility } from "@stigmer/apis/ai/stigmer/commons/apiresource/enum_pb";
import {
  type OutputFlags,
  renderResult as renderCommandResult,
} from "../output/index.js";
import { defaultRegistry, Verb } from "../registry/index.js";
import { addResultFlags, globalOrg, resultFormat } from "./shared.js";

interface PushFlags extends OutputFlags {
  tag?: string;
  name?: string;
  visibility?: string;
  message?: string;
  dryRun?: boolean;
  gitUrl?: string;
  gitRef?: string;
  subdir?: string;
  archive?: string;
  ignore?: string[];
  include?: string[];
  gitignore?: boolean; // false when --no-gitignore is passed (commander negation)
  verbose?: boolean;
}

const collect = (value: string, previous: string[]): string[] => [
  ...previous,
  value,
];

export function registerPush(program: Command): void {
  const push = program
    .command("push <type> [path]")
    .description(
      "push a package to the registry (supported types: skill, plugin, eval)",
    )
    .option(
      "--tag <tag>",
      "version tag for the package (skills, and evals, where it is moved only when given; a plugin's tag is its manifest version)",
      "latest",
    )
    .option(
      "--name <slug>",
      "evals: the eval's slug, required (the folder names nothing)",
    )
    .option(
      "-m, --message <message>",
      "version message describing what changed",
    )
    .option(
      "--visibility <level>",
      "plugins: visibility for the plugin (private, org, child-orgs); evals: private or org",
    )
    .option("--dry-run", "validate without pushing")
    .option("--git-url <url>", "push from a remote git repository URL")
    .option(
      "--git-ref <ref>",
      "git reference (tag, branch, or commit SHA) for remote push",
    )
    .option(
      "--subdir <dir>",
      "subdirectory within the git repository containing the package",
    )
    .option(
      "--archive <file>",
      "push a pre-packaged ZIP archive as-is (version hash = the file's SHA-256)",
    )
    .option(
      "--ignore <pattern>",
      "additional pattern to ignore (repeatable)",
      collect,
      [],
    )
    .option(
      "--include <pattern>",
      "pattern to force-include (repeatable)",
      collect,
      [],
    )
    .option("--no-gitignore", "don't respect .gitignore patterns")
    .option("--verbose", "show detailed output including ignore decisions")
    .action(
      (
        type: string,
        path: string | undefined,
        options: PushFlags,
        command: Command,
      ) => runPush(type, path, options, command),
    );
  addResultFlags(push);
}

async function runPush(
  type: string,
  path: string | undefined,
  options: PushFlags,
  command: Command,
): Promise<void> {
  const info = defaultRegistry().getByAlias(type);
  if (info === undefined) {
    throw new UsageError(
      `unknown resource type: ${type}\n\nAvailable types: skill, plugin, eval`,
    );
  }
  if (!info.supportedVerbs.has(Verb.Push)) {
    throw new UsageError(`${info.displayName} does not support 'push'`);
  }
  if (info.kind === ApiResourceKind.plugin) {
    await runPushPlugin(path, options, command);
    return;
  }
  if (info.kind === ApiResourceKind.eval) {
    await runPushEval(path, options, command);
    return;
  }
  if (options.name !== undefined) {
    throw new UsageError(
      `--name names an eval; a ${info.displayName.toLowerCase()} takes its name from its own files`,
    );
  }
  if (info.kind !== ApiResourceKind.skill) {
    throw new UsageError(`push not implemented for ${info.displayName}`);
  }

  const [{ connectBackend }, skill] = await Promise.all([
    import("../backend.js"),
    import("../resources/skill.js"),
  ]);
  const client = connectBackend();
  ensureAuthenticated(client.config);
  const org = resolveOrganization(client.config, globalOrg(command));

  const ignoreOptions = {
    respectGitignore: options.gitignore !== false,
    extraIgnore: options.ignore ?? [],
    extraInclude: options.include ?? [],
  };
  const decisionSink =
    options.verbose === true
      ? (line: string) => process.stderr.write(`${line}\n`)
      : undefined;
  const tag = options.tag ?? "latest";
  const message = options.message ?? "";

  if (options.archive !== undefined && options.archive !== "") {
    await pushArchive(client.stigmer, skill, {
      org,
      tag,
      message,
      path,
      options,
    });
    return;
  }

  if (options.gitUrl !== undefined && options.gitUrl !== "") {
    await pushRemote(client.stigmer, skill, {
      org,
      tag,
      message,
      ignoreOptions,
      decisionSink,
      options,
    });
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
    process.stdout.write(
      renderDryRun(
        directory,
        skill.analyzeDryRun(directory, ignoreOptions),
        skill,
      ),
    );
    return;
  }

  const result = await skill.pushSkill(
    client.stigmer,
    directory,
    org,
    tag,
    message,
    ignoreOptions,
    decisionSink,
  );
  process.stdout.write(renderResult(result, skill));
}

/**
 * `stigmer push plugin <dir>`: install or upgrade a plugin from its folder.
 * The folder is read through the same walk `validate -f` uses, refused
 * offline with the same sentences, zipped deterministically and pushed;
 * `--dry-run` stops after the offline read and prints what would install.
 * Skill-only flags (`--archive`, `--git-url`) are a contradiction here.
 */
async function runPushPlugin(
  path: string | undefined,
  options: PushFlags,
  command: Command,
): Promise<void> {
  const conflicts: string[] = [];
  if (options.archive !== undefined && options.archive !== "")
    conflicts.push("--archive");
  if (options.gitUrl !== undefined && options.gitUrl !== "")
    conflicts.push("--git-url");
  if (options.gitRef !== undefined && options.gitRef !== "")
    conflicts.push("--git-ref");
  if (options.subdir !== undefined && options.subdir !== "")
    conflicts.push("--subdir");
  if (conflicts.length > 0) {
    throw new UsageError(
      `push plugin takes a plugin directory and cannot be combined with: ${conflicts.join(", ")}`,
    );
  }
  const format = resultFormat(options);
  const directory = path !== undefined && path !== "" ? path : process.cwd();
  const plugin = await import("../resources/plugin.js");
  if (!plugin.isPluginDirectory(directory)) {
    throw new UsageError(
      `${directory} is not a plugin directory\n\nA plugin directory holds one of: ${plugin.PLUGIN_MANIFEST_PATHS.join(", ")}`,
    );
  }
  const ignoreOptions = {
    respectGitignore: options.gitignore !== false,
    extraIgnore: options.ignore ?? [],
    extraInclude: options.include ?? [],
  };
  const { parseVisibility } = await import("../resources/skill.js");
  const visibility = parseVisibility(options.visibility, "--visibility");

  if (options.dryRun === true) {
    const prepared = await plugin.preparePluginPush(directory, ignoreOptions);
    const { CommandResult } = await import("../output/index.js");
    const result = plugin.describePackageOn(
      CommandResult.success(
        `Dry run: plugin '${prepared.plugin.name}' would install`,
      ),
      prepared.plugin,
      prepared.warnings,
      prepared.stats,
    );
    result.hint("Run without --dry-run to install it.");
    renderCommandResult(result, format);
    return;
  }

  const { connectBackend } = await import("../backend.js");
  const client = connectBackend();
  ensureAuthenticated(client.config);
  const org = resolveOrganization(client.config, globalOrg(command));
  const outcome = await plugin.pushPlugin(client.stigmer, directory, {
    org,
    visibility,
    message: options.message ?? "",
    ignoreOptions,
  });
  renderCommandResult(
    plugin.renderPushOutcome(outcome, {
      next: plugin.nextSteps(outcome.plugin),
    }),
    format,
  );
}

/**
 * `stigmer push eval <folder> --name <slug>`: store an evals/ folder as an
 * eval's new version. The folder is walked and selected as a plugin's is,
 * read and archived by the shared eval preparation (run output left out),
 * and pushed under the slug --name gives. `--tag` is sent only when the
 * user gave it: its `latest` default is the skill's, and a tag named
 * `latest` would only ever be read as the current version.
 */
async function runPushEval(
  path: string | undefined,
  options: PushFlags,
  command: Command,
): Promise<void> {
  const tagGiven = command.getOptionValueSource("tag") === "cli";
  const request = evalPushFlags(options, tagGiven);
  const format = resultFormat(options);
  const directory = path !== undefined && path !== "" ? path : process.cwd();
  const ignoreOptions = {
    respectGitignore: options.gitignore !== false,
    extraIgnore: options.ignore ?? [],
    extraInclude: options.include ?? [],
  };
  const evalModule = await import("../resources/eval.js");
  const prepared = await evalModule.prepareEvalPush(directory, ignoreOptions);

  if (options.dryRun === true) {
    renderCommandResult(evalModule.describeEvalPush(prepared, request.slug), format);
    return;
  }

  const { connectBackend } = await import("../backend.js");
  const client = connectBackend();
  ensureAuthenticated(client.config);
  const org = resolveOrganization(client.config, globalOrg(command));
  const pushed = await evalModule.pushEval(client.stigmer, prepared, {
    org,
    slug: request.slug,
    ...(request.tag !== undefined && { tag: request.tag }),
    visibility: request.visibility,
    message: options.message ?? "",
  });
  renderCommandResult(evalModule.renderEvalPush(pushed, prepared), format);
}

/** What an eval push takes from the flags, refusing what does not apply to an eval. */
export function evalPushFlags(
  options: PushFlags,
  tagGiven: boolean,
): {
  readonly slug: string;
  readonly tag?: string;
  readonly visibility: ApiResourceVisibility | undefined;
} {
  const conflicts: string[] = [];
  if (options.archive !== undefined && options.archive !== "")
    conflicts.push("--archive");
  if (options.gitUrl !== undefined && options.gitUrl !== "")
    conflicts.push("--git-url");
  if (options.gitRef !== undefined && options.gitRef !== "")
    conflicts.push("--git-ref");
  if (options.subdir !== undefined && options.subdir !== "")
    conflicts.push("--subdir");
  if (conflicts.length > 0) {
    throw new UsageError(
      `push eval takes an evals/ folder and cannot be combined with: ${conflicts.join(", ")}`,
    );
  }
  const slug = options.name?.trim() ?? "";
  if (slug === "") {
    throw new UsageError(
      "push eval needs --name <slug>: the eval's name in the organization, such as variance-reporter-evals\n\n" +
        "Claude Code's evals/ folder names nothing, so every push says which eval it adds a version to.",
    );
  }
  if (!/^[a-z][a-z0-9-]*[a-z0-9]$/.test(slug) || slug.length > 63) {
    throw new UsageError(
      `invalid --name '${slug}': 2 to 63 lowercase letters, digits and hyphens, starting with a letter and ending with a letter or digit`,
    );
  }
  const tag = tagGiven ? (options.tag ?? "") : undefined;
  if (tag !== undefined && tag.trim().toLowerCase() === "latest") {
    throw new UsageError(
      "an eval's tag cannot be 'latest': a reference without a version already names the current one; leave --tag out, or give another tag such as stable",
    );
  }
  const visibility = parseEvalVisibility(options.visibility);
  return { slug, ...(tag !== undefined && { tag }), visibility };
}

/** An eval's level: the whole organization or its owner alone; never child organizations. */
function parseEvalVisibility(value: string | undefined): ApiResourceVisibility | undefined {
  if (value === undefined) return undefined;
  switch (value.trim().toLowerCase()) {
    case "org":
    case "organization":
      return ApiResourceVisibility.visibility_org;
    case "private":
      return ApiResourceVisibility.visibility_private;
    default:
      throw new UsageError(
        `invalid --visibility '${value}' for an eval: org (the default for a new eval) or private`,
      );
  }
}

interface ArchiveContext {
  org: string;
  tag: string;
  message: string;
  path: string | undefined;
  options: PushFlags;
}

/**
 * Push a pre-packaged skill archive (`--archive`). The bytes are uploaded
 * as-is, so source-mode and filtering flags have nothing to act on — passing
 * one alongside --archive is a contradiction we fail loudly rather than
 * silently ignore.
 */
async function pushArchive(
  client: import("@stigmer/client").Stigmer,
  skill: typeof import("../resources/skill.js"),
  ctx: ArchiveContext,
): Promise<void> {
  const conflicts: string[] = [];
  if (ctx.path !== undefined && ctx.path !== "") conflicts.push("[path]");
  if (ctx.options.gitUrl !== undefined && ctx.options.gitUrl !== "")
    conflicts.push("--git-url");
  if (ctx.options.gitRef !== undefined && ctx.options.gitRef !== "")
    conflicts.push("--git-ref");
  if (ctx.options.subdir !== undefined && ctx.options.subdir !== "")
    conflicts.push("--subdir");
  if ((ctx.options.ignore ?? []).length > 0) conflicts.push("--ignore");
  if ((ctx.options.include ?? []).length > 0) conflicts.push("--include");
  if (ctx.options.gitignore === false) conflicts.push("--no-gitignore");
  if (conflicts.length > 0) {
    throw new UsageError(
      `--archive pushes a pre-packaged ZIP as-is and cannot be combined with: ${conflicts.join(", ")}\n\n` +
        "Packaging already happened when the archive was built.",
    );
  }

  const archivePath = ctx.options.archive ?? "";
  if (ctx.options.dryRun === true) {
    process.stdout.write(
      renderArchiveDryRun(
        archivePath,
        skill.readSkillArchive(archivePath),
        skill,
      ),
    );
    return;
  }

  const result = await skill.pushSkillFromArchive(
    client,
    archivePath,
    ctx.org,
    ctx.tag,
    ctx.message,
  );
  process.stdout.write(renderResult(result, skill));
}

function renderArchiveDryRun(
  archivePath: string,
  archive: import("../resources/skill.js").SkillArchive,
  skill: typeof import("../resources/skill.js"),
): string {
  const lines = [
    "",
    `Dry run - validating skill archive: ${archivePath}`,
    "",
    `Skill name:   ${archive.meta.name}`,
    `Files:        ${archive.fileCount}`,
    `Content size: ${skill.formatBytes(archive.totalSize)}`,
    `Upload size:  ${skill.formatBytes(archive.bytes.length)}`,
    "",
    "The archive bytes are uploaded as-is: the registered version hash is the",
    "SHA-256 of this file, so it matches any checksum you published for it.",
    "",
    "Run without --dry-run to push the skill.",
    "",
  ];
  return `${lines.join("\n")}\n`;
}

interface RemoteContext {
  org: string;
  tag: string;
  message: string;
  ignoreOptions: {
    respectGitignore: boolean;
    extraIgnore: string[];
    extraInclude: string[];
  };
  decisionSink?: (line: string) => void;
  options: PushFlags;
}

async function pushRemote(
  client: import("@stigmer/client").Stigmer,
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
      {
        gitUrl,
        gitRef,
        subdir,
        org: ctx.org,
        tag: ctx.tag,
        message: ctx.message,
        options: ctx.ignoreOptions,
      },
      ctx.decisionSink,
    );
    process.stdout.write(renderResult(result, skill));
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

function renderResult(
  result: import("../resources/skill.js").PushResult,
  skill: typeof import("../resources/skill.js"),
): string {
  const status = result.isNewResource
    ? "new resource"
    : result.versionChanged
      ? "new version"
      : "unchanged";
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
    lines.push(
      "",
      "Sample included:",
      ...analysis.sampleIncluded.map((f) => `  + ${f}`),
    );
  }
  if (analysis.sampleIgnored.length > 0) {
    lines.push(
      "",
      "Sample ignored:",
      ...analysis.sampleIgnored.map((f) => `  - ${f}`),
    );
  }
  lines.push("", "Run without --dry-run to push the skill.", "");
  return `${lines.join("\n")}\n`;
}

function renderRemoteDryRun(
  gitUrl: string,
  gitRef: string,
  subdir: string,
  ctx: RemoteContext,
): string {
  const lines = [
    "",
    "Dry run mode - would push skill from remote git repository:",
    "",
    "Git Source:",
    `  URL:    ${gitUrl}`,
  ];
  if (gitRef !== "") lines.push(`  Ref:    ${gitRef}`);
  if (subdir !== "") lines.push(`  Subdir: ${subdir}`);
  lines.push(`  Tag:    ${ctx.tag}`, "", "Ignore Configuration:");
  lines.push(
    `  Gitignore:         ${ctx.ignoreOptions.respectGitignore ? "enabled" : "disabled"}`,
  );
  lines.push("  Security defaults: enabled");
  lines.push("  Stigmerignore:     will load if present");
  if (ctx.ignoreOptions.extraIgnore.length > 0)
    lines.push(
      `  Extra ignore:      ${ctx.ignoreOptions.extraIgnore.join(", ")}`,
    );
  if (ctx.ignoreOptions.extraInclude.length > 0)
    lines.push(
      `  Force include:     ${ctx.ignoreOptions.extraInclude.join(", ")}`,
    );
  lines.push(
    "",
    "Note: Full analysis requires cloning the repository.",
    "Run without --dry-run to push the skill.",
    "",
  );
  return `${lines.join("\n")}\n`;
}
