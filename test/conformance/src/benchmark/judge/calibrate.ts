// The judge cell's live half: grades every example (examples/) k times
// through the AI judge's real path, over the public API, on a real model.
// Domain: conformance benchmark (the live half; an experiment, never a test).
//
// Each try is a judge run as the server's grading creates one
// (domain/score/judge/judge-run.ts in the server): the reserved judge label,
// which the runner reads to run its built-in judge (tool-less, its
// instruction from @stigmer/eval-runtime); the message `judgeMessage` builds
// around the example rendered by `renderSubject`; the verdict schema; the
// platform's default model; the per-grade cost cap. Its structured output is
// read by the same `readVerdict` the server reads a live grade with. So what
// is measured is the judge a customer's runs get, the runner's structured
// output and its extraction tiers included, and not a direct provider call.
// A client may write the judge label in the open-source posture, where all it
// buys is a tool-less run of its own that is not graded.
//
// A run stops launching tries once what it spent, plus the cap of every try
// still running, would pass its budget, and says so; the counts then cover
// the tries that ran and the bar refuses the gaps. Every try's session is
// deleted when it is read, and the organization when the run ends.
import { create } from "@bufbuild/protobuf";
import {
  JUDGE_EVALUATOR_VERSION,
  RUBRICS,
  VERDICT_SCHEMA,
  judgeMessage,
  readVerdict,
  renderSubject,
} from "@stigmer/eval-runtime";
import { RunSchema } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import { RunPhase } from "@stigmer/protos/ai/stigmer/agentic/run/v1/enum_pb";
import { Harness } from "@stigmer/protos/ai/stigmer/agentic/session/v1/enum_pb";
import type { ConformanceClients } from "../../harness/clients";
import { GRADES_RUN_LABEL } from "../../support/evaluators";
import { uniqueName } from "../../support/naming";
import { createUniqueOrganization } from "../../support/organizations";
import { awaitTerminal, makeAgentExecution, sessionIdOf } from "../../support/runs";
import { tallyCalibration, type CalibrationMiss, type CalibrationTry, type JudgeCalibration } from "./calibration-tally";
import { examplesDigest, type JudgeExample } from "./example";

/**
 * The most one grade may spend, in estimated US dollars: the server's
 * PER_GRADE_CAP_USD (domain/score/judge/judge-run.ts), which a live grade's
 * judge run is capped at.
 */
export const PER_GRADE_CAP_USD = 0.25;

/** The judge session's subject, as the server sets it, so the run makes no titling call. */
const JUDGE_SESSION_SUBJECT = "Grading";

/** How long one judge run may take before its try counts as unreadable. */
const TRY_TIMEOUT_MS = 180_000;

export interface CalibrationOptions {
  readonly examples: ReadonlyArray<JudgeExample>;
  /** Tries per example. */
  readonly tries: number;
  /** Tries in flight at once. */
  readonly concurrency: number;
  /** The most the run may spend, in estimated US dollars. */
  readonly budgetUsd: number;
}

export interface CalibrationRun {
  readonly calibration: JudgeCalibration;
  readonly misses: ReadonlyArray<CalibrationMiss>;
  /** Whether the budget stopped the run before every try ran. */
  readonly stoppedAtBudget: boolean;
}

export interface CalibrationIo {
  readonly now: () => number;
  readonly log: (line: string) => void;
}

/* v8 ignore next -- @preserve: the live benchmark is a hand-run script no vitest config collects (vitest.unit.config.ts tests only its pure readers) */
export async function runJudgeCalibration(
  clients: ConformanceClients,
  options: CalibrationOptions,
  io: CalibrationIo,
): Promise<CalibrationRun> {
  const { id: org } = await createUniqueOrganization(clients.organizationCommand, "the AI judge's calibration");
  const queue = options.examples.flatMap((example) =>
    Array.from({ length: options.tries }, (_, attempt) => ({ example, attempt })),
  );
  const tries: CalibrationTry[] = [];
  const models = new Set<string>();
  let spentUsd = 0;
  let inFlight = 0;

  const worker = async (): Promise<void> => {
    for (;;) {
      if (spentUsd + (inFlight + 1) * PER_GRADE_CAP_USD > options.budgetUsd) {
        return;
      }
      const next = queue.shift();
      if (next === undefined) return;
      inFlight += 1;
      try {
        const graded = await gradeOnce(clients, org, next.example, io);
        spentUsd += graded.costUsd;
        if (graded.model !== "") models.add(graded.model);
        tries.push(graded.attempt);
        io.log(
          `judge ${next.example.id}#${next.attempt + 1}: ${graded.attempt.verdicts === undefined ? "unreadable" : "read"} ($${graded.costUsd.toFixed(4)})`,
        );
      } finally {
        inFlight -= 1;
      }
    }
  };
  try {
    await Promise.all(Array.from({ length: options.concurrency }, () => worker()));
  } finally {
    await clients.organizationCommand.delete({ value: org }).catch(() => undefined);
  }
  // Every worker has stopped: what is left in the queue is what the budget kept from running.
  const stoppedAtBudget = queue.length > 0;
  if (stoppedAtBudget) {
    io.log(`judge: stopped at the budget, $${spentUsd.toFixed(2)} spent of $${options.budgetUsd}; ${queue.length} tries not run`);
  }

  const { calibration, misses } = tallyCalibration(
    options.examples,
    RUBRICS.map((rubric) => rubric.name),
    tries,
    {
      evaluatorVersion: JUDGE_EVALUATOR_VERSION,
      examplesDigest: examplesDigest(options.examples),
      model: [...models].sort().join(", "),
      tries: options.tries,
      date: new Date(io.now()).toISOString().slice(0, 10),
    },
  );
  return { calibration, misses, stoppedAtBudget };
}

/** One judge run over one example, read as the server reads a live grade. */
/* v8 ignore next -- @preserve: the live benchmark is a hand-run script no vitest config collects (vitest.unit.config.ts tests only its pure readers) */
async function gradeOnce(
  clients: ConformanceClients,
  org: string,
  example: JudgeExample,
  io: CalibrationIo,
): Promise<{ attempt: CalibrationTry; costUsd: number; model: string }> {
  const request = create(
    RunSchema,
    makeAgentExecution({
      org,
      name: uniqueName("judge-example"),
      sessionSpec: { subject: JUDGE_SESSION_SUBJECT, harness: Harness.NATIVE },
      message: judgeMessage(renderSubject(example.parts)),
      runConfig: { modelName: "", maxCostUsd: PER_GRADE_CAP_USD },
      structuredOutputSchema: VERDICT_SCHEMA,
    }),
  );
  if (request.metadata !== undefined) {
    request.metadata.labels = { [GRADES_RUN_LABEL]: `example-${example.id}` };
  }
  let costUsd = 0;
  let model = "";
  let verdicts: CalibrationTry["verdicts"];
  let sessionId = "";
  try {
    const created = await clients.agentExecutionCommand.create(request);
    sessionId = sessionIdOf(created);
    const ended = await awaitTerminal(clients, created.metadata?.id ?? "", { timeoutMs: TRY_TIMEOUT_MS, pollMs: 1_000 });
    sessionId = sessionIdOf(ended) || sessionId;
    costUsd = ended.status?.streamingUsage?.estimatedCostUsd ?? 0;
    model = ended.status?.streamingUsage?.model ?? "";
    if (ended.status?.phase === RunPhase.RUN_COMPLETED) {
      const reading = readVerdict(ended.status.structuredOutput);
      if (reading.kind === "read") {
        verdicts = reading.verdicts;
      } else {
        io.log(`judge ${example.id}: the answer could not be read: ${reading.cause}`);
      }
    } else {
      io.log(`judge ${example.id}: the judge run ended ${RunPhase[ended.status?.phase ?? RunPhase.RUN_PHASE_UNSPECIFIED]}: ${ended.status?.error ?? ""}`);
    }
  } catch (error) {
    io.log(`judge ${example.id}: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    if (sessionId !== "") {
      await clients.sessionCommand.delete({ value: sessionId }).catch(() => undefined);
    }
  }
  return { attempt: { exampleId: example.id, verdicts, costUsd }, costUsd, model };
}
