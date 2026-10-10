// `runs scores` — the grades of a finished run: each person's thumbs on the
// final answer, the platform's free run-health checks, an AI judge's
// verdict where the run's agent has AI grading switched on, and, on a try
// of a plugin eval, the eval's verdict with each check of the case.
//
// The table shows one row per score: what was measured, who gave it, the
// value (up/down for a person's feedback, pass/fail for the checks and the
// judge, "grading" while the judge works, or "not graded" with the reason),
// the reasons behind any failed check or rubric and a person's comment. An
// eval's row lists every check of its case with its verdict, failed or not,
// because a passing check that was only an indicator reads as passed there. A
// check's reason is counts, tool names and step numbers; a judge's may
// quote the conversation, which the run's viewers can read already; every
// reason passes through the same one-line cleaning as a comment. yaml and
// json render the server's list as `get -o json` renders a single score,
// so a script reads the same envelope either way, all criteria included.

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
 * Text another person wrote (a comment, a profile name) or a check's
 * reason, as one table cell. It reaches the server from any client, not
 * only the console's one-line box, so a newline would break the table and
 * an escape sequence would reach every other viewer's terminal: each run of
 * control characters becomes one space.
 */
function oneLine(text: string): string {
  return text.replace(/[\u0000-\u001f\u007f-\u009f]+/g, " ").trim();
}

/** Who gave a score, in words; keyed by every source, so it stays exhaustive. */
const SOURCE_LABELS: Readonly<Record<ScoreSource, string>> = {
  [ScoreSource.unspecified]: "",
  [ScoreSource.check]: "check",
  [ScoreSource.human]: "person",
  [ScoreSource.judge]: "judge",
  [ScoreSource.eval]: "eval",
};

/** A check's verdict, in words; keyed by every result, so it stays exhaustive. */
const RESULT_LABELS: Readonly<Record<CriterionResult, string>> = {
  [CriterionResult.unspecified]: "",
  [CriterionResult.passed]: "passed",
  [CriterionResult.failed]: "failed",
  [CriterionResult.not_applicable]: "not applicable",
};

function sourceLabel(source: ScoreSource): string {
  return SOURCE_LABELS[source];
}

function valueLabel(score: Score): string {
  if (score.status?.state === ScoreState.pending) {
    return "grading";
  }
  if (score.status?.state === ScoreState.not_graded) {
    const reason = oneLine(score.status.notGradedReason);
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

/**
 * The reasons of the failed criteria, one per flag; for an eval, every
 * check with its verdict and reason.
 */
function flagsOf(score: Score): string {
  if (score.spec?.source === ScoreSource.eval) {
    return score.spec.criteria
      .map((criterion) => {
        const verdict = `${criterion.name}: ${RESULT_LABELS[criterion.result]}`;
        return oneLine(criterion.reason === "" ? verdict : `${verdict} (${criterion.reason})`);
      })
      .join("; ");
  }
  return (score.spec?.criteria ?? [])
    .filter((criterion) => criterion.result === CriterionResult.failed)
    .map((criterion) => oneLine(`${criterion.name}: ${criterion.reason}`))
    .join("; ");
}

/** Who gave the score: the person, the platform for a check or an eval, the judge's model for a judge. */
function byLabel(score: Score): string {
  if (score.spec?.source === ScoreSource.check || score.spec?.source === ScoreSource.eval) {
    return "platform";
  }
  if (score.spec?.source === ScoreSource.judge) {
    return oneLine(score.spec.judgeModel || "platform");
  }
  const actor = score.status?.audit?.specAudit?.createdBy;
  return oneLine(actor?.displayName || actor?.email || actor?.id || "");
}

function defaultStreams(): ScoresStreams {
  return { write: (text: string) => void process.stdout.write(text) };
}
