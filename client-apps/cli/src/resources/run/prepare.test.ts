// Unit tests for the prelude orchestrator: flag validation helpers and the
// STIGMER_ORG_ID injection rule. Attachment uploading is covered in
// attachments.test.ts, so these tests use no attachments.

import { describe, expect, it } from "vitest";
import { ApprovalAction } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import type { Stigmer } from "@stigmer/sdk";
import { type AgentExecFlags, parseApprovalAction, prepareAgentExec, validateMode, validateServiceTier } from "./prepare.js";

describe("parseApprovalAction", () => {
  it("maps each accepted value (case-insensitive)", () => {
    expect(parseApprovalAction("")).toBe(ApprovalAction.UNSPECIFIED);
    expect(parseApprovalAction("approve")).toBe(ApprovalAction.APPROVE);
    expect(parseApprovalAction("SKIP")).toBe(ApprovalAction.SKIP);
    expect(parseApprovalAction("reject")).toBe(ApprovalAction.REJECT);
    expect(parseApprovalAction("approve-all")).toBe(ApprovalAction.APPROVE_ALL);
    expect(parseApprovalAction("approve_all")).toBe(ApprovalAction.APPROVE_ALL);
    expect(parseApprovalAction("approveall")).toBe(ApprovalAction.APPROVE_ALL);
  });

  it("rejects an unknown value", () => {
    expect(() => parseApprovalAction("maybe")).toThrow(/must be one of/);
  });
});

describe("validateMode", () => {
  it("accepts empty, agent, and plan", () => {
    expect(() => validateMode("")).not.toThrow();
    expect(() => validateMode("agent")).not.toThrow();
    expect(() => validateMode("plan")).not.toThrow();
  });

  it("rejects anything else", () => {
    expect(() => validateMode("yolo")).toThrow(/must be "agent" or "plan"/);
  });
});

describe("validateServiceTier", () => {
  it("accepts empty, standard, and fast", () => {
    expect(() => validateServiceTier("")).not.toThrow();
    expect(() => validateServiceTier("standard")).not.toThrow();
    expect(() => validateServiceTier("fast")).not.toThrow();
  });

  it("rejects anything else before a network round trip", () => {
    expect(() => validateServiceTier("turbo")).toThrow(/must be "standard" or "fast"/);
  });
});

const BASE_FLAGS: AgentExecFlags = {
  message: "hi",
  attach: [],
  approveDefault: "",
  verbose: false,
  detach: false,
  workspace: [],
  branch: "",
  commit: "",
  env: [],
  envFile: [],
  secret: [],
  secretFile: [],
  model: "",
  autoApprove: false,
  mode: "",
  serviceTier: "",
};

// prepareAgentExec only touches client.agentExecution for attachment uploads;
// with no attachments a bare stub suffices.
const STUB_CLIENT = { agentExecution: {} } as unknown as Stigmer;

/** Stub whose whoAmI resolves an account carrying the given preference. */
function clientWithPreference(defaultNativeModel: string): Stigmer {
  return {
    agentExecution: {},
    identityAccount: {
      whoAmI: () =>
        Promise.resolve({ spec: { preferences: { defaultNativeModel } } }),
    },
  } as unknown as Stigmer;
}

/** Stub whose whoAmI rejects (auth failure, backend without the RPC, ...). */
function clientWithFailingWhoAmI(): Stigmer {
  return {
    agentExecution: {},
    identityAccount: {
      whoAmI: () => Promise.reject(new Error("unimplemented")),
    },
  } as unknown as Stigmer;
}

describe("prepareAgentExec env injection", () => {
  it("injects STIGMER_ORG_ID when absent", async () => {
    const prepared = await prepareAgentExec(BASE_FLAGS, STUB_CLIENT, "acme");
    expect(prepared.runtimeEnv.STIGMER_ORG_ID).toEqual({ value: "acme", isSecret: false });
  });

  it("does not override an explicit STIGMER_ORG_ID", async () => {
    const prepared = await prepareAgentExec(
      { ...BASE_FLAGS, env: ["STIGMER_ORG_ID=explicit"] },
      STUB_CLIENT,
      "acme",
    );
    expect(prepared.runtimeEnv.STIGMER_ORG_ID).toEqual({ value: "explicit", isSecret: false });
  });

  it("skips injection when org is empty", async () => {
    const prepared = await prepareAgentExec(BASE_FLAGS, STUB_CLIENT, "");
    expect(prepared.runtimeEnv.STIGMER_ORG_ID).toBeUndefined();
  });

  it("carries through scalar flags", async () => {
    const prepared = await prepareAgentExec(
      { ...BASE_FLAGS, message: "go", model: "claude", autoApprove: true, detach: true, mode: "plan" },
      STUB_CLIENT,
      "acme",
    );
    expect(prepared.message).toBe("go");
    expect(prepared.model).toBe("claude");
    expect(prepared.autoApproveAll).toBe(true);
    expect(prepared.detach).toBe(true);
    expect(prepared.mode).toBe("plan");
  });
});

describe("prepareAgentExec account-preference model fill (oss#293 Phase 1.5)", () => {
  it("fills an omitted --model from the account preference on cloud", async () => {
    const prepared = await prepareAgentExec(
      BASE_FLAGS,
      clientWithPreference("claude-sonnet-4.6"),
      "acme",
      undefined,
      { cloudBackend: true },
    );
    expect(prepared.model).toBe("claude-sonnet-4.6");
  });

  it("an explicit --model always outranks the preference", async () => {
    const prepared = await prepareAgentExec(
      { ...BASE_FLAGS, model: "gpt-5.3" },
      clientWithPreference("claude-sonnet-4.6"),
      "acme",
      undefined,
      { cloudBackend: true },
    );
    expect(prepared.model).toBe("gpt-5.3");
  });

  it("never consults identity on a local backend", async () => {
    // The failing stub doubles as a call detector: local mode must not even
    // attempt whoAmI, so a rejecting client cannot affect the result.
    const prepared = await prepareAgentExec(
      BASE_FLAGS,
      clientWithFailingWhoAmI(),
      "acme",
      undefined,
      { cloudBackend: false },
    );
    expect(prepared.model).toBe("");
  });

  it("falls through silently when whoAmI fails — a missing preference never fails a run", async () => {
    const prepared = await prepareAgentExec(
      BASE_FLAGS,
      clientWithFailingWhoAmI(),
      "acme",
      undefined,
      { cloudBackend: true },
    );
    expect(prepared.model).toBe("");
  });

  it("stays empty when the account declares no native default", async () => {
    const prepared = await prepareAgentExec(
      BASE_FLAGS,
      clientWithPreference(""),
      "acme",
      undefined,
      { cloudBackend: true },
    );
    expect(prepared.model).toBe("");
  });
});
