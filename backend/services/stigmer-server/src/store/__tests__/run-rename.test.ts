/**
 * Pins the driver-neutral half of the rename of executions to runs
 * (../run-rename.ts) over rows built the way the release before it wrote
 * them (run-rename-rows.ts):
 *   - an agent run's and a workflow run's kind string read as the
 *     contract's const after the rewrite, so a fetched run passes its own
 *     validation on the way back, and a run already current is left alone;
 *   - a workflow run's task metadata and agent_call output name the child
 *     run by the new key, every other key and value kept;
 *   - a grant naming a run kind as resource or principal is re-keyed to the
 *     id its renamed triple derives, and a grant on another kind is not;
 *   - a workflow's emit_event signal target and its expressions name runs
 *     by the new keys, nested steps included, its YAML regenerated from the
 *     rewritten spec and its version hash untouched; a free-form string is
 *     never rewritten; a workflow already current is left alone;
 *   - bytes that do not decode throw (the step must not pass over them).
 */
import { create, fromBinary, toBinary } from "@bufbuild/protobuf";
import { createValidator } from "@bufbuild/protovalidate";
import { describe, expect, it } from "vitest";

import { AgentRunSchema } from "@stigmer/protos/ai/stigmer/agentic/agentrun/v1/api_pb";
import { WorkflowSchema } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/api_pb";
import { WorkflowRunSchema } from "@stigmer/protos/ai/stigmer/agentic/workflowrun/v1/api_pb";
import { IamPolicySchema } from "@stigmer/protos/ai/stigmer/iam/iampolicy/v1/api_pb";

import { policyIdFor } from "../../domain/iampolicy/constants.js";
import { protoToYaml } from "../../domain/workflow/converter/converter.js";
import {
  rekeyedRunPolicy,
  renamedAgentRunRow,
  renamedWorkflowRow,
  renamedWorkflowRunRow,
} from "../run-rename.js";
import { policyRow } from "./retired-instance-rows.js";
import {
  NEW_RUN_NAMES,
  OLD_RUN_NAMES,
  RUN_RENAME_HASH,
  agentRunBytes,
  workflowRunBytes,
  workflowWithSteps,
} from "./run-rename-rows.js";

describe("renamedAgentRunRow", () => {
  it("rewrites the kind string, and the fetched run then passes its own validation", () => {
    const migrated = renamedAgentRunRow(agentRunBytes("aex_1", "ses_1", OLD_RUN_NAMES));
    expect(migrated).toEqual(agentRunBytes("aex_1", "ses_1", NEW_RUN_NAMES));
    const run = fromBinary(AgentRunSchema, migrated!);
    const kindViolations = createValidator()
      .validate(AgentRunSchema, run)
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

describe("renamedWorkflowRunRow", () => {
  it("rewrites the kind string and the child run key in task metadata and outputs", () => {
    const migrated = renamedWorkflowRunRow(workflowRunBytes("wex_1", "wfl_1", OLD_RUN_NAMES));
    expect(migrated).toEqual(workflowRunBytes("wex_1", "wfl_1", NEW_RUN_NAMES));
    const run = fromBinary(WorkflowRunSchema, migrated!);
    expect(run.status?.workflowVersionHash).toBe(RUN_RENAME_HASH);
    expect(Object.keys(run.status?.tasks[0]?.metadata ?? {})).toEqual([
      "agent_run_id",
      "token_attribution",
    ]);
  });

  it("leaves a run that already reads current alone", () => {
    expect(
      renamedWorkflowRunRow(workflowRunBytes("wex_1", "wfl_1", NEW_RUN_NAMES)),
    ).toBeUndefined();
  });

  it("throws on bytes that do not decode", () => {
    expect(() => renamedWorkflowRunRow(new Uint8Array([0x22, 0xff]))).toThrow();
  });
});

describe("rekeyedRunPolicy", () => {
  it("re-keys a grant on a run to the id its renamed triple derives", () => {
    const rekeyed = rekeyedRunPolicy(
      policyRow({
        id: "iamp_old",
        principal: "identity_account:ida_1",
        relation: "viewer",
        resource: "workflow_execution:wex_1",
      }),
    );
    expect(rekeyed).toBeDefined();
    const migrated = fromBinary(IamPolicySchema, rekeyed!.data);
    expect(migrated.spec?.resource).toMatchObject({ kind: "workflow_run", id: "wex_1" });
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
          id: "iamp_wf",
          principal: "identity_account:ida_1",
          relation: "viewer",
          resource: "workflow:wfl_1",
        }),
      ),
    ).toBeUndefined();
  });
});

describe("renamedWorkflowRow", () => {
  it("names runs by the new keys in every step, regenerates the YAML and keeps the version hash", () => {
    const migrated = fromBinary(
      WorkflowSchema,
      renamedWorkflowRow(toBinary(WorkflowSchema, workflowWithSteps("wfl_1", OLD_RUN_NAMES)))!,
    );
    const expected = workflowWithSteps("wfl_1", NEW_RUN_NAMES);
    expect(migrated.spec).toEqual(expected.spec);
    expect(migrated.status?.versionHash).toBe(RUN_RENAME_HASH);
    expect(migrated.metadata?.version?.id).toBe(RUN_RENAME_HASH);
    const yaml = migrated.status?.serverlessWorkflowValidation?.yaml ?? "";
    expect(yaml).toBe(protoToYaml(migrated.spec));
    expect(yaml).toContain("run_id:");
    expect(yaml).not.toMatch(/\bexecution_id:/);
  });

  it("rewrites an expression held in a list, leaving the list's other strings", () => {
    const workflow = workflowWithSteps("wfl_list", OLD_RUN_NAMES);
    workflow.spec!.tasks[2]!.taskConfig = {
      event: {
        type: "ticket.done",
        data: { refs: ["${ .triage.agent_execution_id }", "agent_execution_id is plain text", 3] },
      },
    };
    const migrated = fromBinary(WorkflowSchema, renamedWorkflowRow(toBinary(WorkflowSchema, workflow))!);
    const event = migrated.spec?.tasks[2]?.taskConfig?.["event"] as { data: { refs: unknown } };
    expect(event.data.refs).toEqual([
      "${ .triage.agent_run_id }",
      "agent_execution_id is plain text",
      3,
    ]);
  });

  it("leaves a workflow whose steps already read current alone", () => {
    expect(
      renamedWorkflowRow(toBinary(WorkflowSchema, workflowWithSteps("wfl_1", NEW_RUN_NAMES))),
    ).toBeUndefined();
  });

  it("throws on bytes that do not decode", () => {
    expect(() => renamedWorkflowRow(new Uint8Array([0x22, 0xff]))).toThrow();
  });
});
