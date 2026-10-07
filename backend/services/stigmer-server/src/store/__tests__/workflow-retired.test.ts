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
 *   - the link as every release through 3.41 wrote it (spec fields 6, 8
 *     and 11) is stripped like the later field 17;
 *   - an unfinished run a workflow step started (paused or with no status
 *     among them) ends FAILED with the error saying why, completed at the
 *     step's time; a finished one keeps its phase, and an unfinished run no
 *     workflow started is left alone;
 *   - an unknown field the step does not retire is kept;
 *   - an agent run that carries none of them is left alone;
 *   - a grant naming a retired kind as resource or principal is found, and
 *     a grant on another kind is not;
 *   - bytes that do not decode throw (the step must not pass over them).
 */
import { fromBinary, toBinary } from "@bufbuild/protobuf";
import { BinaryWriter, WireType } from "@bufbuild/protobuf/wire";
import { describe, expect, it } from "vitest";

import { RunSchema } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import { RunPhase } from "@stigmer/protos/ai/stigmer/agentic/run/v1/enum_pb";

import {
  RETIRED_WORKFLOW_KINDS,
  RETIRED_WORKFLOW_TABLES,
  WORKFLOW_CHILD_ENDED_ERROR,
  migrateAgentRunRow,
  policyNamesRetiredWorkflowKind,
  unreadableRetiredWorkflowRowError,
} from "../workflow-retired.js";
import { policyRow } from "./retired-instance-rows.js";
import { WORKFLOW_LINEAGE_LABELS, agentRunRow } from "./retired-workflow-rows.js";

const ORG = "org_01jz0000000000000000000000";
const TOKEN = new Uint8Array([0x01, 0x02, 0x03]);
const OWN_LABELS = { "stigmer.ai/schedule-id": "sch_1", team: "support" };
const ENDED_AT = "2026-10-07T12:00:00.000Z";

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
      ENDED_AT,
    );
    expect(migrated).toEqual(
      agentRunRow({
        id: "aex_child",
        org: ORG,
        sessionId: "ses_1",
        labels: OWN_LABELS,
      }),
    );
    const run = fromBinary(RunSchema, migrated!);
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
        ENDED_AT,
      ),
    ).toEqual(agentRunRow({ id: "aex_1", org: ORG, sessionId: "ses_1" }));
  });

  it("keeps an unknown field it does not retire", () => {
    const run = fromBinary(
      RunSchema,
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
    const migrated = migrateAgentRunRow(toBinary(RunSchema, run), ENDED_AT);
    expect(
      fromBinary(RunSchema, migrated!).spec?.$unknown?.map((f) => f.no),
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
        ENDED_AT,
      ),
    ).toBeUndefined();
  });

  it.each([RunPhase.RUN_PENDING, RunPhase.RUN_IN_PROGRESS, RunPhase.RUN_WAITING_FOR_APPROVAL, RunPhase.RUN_PAUSED, RunPhase.RUN_PHASE_UNSPECIFIED])(
    "ends an unfinished run a workflow step started (phase %s) FAILED, saying why, at the step's time",
    (phase) => {
      expect(
        migrateAgentRunRow(
          agentRunRow({ id: "aex_child", org: ORG, sessionId: "ses_1", parent: "wex_parent", phase }),
          ENDED_AT,
        ),
      ).toEqual(
        agentRunRow({
          id: "aex_child",
          org: ORG,
          sessionId: "ses_1",
          phase: RunPhase.RUN_FAILED,
          error: WORKFLOW_CHILD_ENDED_ERROR,
          completedAt: ENDED_AT,
        }),
      );
    },
  );

  it("strips the link every release through 3.41 wrote (spec fields 6, 8 and 11) and ends the run it marks, as for the later field", () => {
    const released = {
      callbackToken: TOKEN,
      parentWorkflowId: "wfx_parent",
      activityTaskQueue: "wfexec:wfx_parent",
    };
    expect(
      migrateAgentRunRow(
        agentRunRow({
          id: "aex_child",
          org: ORG,
          sessionId: "ses_1",
          labels: { ...OWN_LABELS, ...WORKFLOW_LINEAGE_LABELS },
          released,
          callbackToken: TOKEN,
          phase: RunPhase.RUN_IN_PROGRESS,
        }),
        ENDED_AT,
      ),
    ).toEqual(
      agentRunRow({
        id: "aex_child",
        org: ORG,
        sessionId: "ses_1",
        labels: OWN_LABELS,
        phase: RunPhase.RUN_FAILED,
        error: WORKFLOW_CHILD_ENDED_ERROR,
        completedAt: ENDED_AT,
      }),
    );
    expect(
      migrateAgentRunRow(
        agentRunRow({ id: "aex_done", org: ORG, sessionId: "ses_1", released }),
        ENDED_AT,
      ),
      "a finished one keeps its phase and loses only the link",
    ).toEqual(agentRunRow({ id: "aex_done", org: ORG, sessionId: "ses_1" }));
  });

  it("gives a run a workflow step started that has no status one that ends it", () => {
    const migrated = fromBinary(
      RunSchema,
      migrateAgentRunRow(
        agentRunRow({ id: "aex_child", org: ORG, sessionId: "ses_1", parent: "wex_parent", noStatus: true }),
        ENDED_AT,
      )!,
    );
    expect(migrated.status?.phase).toBe(RunPhase.RUN_FAILED);
    expect(migrated.status?.error).toBe(WORKFLOW_CHILD_ENDED_ERROR);
    expect(migrated.status?.completedAt).toBe(ENDED_AT);
    expect(migrated.spec?.$unknown).toBeUndefined();
  });

  it("keeps the phase of a finished run a workflow step started, and never ends a run no workflow started", () => {
    expect(
      migrateAgentRunRow(
        agentRunRow({ id: "aex_child", org: ORG, sessionId: "ses_1", parent: "wex_parent", phase: RunPhase.RUN_CANCELLED }),
        ENDED_AT,
      ),
    ).toEqual(agentRunRow({ id: "aex_child", org: ORG, sessionId: "ses_1", phase: RunPhase.RUN_CANCELLED }));
    expect(
      migrateAgentRunRow(
        agentRunRow({ id: "aex_1", org: ORG, sessionId: "ses_1", phase: RunPhase.RUN_IN_PROGRESS }),
        ENDED_AT,
      ),
    ).toBeUndefined();
  });

  it("throws on bytes that do not decode", () => {
    expect(() => migrateAgentRunRow(new Uint8Array([0x22, 0xff]), ENDED_AT)).toThrow();
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
