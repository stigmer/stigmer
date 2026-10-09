// Unit tests for run-path resource creation: full-proto field mapping, the
// message default, run_config presence/contents, the top-level mode, the vault
// choice on the new session (always sent: include_my_vault is off when unset),
// the one-call session_spec bootstrap, and the turn's target (an existing
// session by id alone, or a new conversation naming its agent by reference).
// The controller is faked to capture the exact proto sent to
// the RPC.

import { describe, expect, it } from "vitest";
import { InteractionMode, ServiceTier, ThinkingMode } from "@stigmer/protos/ai/stigmer/agentic/run/v1/enum_pb";
import { create } from "@bufbuild/protobuf";
import { Harness } from "@stigmer/protos/ai/stigmer/agentic/session/v1/enum_pb";
import {
  LocalPathSourceSchema,
  WorkspaceEntrySchema,
  WorkspaceSourceSchema,
} from "@stigmer/protos/ai/stigmer/agentic/session/v1/workspace_pb";
import type { Run } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import type { SessionSpec } from "@stigmer/protos/ai/stigmer/agentic/session/v1/spec_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ApiResourceReferenceSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/io_pb";
import { type ControllerFn, createAgentRun } from "../create.js";

const AGENT_REF = { org: "acme", slug: "helper" };

const VAULT_REF = create(ApiResourceReferenceSchema, {
  kind: ApiResourceKind.vault,
  org: "acme",
  slug: "support-tools",
});

// The embedded session_spec of a new-conversation target, or undefined.
function sessionSpecOf(exec: Run): SessionSpec | undefined {
  const target = exec.spec?.target;
  return target?.case === "sessionSpec" ? target.value : undefined;
}

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

describe("createAgentRun", () => {
  it("maps the full spec and defaults an empty message to 'execute'", async () => {
    const { fn } = fakeController();
    const exec = await createAgentRun(fn, {
      agentRef: AGENT_REF,
      orgId: "acme",
      message: "",
      vaults: [VAULT_REF],
      includeMyVault: true,
      attachments: [],
      workspaceFileRefs: ["src/a.ts"],
      workspaceEntries: [],
      model: "claude",
      mode: "plan",
      serviceTier: "",
      thinking: "",
      autoApproveAll: true,
      harness: "",
    });

    expect(exec.kind).toBe("Run");
    expect(exec.metadata?.org).toBe("acme");
    expect(exec.spec?.message).toBe("execute");
    expect(sessionSpecOf(exec)?.agentRef).toMatchObject({
      kind: ApiResourceKind.agent,
      org: "acme",
      slug: "helper",
      version: "",
    });
    expect(exec.spec?.autoApproveAll).toBe(true);
    expect(exec.spec?.workspaceFileRefs).toEqual(["src/a.ts"]);
    expect(sessionSpecOf(exec)?.vaults.map((ref) => ref.slug)).toEqual(["support-tools"]);
    expect(sessionSpecOf(exec)?.includeMyVault).toBe(true);
    expect(exec.spec?.runConfig?.modelName).toBe("claude");
    expect(exec.spec?.interactionMode).toBe(InteractionMode.PLAN);
  });

  it("omits run_config and the mode when no flag is set", async () => {
    const { fn } = fakeController();
    const exec = await createAgentRun(fn, {
      agentRef: AGENT_REF,
      orgId: "acme",
      message: "hi",
      vaults: [],
      includeMyVault: true,
      attachments: [],
      workspaceFileRefs: [],
      workspaceEntries: [],
      model: "",
      mode: "",
      serviceTier: "",
      thinking: "",
      autoApproveAll: false,
      harness: "",
    });
    expect(exec.spec?.message).toBe("hi");
    expect(exec.spec?.runConfig).toBeUndefined();
    expect(exec.spec?.interactionMode).toBe(InteractionMode.UNSPECIFIED);
  });

  it("maps --service-tier fast to the enum (#357)", async () => {
    const { fn } = fakeController();
    const exec = await createAgentRun(fn, {
      agentRef: AGENT_REF,
      orgId: "acme",
      message: "x",
      vaults: [],
      includeMyVault: true,
      attachments: [],
      workspaceFileRefs: [],
      workspaceEntries: [],
      model: "composer-2.5",
      mode: "",
      serviceTier: "fast",
      thinking: "",
      autoApproveAll: false,
      harness: "",
    });
    expect(exec.spec?.runConfig?.serviceTier).toBe(ServiceTier.FAST);
  });

  it("maps an explicit --service-tier standard to STANDARD, not UNSPECIFIED", async () => {
    // Unspecified-vs-explicit-standard is a load-bearing ledger
    // distinction (#357): an explicit choice must survive to the proto.
    const { fn } = fakeController();
    const exec = await createAgentRun(fn, {
      agentRef: AGENT_REF,
      orgId: "acme",
      message: "x",
      vaults: [],
      includeMyVault: true,
      attachments: [],
      workspaceFileRefs: [],
      workspaceEntries: [],
      model: "",
      mode: "",
      serviceTier: "standard",
      thinking: "",
      autoApproveAll: false,
      harness: "",
    });
    expect(exec.spec?.runConfig?.serviceTier).toBe(ServiceTier.STANDARD);
  });

  it("maps --thinking enabled to the enum (#772)", async () => {
    const { fn } = fakeController();
    const exec = await createAgentRun(fn, {
      agentRef: AGENT_REF,
      orgId: "acme",
      message: "x",
      vaults: [],
      includeMyVault: true,
      attachments: [],
      workspaceFileRefs: [],
      workspaceEntries: [],
      model: "claude-haiku-4-5",
      mode: "",
      serviceTier: "",
      thinking: "enabled",
      autoApproveAll: false,
      harness: "",
    });
    expect(exec.spec?.runConfig?.thinkingMode).toBe(ThinkingMode.ENABLED);
  });

  it("maps an explicit --thinking disabled to DISABLED, not UNSPECIFIED", async () => {
    // The tier's #772 twin: unspecified-vs-explicit-disabled is the same
    // load-bearing ledger distinction.
    const { fn } = fakeController();
    const exec = await createAgentRun(fn, {
      agentRef: AGENT_REF,
      orgId: "acme",
      message: "x",
      vaults: [],
      includeMyVault: true,
      attachments: [],
      workspaceFileRefs: [],
      workspaceEntries: [],
      model: "",
      mode: "",
      serviceTier: "",
      thinking: "disabled",
      autoApproveAll: false,
      harness: "",
    });
    expect(exec.spec?.runConfig?.thinkingMode).toBe(ThinkingMode.DISABLED);
  });

  it("leaves InteractionMode unspecified for agent mode", async () => {
    const { fn } = fakeController();
    const exec = await createAgentRun(fn, {
      sessionId: "ses_1",
      orgId: "acme",
      message: "x",
      vaults: [],
      includeMyVault: true,
      attachments: [],
      workspaceFileRefs: [],
      workspaceEntries: [],
      model: "m",
      mode: "agent",
      serviceTier: "",
      thinking: "",
      autoApproveAll: false,
      harness: "",
    });
    expect(exec.spec?.target).toEqual({ case: "sessionId", value: "ses_1" });
    expect(exec.spec?.interactionMode).toBe(InteractionMode.UNSPECIFIED);
  });

  it("embeds workspace entries as session_spec (one-call bootstrap) with an empty subject", async () => {
    const entry = create(WorkspaceEntrySchema, {
      name: "repo",
      source: create(WorkspaceSourceSchema, {
        source: { case: "localPath", value: create(LocalPathSourceSchema, { path: "/home/user/repo" }) },
      }),
    });

    const { fn } = fakeController();
    const exec = await createAgentRun(fn, {
      agentRef: AGENT_REF,
      orgId: "acme",
      message: "hi",
      vaults: [],
      includeMyVault: true,
      attachments: [],
      workspaceFileRefs: [],
      workspaceEntries: [entry],
      model: "",
      mode: "",
      serviceTier: "",
      thinking: "",
      autoApproveAll: false,
      harness: "",
    });

    expect(exec.spec?.target?.case).toBe("sessionSpec");
    expect(sessionSpecOf(exec)?.workspaceEntries).toEqual([entry]);
    // Subject stays empty so the server defaults its sentinel and the async
    // title activity generates a real one.
    expect(sessionSpecOf(exec)?.subject).toBe("");
    // No harness opinion: the field stays UNSPECIFIED so the server default
    // (native) applies.
    expect(sessionSpecOf(exec)?.harness).toBe(Harness.UNSPECIFIED);
  });

  it("sends a session_spec naming no agent for a plain built-in assistant run (wire-shape pin)", async () => {
    // A conversation created from no spec has include_my_vault off, so a
    // plain run would lose the person's own My vault: the spec is always
    // sent, and naming no agent is what names the built-in assistant.
    const { fn } = fakeController();
    const exec = await createAgentRun(fn, {
      orgId: "acme",
      message: "hi",
      vaults: [],
      includeMyVault: true,
      attachments: [],
      workspaceFileRefs: [],
      workspaceEntries: [],
      model: "",
      mode: "",
      serviceTier: "",
      thinking: "",
      autoApproveAll: false,
      harness: "",
    });
    expect(exec.spec?.target?.case).toBe("sessionSpec");
    expect(sessionSpecOf(exec)?.agentRef).toBeUndefined();
    expect(sessionSpecOf(exec)?.includeMyVault).toBe(true);
    expect(sessionSpecOf(exec)?.vaults).toEqual([]);
  });

  it("carries a version the caller names on the agent reference", async () => {
    const { fn } = fakeController();
    const exec = await createAgentRun(fn, {
      agentRef: { ...AGENT_REF, version: "stable" },
      orgId: "acme",
      message: "hi",
      vaults: [],
      includeMyVault: true,
      attachments: [],
      workspaceFileRefs: [],
      workspaceEntries: [],
      model: "",
      mode: "",
      serviceTier: "",
      thinking: "",
      autoApproveAll: false,
      harness: "",
    });
    expect(sessionSpecOf(exec)?.agentRef?.version).toBe("stable");
  });

  it("sends only the session id for a turn in an existing session", async () => {
    // The session pins its agent, workspace and harness at creation; a turn
    // in it names the session alone, never an agent beside it.
    const entry = create(WorkspaceEntrySchema, { name: "repo" });
    const { fn } = fakeController();
    const exec = await createAgentRun(fn, {
      sessionId: "ses_1",
      agentRef: AGENT_REF,
      orgId: "acme",
      message: "hi",
      vaults: [],
      includeMyVault: true,
      attachments: [],
      workspaceFileRefs: [],
      workspaceEntries: [entry],
      model: "",
      mode: "",
      serviceTier: "",
      thinking: "",
      autoApproveAll: false,
      harness: "cursor",
    });
    expect(exec.spec?.target).toEqual({ case: "sessionId", value: "ses_1" });
  });

  it("stamps cursor harness on a session_spec created just for it (oss#293)", async () => {
    const { fn } = fakeController();
    const exec = await createAgentRun(fn, {
      agentRef: AGENT_REF,
      orgId: "acme",
      message: "hi",
      vaults: [],
      includeMyVault: true,
      attachments: [],
      workspaceFileRefs: [],
      workspaceEntries: [],
      model: "",
      mode: "",
      serviceTier: "",
      thinking: "",
      autoApproveAll: false,
      harness: "cursor",
    });
    // Harness alone justifies the embedded spec: the server clones it onto
    // the auto-created session (the one-call bootstrap contract).
    expect(sessionSpecOf(exec)?.harness).toBe(Harness.CURSOR);
    expect(sessionSpecOf(exec)?.workspaceEntries).toEqual([]);
  });

  it("stamps an explicit native harness rather than leaving it unspecified", async () => {
    // "native" may be a deliberate per-run escape from the account's
    // default_harness preference — it must survive on the wire so it beats
    // any future change to the server-side default.
    const { fn } = fakeController();
    const exec = await createAgentRun(fn, {
      agentRef: AGENT_REF,
      orgId: "acme",
      message: "hi",
      vaults: [],
      includeMyVault: true,
      attachments: [],
      workspaceFileRefs: [],
      workspaceEntries: [],
      model: "",
      mode: "",
      serviceTier: "",
      thinking: "",
      autoApproveAll: false,
      harness: "native",
    });
    expect(sessionSpecOf(exec)?.harness).toBe(Harness.NATIVE);
  });

  it("carries harness and workspace entries together on one session_spec", async () => {
    const entry = create(WorkspaceEntrySchema, {
      name: "repo",
      source: create(WorkspaceSourceSchema, {
        source: { case: "localPath", value: create(LocalPathSourceSchema, { path: "/home/user/repo" }) },
      }),
    });

    const { fn } = fakeController();
    const exec = await createAgentRun(fn, {
      agentRef: AGENT_REF,
      orgId: "acme",
      message: "hi",
      vaults: [],
      includeMyVault: true,
      attachments: [],
      workspaceFileRefs: [],
      workspaceEntries: [entry],
      model: "",
      mode: "",
      serviceTier: "",
      thinking: "",
      autoApproveAll: false,
      harness: "cursor",
    });
    expect(sessionSpecOf(exec)?.harness).toBe(Harness.CURSOR);
    expect(sessionSpecOf(exec)?.workspaceEntries).toEqual([entry]);
  });

  it("leaves My vault out of a new conversation when the run asks, keeping its vaults", async () => {
    const { fn } = fakeController();
    const exec = await createAgentRun(fn, {
      orgId: "acme",
      message: "hi",
      vaults: [VAULT_REF],
      includeMyVault: false,
      attachments: [],
      workspaceFileRefs: [],
      workspaceEntries: [],
      model: "",
      mode: "",
      serviceTier: "",
      thinking: "",
      autoApproveAll: false,
      harness: "",
    });
    expect(sessionSpecOf(exec)?.includeMyVault).toBe(false);
    expect(sessionSpecOf(exec)?.vaults.map((ref) => `${ref.org}/${ref.slug}`)).toEqual(["acme/support-tools"]);
  });
});
