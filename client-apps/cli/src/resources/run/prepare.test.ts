// Unit tests for the prelude orchestrator: flag validation helpers and the
// STIGMER_ORG_ID injection rule. Attachment uploading is covered in
// attachments.test.ts, so these tests use no attachments.

import { describe, expect, it } from "vitest";
import { ApprovalAction } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import type { Stigmer } from "@stigmer/sdk";
import { type AgentExecFlags, parseApprovalAction, prepareAgentExec, validateHarness, validateMode, validateServiceTier, validateThinking } from "./prepare.js";

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

describe("validateThinking", () => {
  it("accepts empty, disabled, and enabled", () => {
    expect(() => validateThinking("")).not.toThrow();
    expect(() => validateThinking("disabled")).not.toThrow();
    expect(() => validateThinking("enabled")).not.toThrow();
  });

  it("rejects anything else before a network round trip", () => {
    expect(() => validateThinking("harder")).toThrow(/must be "disabled" or "enabled"/);
  });
});

describe("validateHarness", () => {
  it("accepts empty, native, and cursor", () => {
    expect(() => validateHarness("")).not.toThrow();
    expect(() => validateHarness("native")).not.toThrow();
    expect(() => validateHarness("cursor")).not.toThrow();
  });

  it("rejects anything else before a network round trip", () => {
    expect(() => validateHarness("turbo")).toThrow(/must be "native" or "cursor"/);
  });

  it("rejects UI-only harness names that have no proto mapping", () => {
    // copilot/codex/etc. exist in display metadata but not on the wire —
    // accepting them here would stamp UNSPECIFIED and silently run native.
    expect(() => validateHarness("copilot")).toThrow(/must be "native" or "cursor"/);
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
  thinking: "",
  harness: "",
};

// prepareAgentExec only touches client.agentExecution for attachment uploads;
// with no attachments a bare stub suffices.
const STUB_CLIENT = { agentExecution: {} } as unknown as Stigmer;

/** The shape of IdentityAccountPreferences the stubs below expose. */
interface StubPreferences {
  readonly defaultHarness?: string;
  readonly defaultNativeModel?: string;
  readonly defaultCursorModel?: string;
}

/** Stub whose whoAmI resolves an account carrying the given preferences. */
function clientWithPreferences(preferences: StubPreferences): Stigmer {
  return {
    agentExecution: {},
    identityAccount: {
      whoAmI: () => Promise.resolve({ spec: { preferences } }),
    },
  } as unknown as Stigmer;
}

/** Back-compat shorthand for the original native-model-only stub. */
function clientWithPreference(defaultNativeModel: string): Stigmer {
  return clientWithPreferences({ defaultNativeModel });
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

/** Preference stub that also counts whoAmI invocations (round-trip pin). */
function countingClient(preferences: StubPreferences): { client: Stigmer; calls: () => number } {
  let calls = 0;
  const client = {
    agentExecution: {},
    identityAccount: {
      whoAmI: () => {
        calls += 1;
        return Promise.resolve({ spec: { preferences } });
      },
    },
  } as unknown as Stigmer;
  return { client, calls: () => calls };
}

/** prepareAgentExec options as `run` passes them: cloud + harness opt-in. */
const CLOUD_RUN_OPTIONS = { cloudBackend: true, applyAccountHarnessDefault: true } as const;

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

describe("prepareAgentExec harness resolution (oss#293)", () => {
  it("fills an omitted --harness from the account preference on cloud when the caller opts in (run)", async () => {
    const prepared = await prepareAgentExec(
      BASE_FLAGS,
      clientWithPreferences({ defaultHarness: "cursor" }),
      "acme",
      undefined,
      CLOUD_RUN_OPTIONS,
    );
    expect(prepared.harness).toBe("cursor");
  });

  it("an explicit --harness always outranks the account preference", async () => {
    // The per-run escape hatch: a cursor-preference user can still force a
    // native run without touching their settings.
    const prepared = await prepareAgentExec(
      { ...BASE_FLAGS, harness: "native" },
      clientWithPreferences({ defaultHarness: "cursor" }),
      "acme",
      undefined,
      CLOUD_RUN_OPTIONS,
    );
    expect(prepared.harness).toBe("native");
  });

  it("ignores the preference when the caller has not opted in (draft, D5)", async () => {
    // draft runs the seedpack's system creator agents — a utility flow that
    // must not be silently rerouted onto the cursor engine by a preference
    // meant for the user's own sessions (owner-ratified D5).
    const prepared = await prepareAgentExec(
      BASE_FLAGS,
      clientWithPreferences({ defaultHarness: "cursor" }),
      "acme",
      undefined,
      { cloudBackend: true },
    );
    expect(prepared.harness).toBe("");
  });

  it("an explicit --harness still resolves for a non-opted-in caller (draft escape hatch)", async () => {
    const prepared = await prepareAgentExec(
      { ...BASE_FLAGS, harness: "cursor" },
      STUB_CLIENT,
      "acme",
      undefined,
      { cloudBackend: false },
    );
    expect(prepared.harness).toBe("cursor");
  });

  it("treats a malformed persisted harness as undeclared", async () => {
    // A client must not trust stored data it did not write: anything outside
    // the shipped allowlist resolves as if no preference existed.
    const prepared = await prepareAgentExec(
      BASE_FLAGS,
      clientWithPreferences({ defaultHarness: "devin" }),
      "acme",
      undefined,
      CLOUD_RUN_OPTIONS,
    );
    expect(prepared.harness).toBe("");
  });

  it("resolves empty when whoAmI fails — a missing preference never fails a run", async () => {
    const prepared = await prepareAgentExec(
      BASE_FLAGS,
      clientWithFailingWhoAmI(),
      "acme",
      undefined,
      CLOUD_RUN_OPTIONS,
    );
    expect(prepared.harness).toBe("");
    expect(prepared.model).toBe("");
  });

  it("never consults identity on a local backend, even with the opt-in", async () => {
    // The failing stub doubles as a call detector, as in the model-fill suite.
    const prepared = await prepareAgentExec(
      BASE_FLAGS,
      clientWithFailingWhoAmI(),
      "acme",
      undefined,
      { cloudBackend: false, applyAccountHarnessDefault: true },
    );
    expect(prepared.harness).toBe("");
  });

  it("resolves empty when nothing is declared anywhere", async () => {
    const prepared = await prepareAgentExec(
      BASE_FLAGS,
      clientWithPreferences({}),
      "acme",
      undefined,
      CLOUD_RUN_OPTIONS,
    );
    expect(prepared.harness).toBe("");
  });
});

describe("prepareAgentExec harness-aware model fill (oss#293)", () => {
  const BOTH_MODELS: StubPreferences = {
    defaultNativeModel: "claude-sonnet-4.6",
    defaultCursorModel: "composer-2.5",
  };

  it("fills the cursor model when the explicit harness is cursor", async () => {
    const prepared = await prepareAgentExec(
      { ...BASE_FLAGS, harness: "cursor" },
      clientWithPreferences(BOTH_MODELS),
      "acme",
      undefined,
      CLOUD_RUN_OPTIONS,
    );
    expect(prepared.model).toBe("composer-2.5");
  });

  it("fills the cursor model when the preference resolves the harness to cursor", async () => {
    const prepared = await prepareAgentExec(
      BASE_FLAGS,
      clientWithPreferences({ ...BOTH_MODELS, defaultHarness: "cursor" }),
      "acme",
      undefined,
      CLOUD_RUN_OPTIONS,
    );
    expect(prepared.harness).toBe("cursor");
    expect(prepared.model).toBe("composer-2.5");
  });

  it("fills the native model when the harness resolves native or empty", async () => {
    const explicit = await prepareAgentExec(
      { ...BASE_FLAGS, harness: "native" },
      clientWithPreferences(BOTH_MODELS),
      "acme",
      undefined,
      CLOUD_RUN_OPTIONS,
    );
    expect(explicit.model).toBe("claude-sonnet-4.6");

    const unset = await prepareAgentExec(
      BASE_FLAGS,
      clientWithPreferences(BOTH_MODELS),
      "acme",
      undefined,
      CLOUD_RUN_OPTIONS,
    );
    expect(unset.model).toBe("claude-sonnet-4.6");
  });

  it("an explicit --model outranks the harness-matched preference", async () => {
    const prepared = await prepareAgentExec(
      { ...BASE_FLAGS, harness: "cursor", model: "gpt-5.3" },
      clientWithPreferences(BOTH_MODELS),
      "acme",
      undefined,
      CLOUD_RUN_OPTIONS,
    );
    expect(prepared.model).toBe("gpt-5.3");
  });

  it("draft with an explicit --harness cursor fills the cursor model despite no harness opt-in (D5)", async () => {
    // D5 scopes only the silent preference fill; the model fill follows
    // whatever harness the user explicitly chose.
    const prepared = await prepareAgentExec(
      { ...BASE_FLAGS, harness: "cursor" },
      clientWithPreferences(BOTH_MODELS),
      "acme",
      undefined,
      { cloudBackend: true },
    );
    expect(prepared.harness).toBe("cursor");
    expect(prepared.model).toBe("composer-2.5");
  });

  it("serves both fills from one whoAmI round trip, and none when both flags are explicit", async () => {
    const single = countingClient({ ...BOTH_MODELS, defaultHarness: "cursor" });
    const filled = await prepareAgentExec(BASE_FLAGS, single.client, "acme", undefined, CLOUD_RUN_OPTIONS);
    expect(filled.harness).toBe("cursor");
    expect(filled.model).toBe("composer-2.5");
    expect(single.calls(), "harness + model fills share one whoAmI").toBe(1);

    const skipped = countingClient(BOTH_MODELS);
    const explicit = await prepareAgentExec(
      { ...BASE_FLAGS, harness: "native", model: "gpt-5.3" },
      skipped.client,
      "acme",
      undefined,
      CLOUD_RUN_OPTIONS,
    );
    expect(explicit.harness).toBe("native");
    expect(explicit.model).toBe("gpt-5.3");
    expect(skipped.calls(), "explicit flags leave nothing to fill — no round trip").toBe(0);
  });
});
