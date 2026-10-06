/**
 * Pins the driver-neutral half of the removal of workflows, workflow runs
 * and the artifact kind (../workflow-retired.ts) over rows built the way an
 * earlier release wrote them (retired-workflow-rows.ts):
 *   - the retired kinds are the workflow, the workflow run under both names
 *     it was stored under, and the artifact, and the dropped tables are the
 *     two only workflows wrote;
 *   - an agent run a workflow step started loses its retired parent, its
 *     retired task token and the two lineage labels, keeping every other
 *     field and label; each is dropped alone too;
 *   - an unknown field the step does not retire is kept;
 *   - an agent run that carries none of them is left alone;
 *   - a grant naming a retired kind as resource or principal is found, and
 *     a grant on another kind is not;
 *   - bytes that do not decode throw (the step must not pass over them).
 */
import { fromBinary, toBinary } from "@bufbuild/protobuf";
import { BinaryWriter, WireType } from "@bufbuild/protobuf/wire";
import { describe, expect, it } from "vitest";

import { AgentRunSchema } from "@stigmer/protos/ai/stigmer/agentic/agentrun/v1/api_pb";

import {
  RETIRED_WORKFLOW_KINDS,
  RETIRED_WORKFLOW_TABLES,
  migrateAgentRunRow,
  policyNamesRetiredWorkflowKind,
  unreadableRetiredWorkflowRowError,
} from "../workflow-retired.js";
import { policyRow } from "./retired-instance-rows.js";
import { WORKFLOW_LINEAGE_LABELS, agentRunRow } from "./retired-workflow-rows.js";

const ORG = "org_01jz0000000000000000000000";
const TOKEN = new Uint8Array([0x01, 0x02, 0x03]);
const OWN_LABELS = { "stigmer.ai/schedule-id": "sch_1", team: "support" };

describe("the retired kinds and tables", () => {
  it("are the workflow, the workflow run under both names, the artifact, and the two workflow-only tables", () => {
    expect(RETIRED_WORKFLOW_KINDS).toEqual([
      "workflow",
      "workflow_execution",
      "workflow_run",
      "artifact",
    ]);
    expect(RETIRED_WORKFLOW_TABLES).toEqual([
      "workflow_execution_events",
      "signal_dedupe",
    ]);
  });
});

describe("migrateAgentRunRow", () => {
  it("drops the parent, the task token and the lineage labels, keeping every other field and label", () => {
    const migrated = migrateAgentRunRow(
      agentRunRow({
        id: "aex_child",
        org: ORG,
        sessionId: "ses_1",
        labels: { ...OWN_LABELS, ...WORKFLOW_LINEAGE_LABELS },
        parent: "wex_parent",
        callbackToken: TOKEN,
      }),
    );
    expect(migrated).toEqual(
      agentRunRow({
        id: "aex_child",
        org: ORG,
        sessionId: "ses_1",
        labels: OWN_LABELS,
      }),
    );
    const run = fromBinary(AgentRunSchema, migrated!);
    expect(run.spec?.$unknown).toBeUndefined();
    expect(run.status?.$unknown).toBeUndefined();
    expect(run.status?.todos["t1"]?.content).toBe("read the ticket");
  });

  it.each([
    { case: "only a parent", parent: "wex_parent" },
    { case: "only a task token", callbackToken: TOKEN },
    { case: "only the lineage labels", labels: WORKFLOW_LINEAGE_LABELS },
  ])("drops $case", (retired) => {
    expect(
      migrateAgentRunRow(
        agentRunRow({ id: "aex_1", org: ORG, sessionId: "ses_1", ...retired }),
      ),
    ).toEqual(agentRunRow({ id: "aex_1", org: ORG, sessionId: "ses_1" }));
  });

  it("keeps an unknown field it does not retire", () => {
    const run = fromBinary(
      AgentRunSchema,
      agentRunRow({ id: "aex_1", org: ORG, sessionId: "ses_1", parent: "wex_1" }),
    );
    run.spec!.$unknown = [
      ...(run.spec!.$unknown ?? []),
      {
        no: 40,
        wireType: WireType.Varint,
        data: new BinaryWriter().int32(7).finish(),
      },
    ];
    const migrated = migrateAgentRunRow(toBinary(AgentRunSchema, run));
    expect(
      fromBinary(AgentRunSchema, migrated!).spec?.$unknown?.map((f) => f.no),
    ).toEqual([40]);
  });

  it("leaves an agent run that carries nothing a workflow left alone", () => {
    expect(
      migrateAgentRunRow(
        agentRunRow({
          id: "aex_1",
          org: ORG,
          sessionId: "ses_1",
          labels: OWN_LABELS,
        }),
      ),
    ).toBeUndefined();
  });

  it("throws on bytes that do not decode", () => {
    expect(() => migrateAgentRunRow(new Uint8Array([0x22, 0xff]))).toThrow();
  });
});

describe("policyNamesRetiredWorkflowKind", () => {
  it.each([
    { principal: "identity_account:ida_1", resource: "workflow:wfl_1", named: true },
    {
      principal: "identity_account:ida_1",
      resource: "workflow_execution:wex_1",
      named: true,
    },
    { principal: "workflow_run:wex_1", resource: "agent_run:aex_1", named: true },
    { principal: "identity_account:ida_1", resource: "artifact:art_1", named: true },
    { principal: "identity_account:ida_1", resource: "agent:agt_1", named: false },
    { principal: "team:tm_1", resource: "agent_run:aex_1", named: false },
  ])("$principal -> $resource: $named", ({ principal, resource, named }) => {
    expect(
      policyNamesRetiredWorkflowKind(
        policyRow({ id: "iam_1", principal, relation: "viewer", resource }),
      ),
    ).toBe(named);
  });

  it("throws on bytes that do not decode", () => {
    expect(() =>
      policyNamesRetiredWorkflowKind(new Uint8Array([0x22, 0xff])),
    ).toThrow();
  });
});

describe("unreadableRetiredWorkflowRowError", () => {
  it("names the row and keeps the cause", () => {
    const cause = new Error("premature EOF");
    const error = unreadableRetiredWorkflowRowError("agent_run", "aex_1", cause);
    expect(error.message).toBe(
      "agent_run 'aex_1' cannot be read to retire the workflow kinds: Error: premature EOF",
    );
    expect(error.cause).toBe(cause);
  });
});
