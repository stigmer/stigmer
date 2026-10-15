// An evals/ folder as an eval push, and an eval's archive back as a folder.
//
// An eval is Claude Code's evals/ folder pushed whole: its case directories,
// mocks/ and shared files at the archive root, named by the slug the push
// gives, since the folder names nothing. The push half walks the folder
// through the same walk and ignore rules a plugin push uses
// (`readPluginDirectory`), then hands the selection to the shared
// `prepareEvalArchive`, which leaves out `results/` (what `claude plugin
// eval` writes), reads the cases exactly as the server will and builds the
// archive whose SHA-256 the server records. `push eval --dry-run` prints that
// reading and sends nothing.
//
// The download half resolves the reference at its version first, so the
// folder written is the version that was named, then fetches its archive
// through the SDK helper (digest checked) and unzips it into a new or empty
// directory, refusing an entry that would land outside it.

import { mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";
import { create, toJson } from "@bufbuild/protobuf";
import { unzipSync } from "fflate";
import type { EvalSuite, EvalSuiteFinding } from "@stigmer/plugin-package";
import { prepareEvalArchive } from "@stigmer/plugin-package/client";
import { EvalSchema, type Eval } from "@stigmer/protos/ai/stigmer/agentic/eval/v1/api_pb";
import { PushEvalRequestSchema } from "@stigmer/protos/ai/stigmer/agentic/eval/v1/io_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import type { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";
import { downloadEvalArchive, type Stigmer } from "@stigmer/sdk";
import { UsageError } from "../errors/index.js";
import { CommandResult } from "../output/index.js";
import { readPluginDirectory } from "./plugin.js";
import type { ParsedReference } from "./reference.js";
import { formatBytes, shortHash, type IgnoreOptions, type ZipStats } from "./skill.js";

/** An evals/ folder ready to push: the server's reading, the bytes and their identity. */
export interface PreparedEvalPush {
  readonly dir: string;
  readonly suite: EvalSuite;
  readonly stats: ZipStats;
  readonly archive: Uint8Array;
  readonly digest: string;
}

/**
 * Walk, select, read and archive an evals/ folder, refusing what the server
 * refuses: a plugin folder (its evals/ folder is the eval) and a folder
 * where no case loads, with the reader's sentences.
 */
export async function prepareEvalPush(dir: string, ignoreOptions: IgnoreOptions): Promise<PreparedEvalPush> {
  const directory = readPluginDirectory(dir, ignoreOptions);
  const outcome = await prepareEvalArchive(directory);
  if (!outcome.ok) {
    if (outcome.kind === "plugin-folder") throw pluginFolderRefusal(dir);
    throw noCaseRefusal(dir, outcome.findings);
  }
  return {
    dir,
    suite: outcome.prepared.suite,
    stats: outcome.prepared.stats,
    archive: outcome.prepared.archive,
    digest: outcome.prepared.digest,
  };
}

function pluginFolderRefusal(dir: string): UsageError {
  return new UsageError(
    `${dir} is a plugin folder, not an evals/ folder\n\n` +
      `An eval is the folder of cases itself: push ${join(dir, "evals")} instead.`,
  );
}

function noCaseRefusal(dir: string, findings: readonly EvalSuiteFinding[]): UsageError {
  if (findings.length === 0) {
    return new UsageError(
      `${dir}: eval cannot be pushed: the folder holds no case\n\n` +
        "A case is a directory holding prompt.md or case.yaml, at the folder's root or beneath it.",
    );
  }
  return new UsageError(
    [
      `${dir}: eval cannot be pushed: no case in the folder loads, ${count(findings.length, "problem")} found:`,
      ...findings.map((finding) => `  - ${finding.message}`),
    ].join("\n"),
  );
}

function count(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

/** What a push of the folder would store, as `push eval --dry-run` prints it. */
export function describeEvalPush(prepared: PreparedEvalPush, slug: string): CommandResult {
  const { suite, stats } = prepared;
  const result = CommandResult.success(`Dry run: eval '${slug}' would hold ${count(suite.cases.length, "case")}`);
  const about = result.addSection("Eval");
  about.field("Slug", slug);
  about.field("Digest", prepared.digest);
  about.field("Files", `${stats.filesIncluded} read, ${stats.filesIgnored} left out`);
  about.field("Size", formatBytes(prepared.archive.length));
  const cases = result.addSection("Cases");
  for (const evalCase of suite.cases) {
    const tags = evalCase.tags.length === 0 ? "" : ` [${evalCase.tags.join(", ")}]`;
    const unsupported = evalCase.unsupported === undefined ? "" : ` (not run yet: ${evalCase.unsupported})`;
    cases.item(`${evalCase.name} (${evalCase.dir})${tags}${unsupported}`);
  }
  result.addSection("Mocks").field("MCP servers", suite.servers.length === 0 ? "none" : suite.servers.join(", "));
  if (suite.findings.length > 0) {
    const section = result.addSection("Findings");
    for (const finding of suite.findings) section.item(finding.message);
  }
  result.hint("Run without --dry-run to push it.");
  return result.withData({
    slug,
    digest: prepared.digest,
    cases: suite.cases.map((c) => ({ name: c.name, path: c.dir, tags: c.tags, ...(c.unsupported !== undefined && { unsupported: c.unsupported }) })),
    findings: suite.findings,
    mockServers: suite.servers,
  });
}

export interface PushEvalOptions {
  readonly org: string;
  readonly slug: string;
  /** The display name; absent keeps the stored one (the slug for a new eval). */
  readonly name?: string;
  /** The tag to move to this version; absent moves none. */
  readonly tag?: string;
  readonly visibility: ApiResourceVisibility | undefined;
  readonly message: string;
}

/** The push request a prepared folder becomes: only what the user gave is set. */
export function evalPushRequest(prepared: PreparedEvalPush, options: PushEvalOptions) {
  return create(PushEvalRequestSchema, {
    org: options.org,
    slug: options.slug,
    artifact: prepared.archive,
    message: options.message,
    ...(options.name !== undefined && { name: options.name }),
    ...(options.tag !== undefined && { tag: options.tag }),
    ...(options.visibility !== undefined && { visibility: options.visibility }),
  });
}

/** Push a prepared folder through the SDK's routed eval client. */
export async function pushEval(client: Stigmer, prepared: PreparedEvalPush, options: PushEvalOptions): Promise<Eval> {
  return client.eval.push(evalPushRequest(prepared, options));
}

/** The pushed eval: which version it is now at, and what that version holds. */
export function renderEvalPush(pushed: Eval, prepared: PreparedEvalPush): CommandResult {
  const status = pushed.status;
  const findings = status?.findings ?? [];
  const headline = `Pushed eval '${pushed.metadata?.slug ?? ""}' (${count(status?.caseCount ?? 0, "case")})`;
  const result =
    findings.length === 0
      ? CommandResult.success(headline)
      : CommandResult.warning(`${headline} with ${count(findings.length, "case finding")}`);
  const about = result.addSection("Eval");
  about.field("ID", pushed.metadata?.id ?? "");
  about.field("Slug", pushed.metadata?.slug ?? "");
  about.field("Digest", shortHash(status?.digest ?? ""));
  if (pushed.spec?.tag) about.field("Tag", pushed.spec.tag);
  if (pushed.metadata?.version?.message) about.field("Message", pushed.metadata.version.message);
  about.field("Size", formatBytes(prepared.archive.length));
  if (findings.length > 0) {
    const section = result.addSection("Findings");
    for (const finding of findings) section.item(finding.message);
  }
  return result.withData({ eval: toJson(EvalSchema, pushed) });
}

/** `<ref>@<version>` split: the reference, and a digest or tag when one is named. */
export function splitEvalVersion(input: string): { readonly ref: string; readonly version: string } {
  const trimmed = input.trim();
  const at = trimmed.lastIndexOf("@");
  if (at <= 0) return { ref: trimmed, version: "" };
  const version = trimmed.slice(at + 1);
  if (version === "") {
    throw new UsageError(`'${input}' names no version after '@': give a digest or a tag, or leave '@' out for the current version`);
  }
  return { ref: trimmed.slice(0, at), version };
}

export interface DownloadEvalOutcome {
  readonly slug: string;
  readonly digest: string;
  readonly tag: string;
  readonly dir: string;
  readonly files: number;
  readonly bytes: number;
}

/**
 * Download one version of an eval into `outputDir`, or `./<slug>` when
 * none is given: resolve the reference at its version, fetch that digest's
 * archive (checked against it), and unzip it.
 */
export async function downloadEval(
  client: Stigmer,
  ref: ParsedReference,
  version: string,
  outputDir: string | undefined,
): Promise<DownloadEvalOutcome> {
  const reference =
    ref.kind === "id"
      ? { org: "", slug: "", id: ref.id, version, kind: ApiResourceKind.eval }
      : { org: ref.org, slug: ref.slug, version, kind: ApiResourceKind.eval };
  const resolved = await client.eval.getByReference(reference);
  const slug = resolved.metadata?.slug ?? "";
  const digest = resolved.status?.digest ?? "";
  const target = outputDir ?? join(".", slug);
  ensureEmptyDirectory(target);
  const downloaded = await downloadEvalArchive(
    client.eval,
    { org: resolved.metadata?.org ?? "", slug, version: digest, kind: ApiResourceKind.eval },
    client.fetch,
  );
  const files = extractArchive(downloaded.bytes, target);
  return { slug, digest: downloaded.digest, tag: resolved.spec?.tag ?? "", dir: target, files, bytes: downloaded.bytes.length };
}

/** A directory the download may write: absent (made here) or empty. */
export function ensureEmptyDirectory(dir: string): void {
  let stats;
  try {
    stats = statSync(dir);
  } catch {
    mkdirSync(dir, { recursive: true });
    return;
  }
  if (!stats.isDirectory()) {
    throw new UsageError(`${dir} exists and is not a directory: name a new or empty directory with -o`);
  }
  if (readdirSync(dir).length > 0) {
    throw new UsageError(`${dir} is not empty: name a new or empty directory with -o, so no file of yours is overwritten`);
  }
}

/**
 * Write every file of `archive` under `dir`, refusing the whole archive
 * before writing anything when an entry is absolute or would land outside
 * `dir`. Returns the number of files written.
 */
export function extractArchive(archive: Uint8Array, dir: string): number {
  const entries = unzipSync(archive);
  const root = resolve(dir);
  const planned: Array<[string, Uint8Array]> = [];
  for (const [name, bytes] of Object.entries(entries)) {
    if (name.endsWith("/")) continue;
    if (isAbsolute(name) || /^[A-Za-z]:/.test(name) || name.startsWith("\\")) {
      throw new UsageError(`the eval archive holds an absolute path '${name}'; nothing was written`);
    }
    const target = resolve(root, name);
    // An entry that resolves to the directory itself (`x/..`) names no
    // file in it, and one outside it would escape.
    if (!target.startsWith(root + sep)) {
      throw new UsageError(`the eval archive holds '${name}', which would land outside ${dir}; nothing was written`);
    }
    planned.push([target, bytes]);
  }
  for (const [target, bytes] of planned) {
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, bytes);
  }
  return planned.length;
}

/** The downloaded folder, as `download eval` prints it. */
export function renderEvalDownload(outcome: DownloadEvalOutcome): CommandResult {
  const result = CommandResult.success(`Downloaded eval '${outcome.slug}' into ${outcome.dir}`);
  const about = result.addSection("Eval");
  about.field("Digest", outcome.digest);
  if (outcome.tag !== "") about.field("Tag", outcome.tag);
  about.field("Files", String(outcome.files));
  about.field("Size", formatBytes(outcome.bytes));
  return result.withData(outcome);
}
