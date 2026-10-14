/**
 * Pins that file review decides from the session's log alone: the run's
 * file record holds only its capture (the files' bytes) and no decision,
 * while the decisions and the answers are in the log. A person's decision
 * the log holds is final (the same one again writes nothing, another on
 * its target is refused); a captured set whose cited command the log shows
 * allowed is kept by the approved-command rule as its capture lands; and
 * the next turn's close keeps nothing of a set the log shows decided.
 */
import { create } from "@bufbuild/protobuf";
import type { MessageInitShape } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { RunSchema, RunStatusSchema } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import { RunPhase } from "@stigmer/protos/ai/stigmer/agentic/run/v1/enum_pb";
import { TurnCommandProvenanceSchema } from "@stigmer/protos/ai/stigmer/agentic/run/v1/filereview_pb";
import { RunUpdateStatusInputSchema } from "@stigmer/protos/ai/stigmer/agentic/run/v1/io_pb";
import { SessionEventSchema, type SessionEvent } from "@stigmer/protos/ai/stigmer/agentic/session/v1/event_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { createLogger } from "../../../../boot/logger.js";
import { testCallerIdentity } from "../../../../pipeline/__tests__/support.js";
import { newPermissiveSingleTeamAuthorizer } from "../../../../pipeline/steps/authorize.js";
import { tempStore } from "../../../../store/sqlite/__tests__/support.js";
import type { TempStore } from "../../../../store/sqlite/__tests__/support.js";
import { createAgentExecutionActivities } from "../../../../temporal/agentexecution/activities.js";
import { CLOSE_FILE_REVIEW_ACTIVITY_NAME } from "../../../../temporal/agentexecution/names.js";
import { fileReviewSeed } from "../../../run/__tests__/file-review-seed.js";
import { fileReviewDecidedEventId } from "../../../run/filereview/decided.js";
import { updateStatus } from "../../../run/update-status.js";
import { SessionEventBroker } from "../../events/broker.js";
import { draftOf, eventOf } from "../../events/codec.js";
import { createRunAppendingEvents } from "../../events/run-writes.js";
import { toolConfirmationEventId } from "../../hitl/answer.js";
import { CONFLICTING_DECISION_MESSAGE, decideFileChanges } from "../decide.js";
import type { FileDecisionAsked, FileDecisionDeps } from "../decide.js";
import type { ActionWord } from "../words.js";

const silentLogger = createLogger({ level: "error", pretty: false, write: () => {} });
const SESSION = "ses_review";
const ORG = "org_acme";

let temp: TempStore;

beforeEach(() => {
  temp = tempStore();
});

afterEach(async () => {
  await temp.cleanup();
});

const writeDeps = () => ({ store: temp.store, sessionEventBroker: new SessionEventBroker(silentLogger) });

/** A turn of the session holding `status`, its message in the log as the run chain writes it. */
async function storeTurn(id: string, status: MessageInitShape<typeof RunStatusSchema>): Promise<void> {
  await createRunAppendingEvents(
    writeDeps(),
    create(RunSchema, {
      metadata: { id, org: ORG },
      spec: { target: { case: "sessionId", value: SESSION }, message: `turn ${id}` },
      status,
    }),
  );
}

async function appendToLog(runId: string, events: ReadonlyArray<SessionEvent>): Promise<void> {
  await temp.store.sessionEvents.append(SESSION, ORG, events.map(draftOf), {
    kind: ApiResourceKind.run,
    id: runId,
    schema: RunSchema,
    admit: () => undefined,
  });
}

/** A decision the log holds on a whole set, with the id its target gives it; the record has none. */
function decidedInLog(runId: string, changeSetId: string, action: "keep" | "undo", digest: string): SessionEvent {
  return create(SessionEventSchema, {
    runId,
    event: {
      case: "stigmerFileReviewDecided",
      value: {
        id: fileReviewDecidedEventId(changeSetId, "change_set", ""),
        changeSetId,
        scope: "change_set",
        action,
        expectedDigest: digest,
        origin: "person",
      },
    },
  });
}

async function decidedEvents(): Promise<Array<[string, string, string]>> {
  const records = await temp.store.sessionEvents.list(SESSION, {
    order: "asc",
    types: ["stigmer.file_review.decided"],
    limit: 50,
  });
  return records.map(eventOf).flatMap((event) =>
    event.event.case === "stigmerFileReviewDecided"
      ? [[event.event.value.changeSetId, event.event.value.action, event.event.value.origin] as [string, string, string]]
      : [],
  );
}

function decisionDeps(): FileDecisionDeps {
  return {
    ...writeDeps(),
    logger: silentLogger,
    reconcileTurns: () => ({
      create: () => Promise.reject(new Error("no reconcile turn in this test")),
    }),
  };
}

function setDecision(changeSetId: string, action: ActionWord, digest: string): FileDecisionAsked {
  return {
    changeSetId,
    scope: "change_set",
    fileChangeId: "",
    action,
    expectedDigest: digest,
    reason: "",
    acknowledgeUnreviewable: false,
  };
}

describe("file review decided from the session's log alone", () => {
  it("a person's decision the log holds is final: the same again writes nothing, another is refused", async () => {
    const seed = fileReviewSeed("run_a", "run_a:1");
    await storeTurn("run_a", { ...seed.status, phase: RunPhase.RUN_COMPLETED });
    await appendToLog("run_a", [decidedInLog("run_a", "run_a:1", "keep", seed.aggregate)]);
    const person = testCallerIdentity({ identityId: "usr_person" });

    const again = await decideFileChanges(
      decisionDeps(),
      { runId: "run_a", sessionId: SESSION },
      setDecision("run_a:1", "keep", seed.aggregate),
      person,
    );
    expect(again.recorded).toBe(false);

    let refused: unknown;
    try {
      await decideFileChanges(
        decisionDeps(),
        { runId: "run_a", sessionId: SESSION },
        setDecision("run_a:1", "undo", seed.aggregate),
        person,
      );
    } catch (error) {
      refused = error;
    }
    expect(refused).toBeInstanceOf(ConnectError);
    expect((refused as ConnectError).code).toBe(Code.FailedPrecondition);
    expect((refused as ConnectError).rawMessage).toBe(CONFLICTING_DECISION_MESSAGE);
    expect(await decidedEvents()).toEqual([["run_a:1", "keep", "person"]]);
  });

  it("keeps a captured set by the approved-command policy when the log shows its cited command allowed", async () => {
    await storeTurn("run_b", { phase: RunPhase.RUN_IN_PROGRESS });
    const useId = "run_b.tc-shell";
    await appendToLog("run_b", [
      create(SessionEventSchema, {
        runId: "run_b",
        event: { case: "agentToolUse", value: { id: useId, name: "shell", input: {}, evaluatedPermission: "ask" } },
      }),
      create(SessionEventSchema, {
        runId: "run_b",
        event: {
          case: "userToolConfirmation",
          value: { id: toolConfirmationEventId(useId), toolUseId: useId, result: "allow" },
        },
      }),
    ]);
    const capture = create(RunStatusSchema, { ...fileReviewSeed("run_b", "run_b:0").status, phase: RunPhase.RUN_COMPLETED });
    capture.fileChanges[0]!.commandProvenance = create(TurnCommandProvenanceSchema, { consentToolCallIds: ["tc-shell"] });

    await updateStatus(
      {
        ...writeDeps(),
        logger: silentLogger,
        authorizer: newPermissiveSingleTeamAuthorizer(),
        statusObservers: [],
        responseDecorators: [],
      },
      create(RunUpdateStatusInputSchema, { runId: "run_b", status: capture }),
      testCallerIdentity(),
    );

    const run = await temp.store.getResource(ApiResourceKind.run, "run_b", RunSchema);
    expect(run.status?.fileChanges.map((cs) => [cs.id, cs.changes.length])).toEqual([["run_b:0", 1]]);
    expect(await decidedEvents()).toEqual([["run_b:0", "keep", "approved_command"]]);
  });

  it("the next turn's close keeps nothing of a set the log shows decided", async () => {
    const seed = fileReviewSeed("run_c", "run_c:0");
    await storeTurn("run_c", { ...seed.status, phase: RunPhase.RUN_COMPLETED });
    await appendToLog("run_c", [decidedInLog("run_c", "run_c:0", "undo", seed.aggregate)]);
    await storeTurn("run_d", { phase: RunPhase.RUN_PENDING });
    const activities = createAgentExecutionActivities({
      store: temp.store,
      logger: silentLogger,
      statusWriter: () => {
        throw new Error("the close writes no status");
      },
      sessionEventBroker: new SessionEventBroker(silentLogger),
    });
    const close = activities[CLOSE_FILE_REVIEW_ACTIVITY_NAME] as (executionId: string, sessionId: string) => Promise<void>;

    await close("run_d", SESSION);

    expect(await decidedEvents()).toEqual([["run_c:0", "undo", "person"]]);
  });
});
