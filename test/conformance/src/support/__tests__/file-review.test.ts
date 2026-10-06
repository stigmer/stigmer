// Unit arms for the file-review decision helpers. What they pin: a decision
// is correlated by the change's or the set's id and bound to the digest the
// reviewer saw (the change's file_digest at FILE scope, the set's
// aggregate_digest at CHANGE_SET scope) unless the arm overrides it; a path
// the set does not hold is red at the helper, naming the paths it does hold,
// before anything is submitted.
// Pure: a hand-built change set and a stubbed command client, no target.
// Domain: conformance support (execution engine).
import { create } from "@bufbuild/protobuf";
import { AgentRunSchema } from "@stigmer/protos/ai/stigmer/agentic/agentrun/v1/api_pb";
import { FileDecisionAction, FileDecisionScope } from "@stigmer/protos/ai/stigmer/agentic/agentrun/v1/enum_pb";
import { FileChangeSetSchema } from "@stigmer/protos/ai/stigmer/agentic/agentrun/v1/filereview_pb";
import { describe, expect, it, vi } from "vitest";
import type { ConformanceClients } from "../../harness/clients";
import { submitChangeSetDecision, submitFileDecisionByPath } from "../file-review";

const SET = create(FileChangeSetSchema, {
  id: "fcs_unit",
  aggregateDigest: "sha256:set",
  changes: [
    { id: "fc_added", pathAfter: "src/new.ts", fileDigest: "sha256:new" },
    { id: "fc_deleted", pathBefore: "src/old.ts", fileDigest: "sha256:old" },
  ],
});

function commandClient() {
  const answer = create(AgentRunSchema, { metadata: { id: "aex_unit" } });
  const submitFileDecision = vi.fn(async () => answer);
  const clients = { agentExecutionCommand: { submitFileDecision } } as unknown as ConformanceClients;
  return { clients, submitFileDecision, answer };
}

describe("submitFileDecisionByPath", () => {
  it("decides the change at that path by its id, bound to its file digest, and returns the response", async () => {
    const c = commandClient();
    const response = await submitFileDecisionByPath(c.clients, "aex_unit", SET, "src/old.ts", FileDecisionAction.REJECT);
    expect(response).toBe(c.answer);
    expect(c.submitFileDecision).toHaveBeenCalledWith({
      agentRunId: "aex_unit",
      changeSetId: "fcs_unit",
      scope: FileDecisionScope.FILE,
      fileChangeId: "fc_deleted",
      action: FileDecisionAction.REJECT,
      expectedDigest: "sha256:old",
      acknowledgeUnreviewable: false,
      reason: "",
    });
  });

  it("carries the digest, acknowledgement and reason an arm overrides", async () => {
    const c = commandClient();
    await submitFileDecisionByPath(c.clients, "aex_unit", SET, "src/new.ts", FileDecisionAction.APPROVE, {
      expectedDigest: "sha256:stale",
      acknowledgeUnreviewable: true,
      reason: "binary kept",
    });
    expect(c.submitFileDecision).toHaveBeenCalledWith(
      expect.objectContaining({
        fileChangeId: "fc_added",
        expectedDigest: "sha256:stale",
        acknowledgeUnreviewable: true,
        reason: "binary kept",
      }),
    );
  });

  it("is red naming the set's paths when the path is not in it, and submits nothing", () => {
    const c = commandClient();
    expect(() =>
      submitFileDecisionByPath(c.clients, "aex_unit", SET, "src/missing.ts", FileDecisionAction.APPROVE),
    ).toThrow('change set fcs_unit has no change for src/missing.ts (paths: ["src/new.ts","src/old.ts"])');
    expect(c.submitFileDecision).not.toHaveBeenCalled();
  });
});

describe("submitChangeSetDecision", () => {
  it("decides the whole set by its id, bound to its aggregate digest", async () => {
    const c = commandClient();
    const response = await submitChangeSetDecision(c.clients, "aex_unit", SET, FileDecisionAction.APPROVE);
    expect(response).toBe(c.answer);
    expect(c.submitFileDecision).toHaveBeenCalledWith({
      agentRunId: "aex_unit",
      changeSetId: "fcs_unit",
      scope: FileDecisionScope.CHANGE_SET,
      action: FileDecisionAction.APPROVE,
      expectedDigest: "sha256:set",
      acknowledgeUnreviewable: false,
      reason: "",
    });
  });

  it("carries an overridden digest and reason", async () => {
    const c = commandClient();
    await submitChangeSetDecision(c.clients, "aex_unit", SET, FileDecisionAction.REJECT, {
      expectedDigest: "sha256:stale",
      reason: "not this",
    });
    expect(c.submitFileDecision).toHaveBeenCalledWith(
      expect.objectContaining({ expectedDigest: "sha256:stale", reason: "not this", scope: FileDecisionScope.CHANGE_SET }),
    );
  });
});
