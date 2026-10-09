// `runs scores` — the grades of a finished run: each person's thumbs on the
// final answer and the platform's free run-health checks.
//
// The table shows one row per score: what was measured, who gave it, the
// value (up/down for a person's feedback, pass/fail for the checks, or "not
// graded" with the reason), the reasons behind any failed check and a
// person's comment. A reason is written by the server from counts, tool
// names and step numbers, never from what anyone typed, so it prints as
// given. yaml and json render the server's list as `get -o json` renders a
// single score, so a script reads the same envelope either way.

import { create } from "@bufbuild/protobuf";
import { ScoreSchema } from "@stigmer/protos/ai/stigmer/agentic/score/v1/api_pb";
import type { Score } from "@stigmer/protos/ai/stigmer/agentic/score/v1/api_pb";
import {
  CriterionResult,
  ScoreSource,
  ScoreState,
} from "@stigmer/protos/ai/stigmer/agentic/score/v1/enum_pb";
import { ListScoresByRunRequestSchema } from "@stigmer/protos/ai/stigmer/agentic/score/v1/io_pb";
import type { Stigmer } from "@stigmer/sdk";
import { renderEmpty, renderProtoListJson, renderProtoListYaml, renderTable } from "../output/index.js";

/** Output format for scores: a table, or the scores' full proto envelopes. */
export type ScoresFormat = "table" | "yaml" | "json";

export interface ScoresStreams {
  write(text: string): void;
}

const HEADERS = ["METRIC", "SOURCE", "VALUE", "FLAGS", "COMMENT", "BY"] as const;

/** Fetch a run's scores and render them. */
export async function showRunScores(
  client: Stigmer,
  runId: string,
  format: ScoresFormat,
  streams: ScoresStreams = defaultStreams(),
): Promise<void> {
  const list = await client.score.listByRun(create(ListScoresByRunRequestSchema, { runId }));
  if (format === "yaml") {
    streams.write(renderProtoListYaml(ScoreSchema, list.items));
    return;
  }
  if (format === "json") {
    streams.write(renderProtoListJson(ScoreSchema, list.items));
    return;
  }
  streams.write(renderScoresTable(list.items));
}

/** The table view of a run's scores; an empty run says so. */
export function renderScoresTable(scores: readonly Score[]): string {
  if (scores.length === 0) {
    return renderEmpty("scores");
  }
  return `\n${renderTable(HEADERS, scores.map(scoreRow))}\n`;
}

function scoreRow(score: Score): string[] {
  const spec = score.spec;
  return [
    spec?.metric ?? "",
    sourceLabel(spec?.source ?? ScoreSource.unspecified),
    valueLabel(score),
    flagsOf(score),
    oneLine(spec?.comment ?? ""),
    byLabel(score),
  ];
}

/**
 * A person's comment as one table cell. A comment reaches the server from
 * any client, not only the console's one-line box, so a newline would break
 * the table and an escape sequence would reach every other viewer's
 * terminal: each run of control characters becomes one space.
 */
function oneLine(text: string): string {
  return text.replace(/[\u0000-\u001f\u007f-\u009f]+/g, " ").trim();
}

/** Who gave a score, in words; keyed by every source, so it stays exhaustive. */
const SOURCE_LABELS: Readonly<Record<ScoreSource, string>> = {
  [ScoreSource.unspecified]: "",
  [ScoreSource.check]: "check",
  [ScoreSource.human]: "person",
};

function sourceLabel(source: ScoreSource): string {
  return SOURCE_LABELS[source];
}

function valueLabel(score: Score): string {
  if (score.status?.state === ScoreState.not_graded) {
    const reason = score.status.notGradedReason;
    return reason === "" ? "not graded" : `not graded: ${reason}`;
  }
  const value = score.spec?.value;
  if (value?.case !== "passed") {
    return "";
  }
  if (score.spec?.source === ScoreSource.human) {
    return value.value ? "up" : "down";
  }
  return value.value ? "pass" : "fail";
}

/** The reasons of the failed criteria, one per flag. */
function flagsOf(score: Score): string {
  return (score.spec?.criteria ?? [])
    .filter((criterion) => criterion.result === CriterionResult.failed)
    .map((criterion) => `${criterion.name}: ${criterion.reason}`)
    .join("; ");
}

/** Who gave the score: the person, or the platform for a check. */
function byLabel(score: Score): string {
  if (score.spec?.source === ScoreSource.check) {
    return "platform";
  }
  const actor = score.status?.audit?.specAudit?.createdBy;
  return actor?.displayName || actor?.email || actor?.id || "";
}

function defaultStreams(): ScoresStreams {
  return { write: (text: string) => void process.stdout.write(text) };
}
