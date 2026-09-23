/**
 * Pins the workflow domain's collector for the reference rule
 * (../agent-call-references.ts): the classifier's four forms (a literal
 * `org/slug`, a relative bare slug, a value holding `${` that is fixed
 * only at run, anything else malformed) and the refusal copy; the walk
 * over top-level, nested and compensate tasks in declaration order, the
 * relative form filled with the workflow's organization and marked, a
 * run-time value collected as nothing; a config that does not decode
 * skipped rather than double-reported; the step over a real store
 * answering the rule's verdicts — a missing agent with the rule's copy,
 * another organization's org-visible agent with the one
 * cross-organization sentence, a platform-visible one admitted, the floor
 * for a literal, the floor capped at org for a bare slug, a run-time value
 * saved with no agent behind it; and the workflow's escalation door
 * applying the same cap when a workflow calling a bare slug is raised to
 * platform.
 */
import { create } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { AgentSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import type { Workflow } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/api_pb";
import { WorkflowSchema } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/api_pb";
import { WorkflowTaskKind } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/enum_pb";
import type { WorkflowSpec } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/spec_pb";
import { WorkflowSpecSchema } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/spec_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";
import { UpdateVisibilityInputSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/io_pb";

import { RequestContext } from "../../../pipeline/request-context.js";
import { testCallerIdentity } from "../../../pipeline/__tests__/support.js";
import {
  belowFloorMessage,
  missingReferencesMessage,
  newGuardReferenceFloorOnEscalationStep,
  notAvailableReferenceMessage,
  referenceTargetKind,
} from "../../../pipeline/steps/references.js";
import type { SqliteStore } from "../../../store/sqlite/store.js";
import { tempStore } from "../../../store/sqlite/__tests__/support.js";
import {
  classifyAgentReference,
  collectAgentCallReferences,
  malformedAgentReferenceMessage,
  newValidateAgentCallReferencesStep,
} from "../agent-call-references.js";

const V = ApiResourceVisibility;
const AGENT = referenceTargetKind(ApiResourceKind.agent)!;

function agentCall(name: string, agent: string) {
  return {
    name,
    kind: WorkflowTaskKind.agent_call,
    taskConfig: { agent, message: "do the thing" },
  };
}

function specOf(tasks: ReadonlyArray<Record<string, unknown>>): WorkflowSpec {
  return create(WorkflowSpecSchema, { tasks } as never);
}

/** The three shapes the runner evaluates, whole and embedded, as authors write them. */
const RUN_TIME_VALUES = [
  "${.env_vars.TEAM_ORG}/assistant",
  "${.secrets.AGENT_REF}",
  '${ "acme/reviewer" }',
  "${ .input.agent }",
  "acme/${ .input.slug }",
  "${ .input.org }/a/b",
];

describe("classifyAgentReference", () => {
  it("reads `org/slug` as a literal and a bare slug as relative", () => {
    expect(classifyAgentReference("acme/reviewer")).toEqual({
      kind: "literal",
      org: "acme",
      slug: "reviewer",
    });
    expect(classifyAgentReference("reviewer")).toEqual({
      kind: "relative",
      slug: "reviewer",
    });
  });

  it("reads any value holding `${` as fixed only at run, whatever its shape", () => {
    for (const value of RUN_TIME_VALUES) {
      expect(classifyAgentReference(value), value).toEqual({
        kind: "run-time",
      });
    }
  });

  it("reads everything else as malformed", () => {
    for (const malformed of ["", "/reviewer", "acme/", "a/b/c", "//"]) {
      expect(classifyAgentReference(malformed), malformed).toEqual({
        kind: "malformed",
      });
    }
  });
});

describe("collectAgentCallReferences", () => {
  it("collects top-level, nested and compensate agent_call tasks in declaration order, a bare slug filled with the workflow's organization and marked relative", () => {
    const spec = specOf([
      agentCall("first", "reviewer"),
      {
        name: "loop",
        kind: WorkflowTaskKind.for_each,
        taskConfig: {
          each: "item",
          in: "${ .items }",
          // A nested task inside the Struct is JSON: proto field names.
          do: [
            {
              name: "inner",
              kind: "agent_call",
              task_config: { agent: "globex/summarizer", message: "sum" },
            },
          ],
        },
        compensate: [agentCall("undo", "cleaner")],
      },
      {
        name: "pause",
        kind: WorkflowTaskKind.wait,
        taskConfig: { duration: {} },
      },
    ]);
    expect(collectAgentCallReferences(spec, "acme")).toEqual([
      {
        kind: ApiResourceKind.agent,
        org: "acme",
        slug: "reviewer",
        resolvesIn: "running-organization",
      },
      { kind: ApiResourceKind.agent, org: "globex", slug: "summarizer" },
      {
        kind: ApiResourceKind.agent,
        org: "acme",
        slug: "cleaner",
        resolvesIn: "running-organization",
      },
    ]);
  });

  it("collects nothing for a value fixed only at run, beside the references it does collect", () => {
    const spec = specOf([
      ...RUN_TIME_VALUES.map((value, i) => agentCall(`dynamic_${i}`, value)),
      agentCall("fixed", "globex/summarizer"),
    ]);
    expect(collectAgentCallReferences(spec, "acme")).toEqual([
      { kind: ApiResourceKind.agent, org: "globex", slug: "summarizer" },
    ]);
  });

  it("refuses a malformed agent string naming the task", () => {
    const spec = specOf([agentCall("broken", "a/b/c")]);
    expect(() => collectAgentCallReferences(spec, "acme")).toThrow(
      malformedAgentReferenceMessage("broken", "a/b/c"),
    );
    let error: unknown;
    try {
      collectAgentCallReferences(spec, "acme");
    } catch (e) {
      error = e;
    }
    expect((error as ConnectError).code).toBe(Code.InvalidArgument);
  });

  it("skips a config that does not decode — the spec validation step has already refused it", () => {
    const spec = specOf([
      {
        name: "odd",
        kind: WorkflowTaskKind.agent_call,
        taskConfig: { agent: "reviewer", not_a_field: true },
      },
    ]);
    expect(collectAgentCallReferences(spec, "acme")).toEqual([]);
    expect(collectAgentCallReferences(undefined, "acme")).toEqual([]);
  });
});

describe("ValidateAgentCallReferences over a store", () => {
  let store: SqliteStore;
  let cleanup: () => Promise<void>;

  beforeEach(() => {
    const temp = tempStore();
    store = temp.store;
    cleanup = temp.cleanup;
  });

  afterEach(async () => {
    await cleanup();
  });

  async function seedAgent(
    id: string,
    org: string,
    slug: string,
    visibility: ApiResourceVisibility,
  ): Promise<void> {
    await store.saveResource(
      ApiResourceKind.agent,
      id,
      AgentSchema,
      create(AgentSchema, {
        apiVersion: "agentic.stigmer.ai/v1",
        kind: "Agent",
        metadata: { id, name: slug, slug, org, visibility },
        spec: { instructions: "a conformant instruction body" },
      }),
    );
  }

  function workflowCalling(
    visibility: ApiResourceVisibility,
    ...agents: string[]
  ): Workflow {
    return create(WorkflowSchema, {
      apiVersion: "agentic.stigmer.ai/v1",
      kind: "Workflow",
      metadata: { id: "wfl_1", name: "Pipeline", org: "acme", visibility },
      spec: specOf(agents.map((agent, i) => agentCall(`call_${i}`, agent))),
    });
  }

  async function run(workflow: Workflow): Promise<unknown> {
    const ctx = new RequestContext(
      WorkflowSchema,
      workflow,
      testCallerIdentity(),
      ApiResourceKind.workflow,
    );
    try {
      await newValidateAgentCallReferencesStep(store).execute(ctx);
      return undefined;
    } catch (error) {
      return error;
    }
  }

  it("a missing agent is refused with the rule's copy; an existing one passes", async () => {
    const error = await run(workflowCalling(V.visibility_org, "reviewer"));
    expect(error).toBeInstanceOf(ConnectError);
    expect((error as ConnectError).code).toBe(Code.FailedPrecondition);
    expect((error as ConnectError).rawMessage).toBe(
      missingReferencesMessage(AGENT, [{ slug: "reviewer", org: "acme" }]),
    );
    await seedAgent("agt_1", "acme", "reviewer", V.visibility_org);
    expect(
      await run(workflowCalling(V.visibility_org, "reviewer")),
    ).toBeUndefined();
  });

  it("another organization's agent is admitted only at platform visibility, with the one sentence otherwise", async () => {
    await seedAgent("agt_shared", "globex", "shared", V.visibility_platform);
    await seedAgent("agt_internal", "globex", "internal", V.visibility_org);
    expect(
      await run(workflowCalling(V.visibility_org, "globex/shared")),
    ).toBeUndefined();
    const error = await run(
      workflowCalling(V.visibility_org, "globex/internal"),
    );
    expect((error as ConnectError).rawMessage).toBe(
      notAvailableReferenceMessage(AGENT, {
        kind: ApiResourceKind.agent,
        org: "globex",
        slug: "internal",
      }),
    );
  });

  it("the floor holds for the agent a workflow calls: an org-visible workflow may not call a private agent", async () => {
    await seedAgent("agt_mine", "acme", "mine", V.visibility_private);
    const error = await run(workflowCalling(V.visibility_org, "mine"));
    expect((error as ConnectError).code).toBe(Code.FailedPrecondition);
    expect((error as ConnectError).rawMessage).toContain(
      "referenced agent 'acme/mine' is visibility_private while this resource is visibility_org",
    );
  });

  it("a platform-visible workflow may call its organization's org-visible agent by bare slug, never by literal, and never a private one", async () => {
    await seedAgent("agt_team", "acme", "team", V.visibility_org);
    await seedAgent("agt_mine", "acme", "mine", V.visibility_private);
    expect(
      await run(workflowCalling(V.visibility_platform, "team")),
    ).toBeUndefined();
    // The literal names a fixed row that every organization's runs read.
    const literal = await run(
      workflowCalling(V.visibility_platform, "acme/team"),
    );
    expect((literal as ConnectError).rawMessage).toContain(
      "referenced agent 'acme/team' is visibility_org while this resource is visibility_platform",
    );
    const below = await run(workflowCalling(V.visibility_platform, "mine"));
    expect((below as ConnectError).rawMessage).toContain(
      "referenced agent 'acme/mine' is visibility_private while this resource is visibility_platform",
    );
  });

  it("a value fixed only at run saves with no agent behind it, at every level", async () => {
    for (const visibility of [
      V.visibility_private,
      V.visibility_org,
      V.visibility_platform,
    ]) {
      expect(
        await run(workflowCalling(visibility, ...RUN_TIME_VALUES)),
        V[visibility],
      ).toBeUndefined();
    }
  });

  describe("the workflow's escalation door", () => {
    const TARGET = "loadedWorkflow";

    async function escalate(
      stored: Workflow,
      requested: ApiResourceVisibility,
    ): Promise<unknown> {
      const ctx = new RequestContext(
        UpdateVisibilityInputSchema,
        create(UpdateVisibilityInputSchema, {
          resourceId: "wfl_1",
          visibility: requested,
        }),
        testCallerIdentity(),
        ApiResourceKind.workflow,
      );
      ctx.set(TARGET, stored);
      try {
        await newGuardReferenceFloorOnEscalationStep(store, TARGET, [
          (row) =>
            collectAgentCallReferences(
              (row as Workflow).spec,
              (row as Workflow).metadata?.org ?? "",
            ),
        ]).execute(ctx);
        return undefined;
      } catch (error) {
        return error;
      }
    }

    it("raising a workflow that calls a bare slug to platform asks the capped floor", async () => {
      await seedAgent("agt_team", "acme", "team", V.visibility_org);
      await seedAgent("agt_mine", "acme", "mine", V.visibility_private);
      expect(
        await escalate(
          workflowCalling(V.visibility_org, "team"),
          V.visibility_platform,
        ),
      ).toBeUndefined();
      const error = await escalate(
        workflowCalling(V.visibility_private, "mine"),
        V.visibility_platform,
      );
      expect((error as ConnectError).code).toBe(Code.FailedPrecondition);
      expect((error as ConnectError).rawMessage).toBe(
        belowFloorMessage(
          AGENT,
          { kind: ApiResourceKind.agent, org: "acme", slug: "mine" },
          V.visibility_private,
          V.visibility_platform,
        ),
      );
    });
  });
});
