// `runs to-eval-case` dispatch: turn a run into a test case folder in the
// local plugin's evals/ directory, so a bad live conversation becomes a case
// the next version of the plugin is measured on.
//
// The case is the SDK's `caseFromRun`, the same files the console's "Make a
// test case" zips: prompt.md from the run's request, graders/criteria.md
// with its FAIL line seeded from the AI judge's failing reason (or a plugin
// eval's failing check), else a person's thumbs-down comment, and, with
// `--skill <plugin>:<skill>`, a graders/skill-fired.md check that the skill
// fired. A run that continued a conversation takes its last request and
// says so. The command writes only under `--dir` on this machine (Stigmer
// never writes into the author's repository) and refuses a case directory
// that already exists, so a case the author edited is never overwritten.
//
// File effects are injected, so the rules are tested without a disk.

import { timestampMs } from "@bufbuild/protobuf/wkt";
import { create } from "@bufbuild/protobuf";
import type { Run } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import { ListRunsBySessionRequestSchema } from "@stigmer/protos/ai/stigmer/agentic/run/v1/io_pb";
import type { Score } from "@stigmer/protos/ai/stigmer/agentic/score/v1/api_pb";
import { CriterionResult, ScoreSource } from "@stigmer/protos/ai/stigmer/agentic/score/v1/enum_pb";
import { ListScoresByRunRequestSchema } from "@stigmer/protos/ai/stigmer/agentic/score/v1/io_pb";
import { caseFromRun, suggestCaseName, type Stigmer } from "@stigmer/sdk";
import { UsageError } from "../errors/index.js";

/** The options as commander hands them over. */
export interface ToEvalCaseFlags {
  readonly dir?: string;
  readonly name?: string;
  readonly skill?: string;
}

/** The file system the command writes through. */
export interface CaseFolderIo {
  exists(path: string): Promise<boolean>;
  writeFile(path: string, content: string): Promise<void>;
  readonly stderr: { write(text: string): void };
}

/** A case directory name the format reads: lower-case words and dashes. */
const CASE_NAME_PATTERN = /^[a-z0-9][a-z0-9._-]*$/;

/** Writes the case folder for `runId` and says where. */
export async function writeEvalCaseFromRun(
  client: Stigmer,
  runId: string,
  flags: ToEvalCaseFlags,
  io: CaseFolderIo,
): Promise<string> {
  const skill = parseSkill(flags.skill);
  const caseNameFlag = (flags.name ?? "").trim();
  if (caseNameFlag !== "" && !CASE_NAME_PATTERN.test(caseNameFlag)) {
    throw new UsageError(`--name '${caseNameFlag}' is not a case name: use lower-case letters, digits and dashes`);
  }

  const run = await client.run.get(runId);
  const request = run.spec?.message ?? "";
  if (request.trim() === "") {
    throw new UsageError(`run ${runId} has no request to make a case from`);
  }
  const [scores, multiTurn] = await Promise.all([
    client.score.listByRun(create(ListScoresByRunRequestSchema, { runId })).then((list) => list.items),
    continuesConversation(client, run),
  ]);

  const caseName = caseNameFlag === "" ? suggestCaseName(request) : caseNameFlag;
  const dir = trimSlashes(flags.dir ?? "evals") || ".";
  const caseDir = `${dir}/${caseName}`;
  if (await io.exists(caseDir)) {
    throw new UsageError(`${caseDir} already exists; choose another --name, or remove it first`);
  }

  const built = caseFromRun({
    request,
    caseName,
    ...optional("judgeReason", failingReason(scores)),
    ...optional("thumbsComment", thumbsDownComment(scores)),
    ...(skill !== undefined && { skillNeverRead: skill }),
    multiTurn,
  });
  for (const file of built.files) {
    await io.writeFile(`${caseDir}/${file.path}`, file.content);
  }
  io.stderr.write(
    `Wrote ${built.files.map((file) => `${caseDir}/${file.path}`).join(", ")}\n` +
      `Fill in the PASS line of ${caseDir}/graders/criteria.md, then push the plugin and run \`stigmer plugin eval\`.\n`,
  );
  if (built.note !== undefined) {
    io.stderr.write(`Note: ${built.note}.\n`);
  }
  return caseDir;
}

/** Reads `--skill <plugin>:<skill>`. */
function parseSkill(raw: string | undefined): { plugin: string; skill: string } | undefined {
  if (raw === undefined) return undefined;
  const colon = raw.indexOf(":");
  const plugin = colon < 0 ? "" : raw.slice(0, colon).trim();
  const skill = colon < 0 ? "" : raw.slice(colon + 1).trim();
  if (plugin === "" || skill === "") {
    throw new UsageError(`--skill '${raw}' names no skill: write <plugin>:<skill>, as in thermos:review`);
  }
  return { plugin, skill };
}

/** The judge's first failing reason, else a plugin eval's first failing check. */
function failingReason(scores: readonly Score[]): string {
  for (const source of [ScoreSource.judge, ScoreSource.eval]) {
    for (const score of scores) {
      if (score.spec?.source !== source) continue;
      const failed = score.spec.criteria.find(
        (criterion) => criterion.result === CriterionResult.failed && criterion.reason !== "",
      );
      if (failed !== undefined) return failed.reason;
    }
  }
  return "";
}

/** The comment on the first thumbs-down a person gave the run. */
function thumbsDownComment(scores: readonly Score[]): string {
  const down = scores.find(
    (score) =>
      score.spec?.source === ScoreSource.human &&
      score.spec.value.case === "passed" &&
      !score.spec.value.value &&
      score.spec.comment !== "",
  );
  return down?.spec?.comment ?? "";
}

/** Whether another run of the session came before this one. */
async function continuesConversation(client: Stigmer, run: Run): Promise<boolean> {
  const target = run.spec?.target;
  if (target?.case !== "sessionId" || target.value === "") return false;
  const list = await client.run.listBySession(create(ListRunsBySessionRequestSchema, { sessionId: target.value }));
  const id = run.metadata?.id ?? "";
  const others = list.entries.filter((entry) => entry.metadata?.id !== id);
  const at = createdMs(run);
  if (at === undefined) return others.length > 0;
  return others.some((entry) => (createdMs(entry) ?? Number.POSITIVE_INFINITY) < at);
}

function createdMs(run: Run): number | undefined {
  const createdAt = run.status?.audit?.specAudit?.createdAt;
  return createdAt === undefined ? undefined : timestampMs(createdAt);
}

function optional<K extends string>(key: K, value: string): { [P in K]?: string } {
  return (value === "" ? {} : { [key]: value }) as { [P in K]?: string };
}

function trimSlashes(path: string): string {
  return path.trim().replace(/\/+$/, "");
}
