// Unit tests for run-path resource creation: full-proto field mapping, the
// message default, ExecutionConfig presence/contents, runtime-env conversion,
// the one-call session_spec bootstrap, and the workflow shape. The controller
// is faked to capture the exact proto sent to the RPC.

import { describe, expect, it } from "vitest";
import { InteractionMode, ServiceTier, ThinkingMode } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { create } from "@bufbuild/protobuf";
import {
  LocalPathSourceSchema,
  WorkspaceEntrySchema,
  WorkspaceSourceSchema,
} from "@stigmer/protos/ai/stigmer/agentic/session/v1/workspace_pb";
import { type ControllerFn, createAgentExecution, createWorkflowExecution } from "./create.js";

// Returns a controller whose every RPC echoes the request back, and records the
// last message sent. `create` is the only RPC the run path calls.
function fakeController(): { fn: ControllerFn; last: () => unknown } {
  let captured: unknown;
  const fn = (() =>
    ({
      create: async (msg: unknown) => {
        captured = msg;
        return msg;
      },
    })) as unknown as ControllerFn;
  return { fn, last: () => captured };
}

describe("createAgentExecution", () => {
  it("maps the full spec and defaults an empty message to 'execute'", async () => {
    const { fn } = fakeController();
    const exec = await createAgentExecution(fn, {
      agentId: "agt_1",
      orgId: "acme",
      message: "",
      runtimeEnv: { FOO: { value: "bar", isSecret: false }, TOKEN: { value: "s", isSecret: true } },
      attachments: [],
      workspaceFileRefs: ["src/a.ts"],
      workspaceEntries: [],
      model: "claude",
      mode: "plan",
      serviceTier: "",
      thinking: "",
      autoApproveAll: true,
    });

    expect(exec.kind).toBe("AgentExecution");
    expect(exec.metadata?.org).toBe("acme");
    expect(exec.spec?.message).toBe("execute");
    expect(exec.spec?.agentId).toBe("agt_1");
    expect(exec.spec?.autoApproveAll).toBe(true);
    expect(exec.spec?.workspaceFileRefs).toEqual(["src/a.ts"]);
    expect(exec.spec?.runtimeEnv.FOO).toMatchObject({ value: "bar", isSecret: false });
    expect(exec.spec?.runtimeEnv.TOKEN).toMatchObject({ value: "s", isSecret: true });
    expect(exec.spec?.executionConfig?.modelName).toBe("claude");
    expect(exec.spec?.executionConfig?.interactionMode).toBe(InteractionMode.PLAN);
  });

  it("omits ExecutionConfig when neither model nor mode is set", async () => {
    const { fn } = fakeController();
    const exec = await createAgentExecution(fn, {
      agentId: "agt_1",
      orgId: "acme",
      message: "hi",
      runtimeEnv: {},
      attachments: [],
      workspaceFileRefs: [],
      workspaceEntries: [],
      model: "",
      mode: "",
      serviceTier: "",
      thinking: "",
      autoApproveAll: false,
    });
    expect(exec.spec?.message).toBe("hi");
    expect(exec.spec?.executionConfig).toBeUndefined();
  });

  it("maps --service-tier fast to the enum (#357)", async () => {
    const { fn } = fakeController();
    const exec = await createAgentExecution(fn, {
      agentId: "agt_1",
      orgId: "acme",
      message: "x",
      runtimeEnv: {},
      attachments: [],
      workspaceFileRefs: [],
      workspaceEntries: [],
      model: "composer-2.5",
      mode: "",
      serviceTier: "fast",
      thinking: "",
      autoApproveAll: false,
    });
    expect(exec.spec?.executionConfig?.serviceTier).toBe(ServiceTier.FAST);
  });

  it("maps an explicit --service-tier standard to STANDARD, not UNSPECIFIED", async () => {
    // Unspecified-vs-explicit-standard is a load-bearing ledger
    // distinction (#357): an explicit choice must survive to the proto.
    const { fn } = fakeController();
    const exec = await createAgentExecution(fn, {
      agentId: "agt_1",
      orgId: "acme",
      message: "x",
      runtimeEnv: {},
      attachments: [],
      workspaceFileRefs: [],
      workspaceEntries: [],
      model: "",
      mode: "",
      serviceTier: "standard",
      thinking: "",
      autoApproveAll: false,
    });
    expect(exec.spec?.executionConfig?.serviceTier).toBe(ServiceTier.STANDARD);
  });

  it("maps --thinking enabled to the enum (#772)", async () => {
    const { fn } = fakeController();
    const exec = await createAgentExecution(fn, {
      agentId: "agt_1",
      orgId: "acme",
      message: "x",
      runtimeEnv: {},
      attachments: [],
      workspaceFileRefs: [],
      workspaceEntries: [],
      model: "claude-haiku-4-5",
      mode: "",
      serviceTier: "",
      thinking: "enabled",
      autoApproveAll: false,
    });
    expect(exec.spec?.executionConfig?.thinkingMode).toBe(ThinkingMode.ENABLED);
  });

  it("maps an explicit --thinking disabled to DISABLED, not UNSPECIFIED", async () => {
    // The tier's #772 twin: unspecified-vs-explicit-disabled is the same
    // load-bearing ledger distinction.
    const { fn } = fakeController();
    const exec = await createAgentExecution(fn, {
      agentId: "agt_1",
      orgId: "acme",
      message: "x",
      runtimeEnv: {},
      attachments: [],
      workspaceFileRefs: [],
      workspaceEntries: [],
      model: "",
      mode: "",
      serviceTier: "",
      thinking: "disabled",
      autoApproveAll: false,
    });
    expect(exec.spec?.executionConfig?.thinkingMode).toBe(ThinkingMode.DISABLED);
  });

  it("leaves InteractionMode unspecified for agent mode", async () => {
    const { fn } = fakeController();
    const exec = await createAgentExecution(fn, {
      sessionId: "ses_1",
      orgId: "acme",
      message: "x",
      runtimeEnv: {},
      attachments: [],
      workspaceFileRefs: [],
      workspaceEntries: [],
      model: "m",
      mode: "agent",
      serviceTier: "",
      thinking: "",
      autoApproveAll: false,
    });
    expect(exec.spec?.sessionId).toBe("ses_1");
    expect(exec.spec?.executionConfig?.interactionMode).toBe(InteractionMode.UNSPECIFIED);
  });

  it("embeds workspace entries as session_spec (one-call bootstrap) with an empty subject", async () => {
    const entry = create(WorkspaceEntrySchema, {
      name: "repo",
      source: create(WorkspaceSourceSchema, {
        source: { case: "localPath", value: create(LocalPathSourceSchema, { path: "/home/user/repo" }) },
      }),
    });

    const { fn } = fakeController();
    const exec = await createAgentExecution(fn, {
      agentId: "agt_1",
      orgId: "acme",
      message: "hi",
      runtimeEnv: {},
      attachments: [],
      workspaceFileRefs: [],
      workspaceEntries: [entry],
      model: "",
      mode: "",
      serviceTier: "",
      thinking: "",
      autoApproveAll: false,
    });

    expect(exec.spec?.sessionId).toBe("");
    expect(exec.spec?.sessionSpec?.workspaceEntries).toEqual([entry]);
    // Subject stays empty so the server defaults its sentinel and the async
    // title activity generates a real one.
    expect(exec.spec?.sessionSpec?.subject).toBe("");
  });

  it("omits session_spec when there are no workspace entries", async () => {
    const { fn } = fakeController();
    const exec = await createAgentExecution(fn, {
      agentId: "agt_1",
      orgId: "acme",
      message: "hi",
      runtimeEnv: {},
      attachments: [],
      workspaceFileRefs: [],
      workspaceEntries: [],
      model: "",
      mode: "",
      serviceTier: "",
      thinking: "",
      autoApproveAll: false,
    });
    expect(exec.spec?.sessionSpec).toBeUndefined();
  });
});

describe("createWorkflowExecution", () => {
  it("builds a workflow execution with the trigger message", async () => {
    const { fn } = fakeController();
    const exec = await createWorkflowExecution(fn, {
      workflowId: "wfl_1",
      orgId: "acme",
      message: "",
      runtimeEnv: { K: { value: "v", isSecret: false } },
    });
    expect(exec.kind).toBe("WorkflowExecution");
    expect(exec.spec?.workflowId).toBe("wfl_1");
    expect(exec.spec?.triggerMessage).toBe("execute");
    expect(exec.spec?.runtimeEnv.K).toMatchObject({ value: "v", isSecret: false });
  });
});
