/**
 * Pins the driver-neutral half of the workflow instance kind's removal
 * (../workflow-instance-retired.ts) over rows built the way an earlier
 * release wrote them (retired-workflow-instance-rows.ts):
 *   - a retired instance row names its workflow by spec.workflow_id, and a
 *     row with no spec, or an empty one, names none;
 *   - a run that names no workflow takes its surviving instance's
 *     workflow, dropping both retired fields and keeping every other field
 *     it carried, the version it pinned included;
 *   - a run that names its workflow keeps it, whatever its instance names;
 *   - a run whose instance is gone, or names no workflow, keeps its row
 *     with the retired fields dropped and no workflow;
 *   - a run that carries only the callback token loses it;
 *   - a run that never carried either field is left alone;
 *   - a grant naming an instance as resource or principal is found, and a
 *     grant on another kind is not;
 *   - bytes that do not decode throw (the step must not pass over them).
 */
import { fromBinary } from "@bufbuild/protobuf";
import { BinaryWriter, WireType } from "@bufbuild/protobuf/wire";
import { describe, expect, it } from "vitest";

import { WorkflowRunSchema } from "@stigmer/protos/ai/stigmer/agentic/workflowrun/v1/api_pb";

import {
  migrateWorkflowExecutionRow,
  policyNamesRetiredWorkflowInstance,
  unreadableWorkflowRowError,
  workflowInstanceWorkflowIdOf,
} from "../workflow-instance-retired.js";
import { policyRow } from "./retired-instance-rows.js";
import {
  retiredWorkflowExecutionRow,
  retiredWorkflowInstanceRow,
  workflowExecutionBytes,
} from "./retired-workflow-instance-rows.js";

const ORG = "org_01jz0000000000000000000000";
const PIN = "c".repeat(64);
const SPEC = {
  triggerMessage: "nightly",
  triggerMetadata: { source: "cli" },
};
const TOKEN = new Uint8Array([0x01, 0x02, 0x03]);
const metadata = (id: string) => ({ id, org: ORG, slug: id });

function workflows(
  byInstance: Record<string, string>,
): (instanceId: string) => string | undefined {
  return (instanceId) => byInstance[instanceId];
}

describe("workflowInstanceWorkflowIdOf", () => {
  it("reads the workflow a retired instance row names", () => {
    const row = retiredWorkflowInstanceRow({
      metadata: { id: "win_1", org: ORG, slug: "nightly-default" },
      workflowId: "wfl_1",
      description: "Default instance",
      environmentRefs: [{ org: ORG, slug: "prod", kind: 53 }],
      executionVisibility: 2,
    });
    expect(workflowInstanceWorkflowIdOf(row)).toBe("wfl_1");
  });

  it("names no workflow for an instance with an empty spec or none", () => {
    expect(
      workflowInstanceWorkflowIdOf(
        retiredWorkflowInstanceRow({
          metadata: metadata("win_2"),
          workflowId: "",
        }),
      ),
    ).toBe("");
    const specless = new BinaryWriter()
      .tag(2, WireType.LengthDelimited)
      .string("WorkflowInstance")
      .finish();
    expect(workflowInstanceWorkflowIdOf(specless)).toBe("");
  });

  it("throws on bytes that do not decode", () => {
    expect(() =>
      workflowInstanceWorkflowIdOf(new Uint8Array([0x22, 0xff])),
    ).toThrow();
  });
});

describe("migrateWorkflowExecutionRow", () => {
  it("names the surviving instance's workflow and drops both retired fields", () => {
    const row = retiredWorkflowExecutionRow({
      metadata: metadata("wex_1"),
      instanceId: "win_1",
      callbackToken: TOKEN,
      spec: SPEC,
      status: { workflowVersionHash: PIN, temporalWorkflowId: "wf-run-1" },
    });
    const migrated = migrateWorkflowExecutionRow(
      row,
      workflows({ win_1: "wfl_1" }),
    );
    expect(migrated?.workflowIdFilled).toBe(true);
    expect(migrated?.data).toEqual(
      workflowExecutionBytes({
        metadata: metadata("wex_1"),
        spec: { ...SPEC, workflowId: "wfl_1" },
        status: { workflowVersionHash: PIN, temporalWorkflowId: "wf-run-1" },
      }),
    );
    expect(
      fromBinary(WorkflowRunSchema, migrated!.data).spec?.$unknown,
    ).toBeUndefined();
  });

  it("keeps the workflow a run already names", () => {
    const migrated = migrateWorkflowExecutionRow(
      retiredWorkflowExecutionRow({
        metadata: metadata("wex_both"),
        instanceId: "win_1",
        spec: { ...SPEC, workflowId: "wfl_own" },
      }),
      workflows({ win_1: "wfl_other" }),
    );
    expect(migrated).toEqual({
      data: workflowExecutionBytes({
        metadata: metadata("wex_both"),
        spec: { ...SPEC, workflowId: "wfl_own" },
      }),
      workflowIdFilled: false,
    });
  });

  it.each<{ case: string; byInstance: Record<string, string> }>([
    { case: "the instance is gone", byInstance: {} },
    { case: "the instance names no workflow", byInstance: { win_gone: "" } },
  ])("keeps a run's history with no workflow when $case", ({ byInstance }) => {
    const migrated = migrateWorkflowExecutionRow(
      retiredWorkflowExecutionRow({
        metadata: metadata("wex_orphan"),
        instanceId: "win_gone",
        callbackToken: TOKEN,
        spec: SPEC,
        status: { workflowVersionHash: PIN },
      }),
      workflows(byInstance),
    );
    expect(migrated).toEqual({
      data: workflowExecutionBytes({
        metadata: metadata("wex_orphan"),
        spec: SPEC,
        status: { workflowVersionHash: PIN },
      }),
      workflowIdFilled: false,
    });
  });

  it("drops a callback token a run carries without an instance", () => {
    const migrated = migrateWorkflowExecutionRow(
      retiredWorkflowExecutionRow({
        metadata: metadata("wex_token"),
        instanceId: "",
        callbackToken: TOKEN,
        spec: { ...SPEC, workflowId: "wfl_1" },
      }),
      workflows({}),
    );
    expect(migrated).toEqual({
      data: workflowExecutionBytes({
        metadata: metadata("wex_token"),
        spec: { ...SPEC, workflowId: "wfl_1" },
      }),
      workflowIdFilled: false,
    });
  });

  it("keeps an unknown spec field it does not retire", () => {
    const spec = new BinaryWriter()
      .tag(1, WireType.LengthDelimited)
      .string("win_1")
      .tag(40, WireType.Varint)
      .int32(7)
      .finish();
    const row = new BinaryWriter()
      .tag(4, WireType.LengthDelimited)
      .bytes(spec)
      .finish();
    const migrated = migrateWorkflowExecutionRow(
      row,
      workflows({ win_1: "wfl_1" }),
    );
    const unknown = fromBinary(WorkflowRunSchema, migrated!.data).spec
      ?.$unknown;
    expect(unknown?.map((f) => f.no)).toEqual([40]);
  });

  it("leaves a run that carries neither retired field alone", () => {
    const row = workflowExecutionBytes({
      metadata: metadata("wex_current"),
      spec: { ...SPEC, workflowId: "wfl_1" },
    });
    expect(migrateWorkflowExecutionRow(row, workflows({}))).toBeUndefined();
    expect(
      migrateWorkflowExecutionRow(
        workflowExecutionBytes({ metadata: metadata("wex_specless") }),
        workflows({}),
      ),
    ).toBeUndefined();
  });

  it("throws on bytes that do not decode", () => {
    expect(() =>
      migrateWorkflowExecutionRow(new Uint8Array([0x22, 0xff]), workflows({})),
    ).toThrow();
  });
});

describe("policyNamesRetiredWorkflowInstance", () => {
  it.each([
    {
      principal: "identity_account:ida_1",
      resource: "workflow_instance:win_1",
      named: true,
    },
    {
      principal: "workflow_instance:win_1",
      resource: "workflow_execution:wex_1",
      named: true,
    },
    {
      principal: "identity_account:ida_1",
      resource: "workflow:wfl_1",
      named: false,
    },
    {
      principal: "identity_account:ida_1",
      resource: "agent_instance:ain_1",
      named: false,
    },
  ])("$principal -> $resource: $named", ({ principal, resource, named }) => {
    expect(
      policyNamesRetiredWorkflowInstance(
        policyRow({ id: "iam_1", principal, relation: "viewer", resource }),
      ),
    ).toBe(named);
  });

  it("throws on bytes that do not decode", () => {
    expect(() =>
      policyNamesRetiredWorkflowInstance(new Uint8Array([0x22, 0xff])),
    ).toThrow();
  });
});

describe("unreadableWorkflowRowError", () => {
  it("names the row and keeps the cause", () => {
    const cause = new Error("premature EOF");
    const error = unreadableWorkflowRowError(
      "workflow_execution",
      "wex_1",
      cause,
    );
    expect(error.message).toBe(
      "workflow_execution 'wex_1' cannot be read to retire the workflow instance kind: Error: premature EOF",
    );
    expect(error.cause).toBe(cause);
  });
});
