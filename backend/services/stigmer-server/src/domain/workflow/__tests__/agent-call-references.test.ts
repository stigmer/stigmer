/**
 * Pins the workflow domain's collector for the reference rule
 * (../agent-call-references.ts): the strict `slug` / `org/slug` parser and
 * its refusal copy, the walk over top-level, nested and compensate tasks
 * in declaration order with the bare form resolved to the workflow's
 * organization, a config that does not decode skipped rather than
 * double-reported, and the step over a real store answering the rule's
 * verdicts — a missing agent with the rule's copy, another organization's
 * org-visible agent with the one cross-organization sentence, a
 * platform-visible one admitted.
 */
import { create } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { AgentSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { WorkflowSchema } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/api_pb";
import { WorkflowTaskKind } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/enum_pb";
import type { WorkflowSpec } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/spec_pb";
import { WorkflowSpecSchema } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/spec_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";

import { RequestContext } from "../../../pipeline/request-context.js";
import { testCallerIdentity } from "../../../pipeline/__tests__/support.js";
import {
  missingReferencesMessage,
  notAvailableReferenceMessage,
  referenceTargetKind,
} from "../../../pipeline/steps/references.js";
import type { SqliteStore } from "../../../store/sqlite/store.js";
import { tempStore } from "../../../store/sqlite/__tests__/support.js";
import {
  collectAgentCallReferences,
  malformedAgentReferenceMessage,
  newValidateAgentCallReferencesStep,
  parseAgentReference,
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

describe("parseAgentReference", () => {
  it("accepts `slug` and `org/slug` and nothing else", () => {
    expect(parseAgentReference("reviewer")).toEqual({
      org: "",
      slug: "reviewer",
    });
    expect(parseAgentReference("acme/reviewer")).toEqual({
      org: "acme",
      slug: "reviewer",
    });
    for (const malformed of ["", "/reviewer", "acme/", "a/b/c", "//"]) {
      expect(parseAgentReference(malformed), malformed).toBeUndefined();
    }
  });
});

describe("collectAgentCallReferences", () => {
  it("collects top-level, nested and compensate agent_call tasks in declaration order, the bare form resolved to the workflow's organization", () => {
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
      { kind: ApiResourceKind.agent, org: "acme", slug: "reviewer" },
      { kind: ApiResourceKind.agent, org: "globex", slug: "summarizer" },
      { kind: ApiResourceKind.agent, org: "acme", slug: "cleaner" },
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

  function workflowCalling(...agents: string[]) {
    return create(WorkflowSchema, {
      apiVersion: "agentic.stigmer.ai/v1",
      kind: "Workflow",
      metadata: { name: "Pipeline", org: "acme", visibility: V.visibility_org },
      spec: specOf(agents.map((agent, i) => agentCall(`call_${i}`, agent))),
    });
  }

  async function run(workflow: ReturnType<typeof workflowCalling>) {
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
    const error = await run(workflowCalling("reviewer"));
    expect(error).toBeInstanceOf(ConnectError);
    expect((error as ConnectError).code).toBe(Code.FailedPrecondition);
    expect((error as ConnectError).rawMessage).toBe(
      missingReferencesMessage(AGENT, [{ slug: "reviewer", org: "acme" }]),
    );
    await seedAgent("agt_1", "acme", "reviewer", V.visibility_org);
    expect(await run(workflowCalling("reviewer"))).toBeUndefined();
  });

  it("another organization's agent is admitted only at platform visibility, with the one sentence otherwise", async () => {
    await seedAgent("agt_shared", "globex", "shared", V.visibility_platform);
    await seedAgent("agt_internal", "globex", "internal", V.visibility_org);
    expect(await run(workflowCalling("globex/shared"))).toBeUndefined();
    const error = await run(workflowCalling("globex/internal"));
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
    const error = await run(workflowCalling("mine"));
    expect((error as ConnectError).code).toBe(Code.FailedPrecondition);
    expect((error as ConnectError).rawMessage).toContain(
      "referenced agent 'acme/mine' is visibility_private while this resource is visibility_org",
    );
  });
});
