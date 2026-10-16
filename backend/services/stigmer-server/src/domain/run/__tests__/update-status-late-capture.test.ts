/**
 * Pins the capture write's close of an outdated turn (update-status.ts,
 * filereview/autokeep.ts keepOutdatedSets) on a real store: a turn whose
 * captured set lands after a later message was sent has its edits kept as
 * they land, a next_turn `stigmer.file_review.decided` event in the
 * session's log, the set staying on the run's record; the conversation's
 * newest turn leaves its set undecided; and a write that carries no
 * captured set closes nothing, because only a capture's write asks for
 * the newest turn.
 */
import { create } from "@bufbuild/protobuf";
import type { MessageInitShape } from "@bufbuild/protobuf";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { RunSchema } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import type {
  Run,
  RunStatusSchema,
} from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import { RunPhase } from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";
import { RunUpdateStatusInputSchema } from "@stigmer/apis/ai/stigmer/agentic/run/v1/io_pb";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { createLogger } from "../../../boot/logger.js";
import { testCallerIdentity } from "../../../pipeline/__tests__/support.js";
import { newPermissiveSingleTeamAuthorizer } from "../../../pipeline/steps/authorize.js";
import { tempStore } from "../../../store/sqlite/__tests__/support.js";
import type { TempStore } from "../../../store/sqlite/__tests__/support.js";
import { SessionEventBroker } from "../../session/events/broker.js";
import { eventOf } from "../../session/events/codec.js";
import { createRunAppendingEvents } from "../../session/events/run-writes.js";
import { updateStatus } from "../update-status.js";
import type { UpdateStatusDeps } from "../update-status.js";
import { fileReviewSeed } from "./file-review-seed.js";

const silentLogger = createLogger({
  level: "error",
  pretty: false,
  write: () => {},
});
const SESSION = "ses_late";

let temp: TempStore;
let deps: UpdateStatusDeps;

beforeEach(() => {
  temp = tempStore();
  deps = {
    store: temp.store,
    logger: silentLogger,
    authorizer: newPermissiveSingleTeamAuthorizer(),
    sessionEventBroker: new SessionEventBroker(silentLogger),
    statusObservers: [],
    responseDecorators: [],
  };
});

afterEach(async () => {
  await temp.cleanup();
});

function turn(id: string): Run {
  return create(RunSchema, {
    metadata: { id, org: "acme" },
    spec: {
      target: { case: "sessionId", value: SESSION },
      message: `message of ${id}`,
    },
    status: { phase: RunPhase.RUN_IN_PROGRESS },
  });
}

/** The runner's write for `runId`: its turn completed, with or without its captured change set. */
async function runnerWrites(
  runId: string,
  withCandidate: boolean,
): Promise<void> {
  const status: MessageInitShape<typeof RunStatusSchema> = withCandidate
    ? {
        ...fileReviewSeed(runId, `${runId}:0`).status,
        phase: RunPhase.RUN_COMPLETED,
      }
    : { phase: RunPhase.RUN_COMPLETED };
  await updateStatus(
    deps,
    create(RunUpdateStatusInputSchema, { runId, status }),
    testCallerIdentity(),
  );
}

async function storedSet(runId: string) {
  const run = await temp.store.getResource(
    ApiResourceKind.run,
    runId,
    RunSchema,
  );
  return run.status?.fileChanges[0];
}

/** The decided events in the session's log: run and origin. */
async function decided(): Promise<Array<[string, string]>> {
  const records = await temp.store.sessionEvents.list(SESSION, {
    order: "asc",
    types: ["stigmer.file_review.decided"],
    limit: 10,
  });
  return records.map(eventOf).map((event) => [
    event.runId,
    event.event.case === "stigmerFileReviewDecided" ? event.event.value.origin : "",
  ]);
}

describe("a turn that captures after a later message was sent", () => {
  it("is kept as it lands, origin next turn, with its decided event in the session's log", async () => {
    await createRunAppendingEvents(deps, turn("run_a"));
    await createRunAppendingEvents(deps, turn("run_b"));

    await runnerWrites("run_a", true);

    expect((await storedSet("run_a"))?.id).toBe("run_a:0");
    expect(await decided()).toEqual([["run_a", "next_turn"]]);
  });

  it("the conversation's newest turn leaves its set undecided", async () => {
    await createRunAppendingEvents(deps, turn("run_a"));

    await runnerWrites("run_a", true);

    expect((await storedSet("run_a"))?.id).toBe("run_a:0");
    expect(await decided()).toEqual([]);
  });

  it("a write that carries no captured set closes nothing, even on an outdated turn", async () => {
    await createRunAppendingEvents(deps, turn("run_a"));
    await runnerWrites("run_a", true);
    await createRunAppendingEvents(deps, turn("run_b"));

    await runnerWrites("run_a", false);

    expect((await storedSet("run_a"))?.id).toBe("run_a:0");
    expect(await decided()).toEqual([]);
  });

  it("a capture written again on the outdated turn adds nothing: the log shows it kept", async () => {
    await createRunAppendingEvents(deps, turn("run_a"));
    await createRunAppendingEvents(deps, turn("run_b"));
    await runnerWrites("run_a", true);

    await runnerWrites("run_a", true);

    expect(await decided()).toEqual([["run_a", "next_turn"]]);
  });
});
