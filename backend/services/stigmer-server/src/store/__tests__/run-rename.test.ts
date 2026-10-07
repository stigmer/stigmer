/**
 * Pins the driver-neutral half of the run kind's renames (../run-rename.ts)
 * over rows built the way each release before a rename wrote them
 * (run-rename-rows.ts), for both steps the module serves:
 *   - a run's kind string reads as the contract's name at the step's end
 *     after the rewrite, and a run already past the step is left alone;
 *   - at the last step, the fetched run passes the contract's own
 *     validation, so it can be sent back through `update`;
 *   - a grant naming the step's old kind as resource or principal is
 *     re-keyed to the id its renamed triple derives, keeping the run's id,
 *     and a grant on another kind is not;
 *   - bytes that do not decode throw (the step must not pass over them);
 *   - each step's names are frozen literals, so a later rename cannot
 *     change what an earlier step did.
 */
import { create, fromBinary, toBinary } from "@bufbuild/protobuf";
import { createValidator } from "@bufbuild/protovalidate";
import { describe, expect, it } from "vitest";

import { RunSchema } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import { IamPolicySchema } from "@stigmer/protos/ai/stigmer/iam/iampolicy/v1/api_pb";

import { policyIdFor } from "../../domain/iampolicy/constants.js";
import {
  RUN_RENAME_V18,
  RUN_RENAME_V20,
  rekeyedRunPolicy,
  renamedRunRow,
  unreadableRunRenameRowError,
} from "../run-rename.js";
import { policyRow } from "./retired-instance-rows.js";
import {
  AGENT_RUN_NAMES,
  EXECUTION_NAMES,
  RUN_NAMES,
  runBytes,
} from "./run-rename-rows.js";

describe("each step's names are frozen literals", () => {
  it("v18 renamed agent executions to agent runs, v20 agent runs to runs", () => {
    expect(RUN_RENAME_V18.kind).toEqual(["agent_execution", "agent_run"]);
    expect(RUN_RENAME_V18.kindString).toEqual(["AgentExecution", "AgentRun"]);
    expect(RUN_RENAME_V20.kind).toEqual(["agent_run", "run"]);
    expect(RUN_RENAME_V20.kindString).toEqual(["AgentRun", "Run"]);
  });
});

describe.each([
  { step: "v18", rename: RUN_RENAME_V18, before: EXECUTION_NAMES, after: AGENT_RUN_NAMES },
  { step: "v20", rename: RUN_RENAME_V20, before: AGENT_RUN_NAMES, after: RUN_NAMES },
])("$step", ({ rename, before, after }) => {
  const [fromKind, toKind] = rename.kind;

  describe("renamedRunRow", () => {
    it("rewrites the kind string and keeps the run's id", () => {
      const migrated = renamedRunRow(rename, runBytes("aex_1", "ses_1", before));
      expect(migrated).toEqual(runBytes("aex_1", "ses_1", after));
      expect(fromBinary(RunSchema, migrated!).metadata?.id).toBe("aex_1");
    });

    it("leaves a run already past the step alone", () => {
      expect(renamedRunRow(rename, runBytes("aex_1", "ses_1", after))).toBeUndefined();
    });

    it("throws on bytes that do not decode", () => {
      expect(() => renamedRunRow(rename, new Uint8Array([0x22, 0xff]))).toThrow();
    });
  });

  describe("rekeyedRunPolicy", () => {
    it("re-keys a grant on a run to the id its renamed triple derives", () => {
      const rekeyed = rekeyedRunPolicy(
        rename,
        policyRow({
          id: "iamp_old",
          principal: "identity_account:ida_1",
          relation: "viewer",
          resource: `${fromKind}:aex_1`,
        }),
      );
      expect(rekeyed).toBeDefined();
      const migrated = fromBinary(IamPolicySchema, rekeyed!.data);
      expect(migrated.spec?.resource).toMatchObject({ kind: toKind, id: "aex_1" });
      expect(rekeyed!.id).toBe(policyIdFor(migrated.spec!));
      expect(migrated.metadata?.id).toBe(rekeyed!.id);
      expect(rekeyed!.id).not.toBe("iamp_old");
    });

    it("re-keys a grant whose principal is a run", () => {
      const rekeyed = rekeyedRunPolicy(
        rename,
        policyRow({
          id: "iamp_old",
          principal: `${fromKind}:aex_1`,
          relation: "viewer",
          resource: "session:ses_1",
        }),
      );
      expect(fromBinary(IamPolicySchema, rekeyed!.data).spec?.principal?.kind).toBe(toKind);
    });

    it("leaves a grant with no spec alone", () => {
      expect(
        rekeyedRunPolicy(
          rename,
          toBinary(IamPolicySchema, create(IamPolicySchema, { metadata: { id: "iamp_bare" } })),
        ),
      ).toBeUndefined();
    });

    it("leaves a grant on another kind, or on the kind already renamed, alone", () => {
      for (const resource of ["agent:agt_1", `${toKind}:aex_1`]) {
        expect(
          rekeyedRunPolicy(
            rename,
            policyRow({ id: "iamp_other", principal: "identity_account:ida_1", relation: "viewer", resource }),
          ),
        ).toBeUndefined();
      }
    });
  });

  it("names the rename and the row in an unreadable row's failure", () => {
    const error = unreadableRunRenameRowError(rename, fromKind, "aex_bad", new Error("bad wire"));
    expect(error.message).toBe(`the ${fromKind} row aex_bad cannot be read for ${rename.label}: bad wire`);
  });
});

describe("after the last step", () => {
  it("a fetched run passes the contract's own validation, so it can be sent back through update", () => {
    const run = fromBinary(RunSchema, renamedRunRow(RUN_RENAME_V20, runBytes("aex_1", "ses_1", AGENT_RUN_NAMES))!);
    const kindViolations = createValidator()
      .validate(RunSchema, run)
      .violations?.filter((v) => v.toString().startsWith("kind:"));
    expect(kindViolations ?? []).toEqual([]);
  });
});
