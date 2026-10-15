// `runs to-eval-case` dispatch: turn a run into an eval case, so a bad live
// conversation becomes a case the agent is measured on.
//
// The server builds the case (`eval.buildCaseFromRun`), the same one the
// console's "Make a test case" offers: the turn's request as prompt.md, the
// conversation before it as history.jsonl, each MCP tool answer the run got
// as a fixed mock, and graders/criteria.md with its FAIL line seeded from
// the AI judge's failing reason or the caller's thumbs-down note; with
// `--skill <plugin>:<skill>`, a check that the skill was read. The command
// either unzips that case under `--dir` on this machine (Stigmer never
// writes into the author's repository; a case directory that already exists
// is refused, so a case the author edited is never overwritten) or, with
// `--eval <ref>`, adds it to that eval as a new version
// (`eval.addCaseFromRun`), which the server builds and writes.
//
// File effects are injected, so the rules are tested without a disk.

import { create } from "@bufbuild/protobuf";
import { unzipSync } from "fflate";
import { digestArchive } from "@stigmer/plugin-package/client";
import {
  AddEvalCaseFromRunRequestSchema,
  BuildEvalCaseFromRunRequestSchema,
} from "@stigmer/protos/ai/stigmer/agentic/eval/v1/io_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import type { Stigmer } from "@stigmer/sdk";
import { UsageError } from "../errors/index.js";
import { splitEvalVersion } from "./eval.js";
import { idPrefixesFor, parseReference } from "./reference.js";
import { shortHash } from "./skill.js";

/** The options as commander hands them over. */
export interface ToEvalCaseFlags {
  readonly dir?: string;
  readonly name?: string;
  readonly skill?: string;
  readonly eval?: string;
}

/** The file system the command writes through. */
export interface CaseFolderIo {
  exists(path: string): Promise<boolean>;
  /** Writes every file of `archive` under `dir`; answers how many. */
  extract(archive: Uint8Array, dir: string): number;
  readonly stderr: { write(text: string): void };
}

/** A case directory name the format reads: lower-case words and dashes. */
const CASE_NAME_PATTERN = /^[a-z0-9][a-z0-9._-]*$/;

/** The directory a case is written under when `--dir` names none. */
const DEFAULT_DIR = "evals";

/**
 * Builds the case for `runId` and writes it under `--dir`, or adds it to
 * the eval `--eval` names; answers the case directory written, or the new
 * version's digest.
 */
export async function writeEvalCaseFromRun(
  client: Stigmer,
  runId: string,
  flags: ToEvalCaseFlags,
  io: CaseFolderIo,
  org: string,
): Promise<string> {
  const skill = parseSkill(flags.skill);
  const caseName = (flags.name ?? "").trim();
  if (caseName !== "" && !CASE_NAME_PATTERN.test(caseName)) {
    throw new UsageError(`--name '${caseName}' is not a case name: use lower-case letters, digits and dashes`);
  }
  if (flags.eval !== undefined) {
    if (flags.dir !== undefined) {
      throw new UsageError("--dir names where a case is written on this machine; with --eval the case goes into the eval instead");
    }
    return addToEval(client, runId, flags.eval, caseName, skill, io, org);
  }

  const built = await client.eval.buildCaseFromRun(create(BuildEvalCaseFromRunRequestSchema, { runId, caseName, skill }));
  if ((await digestArchive(built.artifact)) !== built.digest) {
    throw new UsageError(`the case archive for run ${runId} does not match its digest; nothing was written`);
  }
  const dir = trimSlashes(flags.dir ?? DEFAULT_DIR) || ".";
  const caseDir = `${dir}/${built.caseName}`;
  const outside = entriesOutside(built.artifact, built.caseName);
  if (outside !== undefined) {
    throw new UsageError(`the case archive holds '${outside}', outside its case directory '${built.caseName}'; nothing was written`);
  }
  if (await io.exists(caseDir)) {
    throw new UsageError(`${caseDir} already exists; choose another --name, or remove it first`);
  }
  const files = io.extract(built.artifact, dir);
  io.stderr.write(
    `Wrote ${caseDir} (${files} ${files === 1 ? "file" : "files"}).\n` +
      `Fill in the PASS line of ${caseDir}/graders/criteria.md, then push the folder it is in: ` +
      "`stigmer push eval` for an eval, `stigmer push plugin` for a plugin's evals/.\n",
  );
  for (const note of built.notes) {
    io.stderr.write(`Note: ${note}\n`);
  }
  return caseDir;
}

/** Adds the run's case to the eval `input` names, as a new version. */
async function addToEval(
  client: Stigmer,
  runId: string,
  input: string,
  caseName: string,
  skill: string,
  io: CaseFolderIo,
  org: string,
): Promise<string> {
  const { ref, version } = splitEvalVersion(input);
  if (version !== "") {
    throw new UsageError(`--eval '${input}' names a version: a case joins the eval's current version, so name the eval alone`);
  }
  const parsed = parseReference(ref, org, idPrefixesFor(ApiResourceKind.eval));
  const reference =
    parsed.kind === "id"
      ? { kind: ApiResourceKind.eval, id: parsed.id }
      : { kind: ApiResourceKind.eval, org: parsed.org, slug: parsed.slug };
  const added = await client.eval.addCaseFromRun(
    create(AddEvalCaseFromRunRequestSchema, { runId, eval: reference, caseName, skill }),
  );
  const digest = added.status?.digest ?? "";
  const message = added.metadata?.version?.message ?? "";
  io.stderr.write(
    `Added the case to eval '${added.metadata?.slug ?? ref}' as version ${shortHash(digest)}${message === "" ? "" : ` (${message})`}.\n` +
      "Fill in the PASS line of its graders/criteria.md: `stigmer download eval` gives the folder back.\n",
  );
  return digest;
}

/** Reads `--skill <plugin>:<skill>`; "" when not given. */
function parseSkill(raw: string | undefined): string {
  if (raw === undefined) return "";
  const colon = raw.indexOf(":");
  const plugin = colon < 0 ? "" : raw.slice(0, colon).trim();
  const skill = colon < 0 ? "" : raw.slice(colon + 1).trim();
  if (plugin === "" || skill === "") {
    throw new UsageError(`--skill '${raw}' names no skill: write <plugin>:<skill>, as in thermos:review`);
  }
  return `${plugin}:${skill}`;
}

/** The first entry of `archive` not under `caseName/`, read without inflating anything. */
function entriesOutside(archive: Uint8Array, caseName: string): string | undefined {
  let outside: string | undefined;
  unzipSync(archive, {
    filter: (file) => {
      if (outside === undefined && !file.name.startsWith(`${caseName}/`)) outside = file.name;
      return false;
    },
  });
  return outside;
}

function trimSlashes(path: string): string {
  return path.trim().replace(/\/+$/, "");
}
