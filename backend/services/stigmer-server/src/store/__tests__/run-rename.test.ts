/**
 * Pins the driver-neutral half of the rename of executions to runs
 * (../run-rename.ts) over rows built the way the release before it wrote
 * them (run-rename-rows.ts):
 *   - an agent run's kind string reads as the contract's const after the
 *     rewrite, so a fetched run passes its own validation on the way back,
 *     and a run already current is left alone;
 *   - a grant naming a run kind as resource or principal is re-keyed to the
 *     id its renamed triple derives, and a grant on another kind is not;
 *   - bytes that do not decode throw (the step must not pass over them).
 */
import { create, fromBinary, toBinary } from "@bufbuild/protobuf";
import { createValidator } from "@bufbuild/protovalidate";
import { describe, expect, it } from "vitest";

import { RunSchema } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import { IamPolicySchema } from "@stigmer/protos/ai/stigmer/iam/iampolicy/v1/api_pb";

import { policyIdFor } from "../../domain/iampolicy/constants.js";
import { rekeyedRunPolicy, renamedAgentRunRow } from "../run-rename.js";
import { policyRow } from "./retired-instance-rows.js";
import { NEW_RUN_NAMES, OLD_RUN_NAMES, agentRunBytes } from "./run-rename-rows.js";

describe("renamedAgentRunRow", () => {
  it("rewrites the kind string, and the fetched run then passes its own validation", () => {
    const migrated = renamedAgentRunRow(agentRunBytes("aex_1", "ses_1", OLD_RUN_NAMES));
    expect(migrated).toEqual(agentRunBytes("aex_1", "ses_1", NEW_RUN_NAMES));
    const run = fromBinary(RunSchema, migrated!);
    const kindViolations = createValidator()
      .validate(RunSchema, run)
      .violations?.filter((v) => v.toString().startsWith("kind:"));
    expect(kindViolations ?? []).toEqual([]);
  });

  it("leaves a run that already reads current alone", () => {
    expect(renamedAgentRunRow(agentRunBytes("aex_1", "ses_1", NEW_RUN_NAMES))).toBeUndefined();
  });

  it("throws on bytes that do not decode", () => {
    expect(() => renamedAgentRunRow(new Uint8Array([0x22, 0xff]))).toThrow();
  });
});

describe("rekeyedRunPolicy", () => {
  it("re-keys a grant on a run to the id its renamed triple derives", () => {
    const rekeyed = rekeyedRunPolicy(
      policyRow({
        id: "iamp_old",
        principal: "identity_account:ida_1",
        relation: "viewer",
        resource: "agent_execution:aex_1",
      }),
    );
    expect(rekeyed).toBeDefined();
    const migrated = fromBinary(IamPolicySchema, rekeyed!.data);
    expect(migrated.spec?.resource).toMatchObject({ kind: "agent_run", id: "aex_1" });
    expect(rekeyed!.id).toBe(policyIdFor(migrated.spec!));
    expect(migrated.metadata?.id).toBe(rekeyed!.id);
    expect(rekeyed!.id).not.toBe("iamp_old");
  });

  it("re-keys a grant whose principal is a run", () => {
    const rekeyed = rekeyedRunPolicy(
      policyRow({
        id: "iamp_old",
        principal: "agent_execution:aex_1",
        relation: "viewer",
        resource: "session:ses_1",
      }),
    );
    expect(fromBinary(IamPolicySchema, rekeyed!.data).spec?.principal?.kind).toBe("agent_run");
  });

  it("leaves a grant with no spec alone", () => {
    expect(
      rekeyedRunPolicy(toBinary(IamPolicySchema, create(IamPolicySchema, { metadata: { id: "iamp_bare" } }))),
    ).toBeUndefined();
  });

  it("leaves a grant on another kind alone", () => {
    expect(
      rekeyedRunPolicy(
        policyRow({
          id: "iamp_agent",
          principal: "identity_account:ida_1",
          relation: "viewer",
          resource: "agent:agt_1",
        }),
      ),
    ).toBeUndefined();
  });
});
