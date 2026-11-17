/**
 * Pins the run list index's `working` key (list-index.ts): a run holds it,
 * with the one value `Run`, exactly while it is pending or in progress,
 * whatever its session (none included), so the stalled-run checker reads
 * every working run on the server and nothing else (stalled-runs.ts).
 */
import { create } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";

import { RunSchema } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import { RunPhase } from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";

import { listIndexFactsOf } from "../../../store/list-index.js";
import { agentExecutionListIndex } from "../list-index.js";

function workingValue(
  phase: RunPhase,
  sessionId = "ses_1",
): string | undefined {
  const run = create(RunSchema, {
    kind: "Run",
    spec: {
      target:
        sessionId === ""
          ? { case: undefined }
          : { case: "sessionId", value: sessionId },
    },
    status: { phase },
  });
  return listIndexFactsOf(agentExecutionListIndex, run).keys.find(
    (key) => key.key === "working",
  )?.value;
}

describe("the run list index's working key", () => {
  it("is held as `Run` while the run is pending or in progress, in a session or none", () => {
    expect(workingValue(RunPhase.RUN_PENDING)).toBe("Run");
    expect(workingValue(RunPhase.RUN_IN_PROGRESS)).toBe("Run");
    expect(workingValue(RunPhase.RUN_IN_PROGRESS, "")).toBe("Run");
  });

  it("is not held while the run waits, is paused or has ended", () => {
    for (const phase of [
      RunPhase.RUN_WAITING_FOR_APPROVAL,
      RunPhase.RUN_PAUSED,
      RunPhase.RUN_COMPLETED,
      RunPhase.RUN_FAILED,
      RunPhase.RUN_CANCELLED,
      RunPhase.RUN_TERMINATED,
      RunPhase.RUN_PHASE_UNSPECIFIED,
    ]) {
      expect([RunPhase[phase], workingValue(phase)]).toEqual([
        RunPhase[phase],
        undefined,
      ]);
    }
  });
});
