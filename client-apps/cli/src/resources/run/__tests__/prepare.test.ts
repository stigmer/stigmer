// Unit tests for the prelude orchestrator: flag validation helpers, the
// vaults the new conversation uses (My vault unless --no-my-vault, then each
// --vault in order), and the layered engine/model seeds (flag, the
// agent's run defaults, the account preference), and the plan for --attach:
// an attached file inside a --workspace folder is a mention, any other is
// carried by the message, and nothing is uploaded here. Uploading is covered
// in files.test.ts and agent-exec.test.ts.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { create } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";
import { AgentSpecSchema } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/spec_pb";
import { Harness } from "@stigmer/apis/ai/stigmer/agentic/session/v1/enum_pb";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import type { Stigmer } from "@stigmer/client";
import { type AgentExecFlags, prepareAgentExec, validateHarness, validateMode, validateServiceTier, validateThinking } from "../prepare.js";

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
  it("accepts empty, stigmer and claude", () => {
    expect(() => validateHarness("")).not.toThrow();
    expect(() => validateHarness("stigmer")).not.toThrow();
    expect(() => validateHarness("claude")).not.toThrow();
  });

  it("rejects anything else before a network round trip", () => {
    expect(() => validateHarness("turbo")).toThrow(/must be "stigmer" or "claude" \(Claude Agent\)/);
  });

  it("refuses the Stigmer harness's former word like any other unknown word, with no alias", () => {
    expect(() => validateHarness("native")).toThrow(/invalid --harness value "native": must be "stigmer" or "claude" \(Claude Agent\)/);
  });

  it("rejects UI-only harness names that have no proto mapping", () => {
    // copilot/codex/etc. exist in display metadata but not on the wire —
    // accepting them here would stamp UNSPECIFIED and silently run on the
    // Stigmer harness.
    expect(() => validateHarness("copilot")).toThrow(/must be "stigmer" or "claude" \(Claude Agent\)/);
  });
});

const BASE_FLAGS: AgentExecFlags = {
  message: "hi",
  attach: [],
  fileIds: [],
  approveDefault: "",
  verbose: false,
  detach: false,
  workspace: [],
  branch: "",
  commit: "",
  vault: [],
  myVault: true,
  plugin: [],
  environment: "",
  model: "",
  autoApprove: false,
  mode: "",
  serviceTier: "",
  thinking: "",
  harness: "",
};

// prepareAgentExec asks the client only for what a flag names by id or by
// the account's defaults; nothing is uploaded, so a bare stub suffices.
const STUB_CLIENT = {} as unknown as Stigmer;

/** The shape of IdentityAccountPreferences the stubs below expose. */
interface StubPreferences {
  readonly defaultHarness?: string;
  readonly defaultStigmerModel?: string;
  readonly defaultClaudeModel?: string;
}

/** Stub whose whoAmI resolves an account carrying the given preferences. */
function clientWithPreferences(preferences: StubPreferences): Stigmer {
  return {
    run: {},
    identityAccount: {
      whoAmI: () => Promise.resolve({ spec: { preferences } }),
    },
  } as unknown as Stigmer;
}

/** Back-compat shorthand for the original Stigmer-harness-model-only stub. */
function clientWithPreference(defaultStigmerModel: string): Stigmer {
  return clientWithPreferences({ defaultStigmerModel });
}

/** Stub whose whoAmI rejects (auth failure, backend without the RPC, ...). */
function clientWithFailingWhoAmI(): Stigmer {
  return {
    run: {},
    identityAccount: {
      whoAmI: () => Promise.reject(new Error("unimplemented")),
    },
  } as unknown as Stigmer;
}

/** Preference stub that also counts whoAmI invocations (round-trip pin). */
function countingClient(preferences: StubPreferences): { client: Stigmer; calls: () => number } {
  let calls = 0;
  const client = {
    run: {},
    identityAccount: {
      whoAmI: () => {
        calls += 1;
        return Promise.resolve({ spec: { preferences } });
      },
    },
  } as unknown as Stigmer;
  return { client, calls: () => calls };
}

/** prepareAgentExec options as `run` passes them: the kind is served here. */
const SERVED_RUN_OPTIONS = { accountPreferencesAvailable: true } as const;

describe("prepareAgentExec files", () => {
  it("mentions a file in a --workspace folder, carries any other, and uploads nothing", async () => {
    const dir = mkdtempSync(join(tmpdir(), "prepare-attach-"));
    try {
      mkdirSync(join(dir, "repo"));
      writeFileSync(join(dir, "repo", "main.ts"), "x");
      writeFileSync(join(dir, "notes.md"), "y");
      const prepared = await prepareAgentExec(
        {
          ...BASE_FLAGS,
          workspace: [join(dir, "repo")],
          attach: [join(dir, "repo", "main.ts"), join(dir, "notes.md")],
        },
        STUB_CLIENT,
      );
      expect(prepared.resources.map((r) => r.name)).toEqual(["repo"]);
      expect(prepared.files.workspaceFileRefs).toEqual(["main.ts"]);
      expect(prepared.files.messageFiles.map((f) => f.path)).toEqual([join(dir, "notes.md")]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("prepareAgentExec vaults", () => {
  it("includes the person's My vault and names no shared vault by default", async () => {
    const prepared = await prepareAgentExec(BASE_FLAGS, STUB_CLIENT);
    expect(prepared.includeMyVault).toBe(true);
    expect(prepared.vaults).toEqual([]);
  });

  it("leaves My vault out under --no-my-vault", async () => {
    const prepared = await prepareAgentExec({ ...BASE_FLAGS, myVault: false }, STUB_CLIENT);
    expect(prepared.includeMyVault).toBe(false);
  });

  it("resolves each --vault in order, a slug in the run's organization", async () => {
    const prepared = await prepareAgentExec(
      { ...BASE_FLAGS, vault: ["support-tools", "platform/shared-keys"] },
      STUB_CLIENT,
      undefined,
      { org: "acme" },
    );
    expect(prepared.vaults.map((ref) => `${ref.org}/${ref.slug}`)).toEqual([
      "acme/support-tools",
      "platform/shared-keys",
    ]);
  });

  it("names no environment by default", async () => {
    const prepared = await prepareAgentExec(BASE_FLAGS, STUB_CLIENT);
    expect(prepared.environment).toBeUndefined();
  });

  it("resolves --environment, a slug in the run's organization", async () => {
    const prepared = await prepareAgentExec({ ...BASE_FLAGS, environment: "data-science" }, STUB_CLIENT, undefined, {
      org: "acme",
    });
    expect([prepared.environment?.kind, prepared.environment?.org, prepared.environment?.slug]).toEqual([
      ApiResourceKind.environment,
      "acme",
      "data-science",
    ]);
  });

  it("refuses a malformed --environment before anything is uploaded", async () => {
    await expect(prepareAgentExec({ ...BASE_FLAGS, environment: "a/b/c" }, STUB_CLIENT)).rejects.toThrow(
      "invalid --environment value 'a/b/c'",
    );
  });

  it("carries through scalar flags", async () => {
    const prepared = await prepareAgentExec(
      { ...BASE_FLAGS, message: "go", model: "claude", autoApprove: true, detach: true, mode: "plan", approveDefault: "Allow_All" },
      STUB_CLIENT,
    );
    expect(prepared.message).toBe("go");
    expect(prepared.model).toBe("claude");
    expect(prepared.autoApproveAll).toBe(true);
    expect(prepared.detach).toBe(true);
    expect(prepared.mode).toBe("plan");
    expect(prepared.approveDefault).toBe("allow-all");
  });

  it("refuses an unknown --approve-default before anything else", async () => {
    await expect(prepareAgentExec({ ...BASE_FLAGS, approveDefault: "maybe" }, STUB_CLIENT)).rejects.toThrow(/must be one of/);
  });
});

describe("prepareAgentExec account-preference model fill (oss#293)", () => {
  it("fills an omitted --model from the account preference on cloud", async () => {
    const prepared = await prepareAgentExec(
      BASE_FLAGS,
      clientWithPreference("claude-sonnet-4.6"),
      undefined,
      { accountPreferencesAvailable: true },
    );
    expect(prepared.model).toBe("claude-sonnet-4.6");
  });

  it("an explicit --model always outranks the preference", async () => {
    const prepared = await prepareAgentExec(
      { ...BASE_FLAGS, model: "gpt-5.3" },
      clientWithPreference("claude-sonnet-4.6"),
      undefined,
      { accountPreferencesAvailable: true },
    );
    expect(prepared.model).toBe("gpt-5.3");
  });

  it("never consults identity where the kind is not served", async () => {
    // The failing stub doubles as a call detector: a backend that does not
    // serve identity accounts must not even attempt whoAmI, so a rejecting
    // client cannot affect the result. (The gate is the
    // kind's tier, not the backend type — client/edition.ts resourceServedOn.)
    const prepared = await prepareAgentExec(
      BASE_FLAGS,
      clientWithFailingWhoAmI(),
      undefined,
      { accountPreferencesAvailable: false },
    );
    expect(prepared.model).toBe("");
  });

  it("falls through silently when whoAmI fails — a missing preference never fails a run", async () => {
    const prepared = await prepareAgentExec(
      BASE_FLAGS,
      clientWithFailingWhoAmI(),
      undefined,
      { accountPreferencesAvailable: true },
    );
    expect(prepared.model).toBe("");
  });

  it("stays empty when the account declares no Stigmer-harness default", async () => {
    const prepared = await prepareAgentExec(
      BASE_FLAGS,
      clientWithPreference(""),
      undefined,
      { accountPreferencesAvailable: true },
    );
    expect(prepared.model).toBe("");
  });
});

describe("prepareAgentExec harness resolution (oss#293)", () => {
  it("fills an omitted --harness from the account preference on cloud when the caller opts in (run)", async () => {
    const prepared = await prepareAgentExec(
      BASE_FLAGS,
      clientWithPreferences({ defaultHarness: "claude" }),
      undefined,
      SERVED_RUN_OPTIONS,
    );
    expect(prepared.harness).toBe("claude");
  });

  it("an explicit --harness always outranks the account preference", async () => {
    // The per-run escape hatch: a claude-preference user can still force a
    // Stigmer run without touching their settings.
    const prepared = await prepareAgentExec(
      { ...BASE_FLAGS, harness: "stigmer" },
      clientWithPreferences({ defaultHarness: "claude" }),
      undefined,
      SERVED_RUN_OPTIONS,
    );
    expect(prepared.harness).toBe("stigmer");
  });

  it("an explicit --harness resolves as given when the server serves no account preferences", async () => {
    const prepared = await prepareAgentExec(
      { ...BASE_FLAGS, harness: "claude" },
      STUB_CLIENT,
      undefined,
      { accountPreferencesAvailable: false },
    );
    expect(prepared.harness).toBe("claude");
  });

  it("treats a malformed persisted harness as undeclared", async () => {
    // A client must not trust stored data it did not write: anything outside
    // the shipped allowlist resolves as if no preference existed.
    const prepared = await prepareAgentExec(
      BASE_FLAGS,
      clientWithPreferences({ defaultHarness: "devin" }),
      undefined,
      SERVED_RUN_OPTIONS,
    );
    expect(prepared.harness).toBe("");
  });

  it("resolves empty when whoAmI fails — a missing preference never fails a run", async () => {
    const prepared = await prepareAgentExec(
      BASE_FLAGS,
      clientWithFailingWhoAmI(),
      undefined,
      SERVED_RUN_OPTIONS,
    );
    expect(prepared.harness).toBe("");
    expect(prepared.model).toBe("");
  });

  it("never consults identity on a local backend, even with the opt-in", async () => {
    // The failing stub doubles as a call detector, as in the model-fill suite.
    const prepared = await prepareAgentExec(
      BASE_FLAGS,
      clientWithFailingWhoAmI(),
      undefined,
      { accountPreferencesAvailable: false },
    );
    expect(prepared.harness).toBe("");
  });

  it("resolves empty when nothing is declared anywhere", async () => {
    const prepared = await prepareAgentExec(
      BASE_FLAGS,
      clientWithPreferences({}),
      undefined,
      SERVED_RUN_OPTIONS,
    );
    expect(prepared.harness).toBe("");
  });
});

describe("prepareAgentExec — the agent's run defaults come before the account's", () => {
  const AGENT_ON_CLAUDE = create(AgentSpecSchema, {
    harness: Harness.CLAUDE,
    runConfig: { modelName: "claude-opus-4-7" },
  });
  const ACCOUNT = { defaultHarness: "stigmer", defaultStigmerModel: "claude-sonnet-4-6", defaultClaudeModel: "claude-sonnet-5" };

  it("resolves an omitted --harness to the agent's engine and leaves the model to the agent", async () => {
    const prepared = await prepareAgentExec(
      BASE_FLAGS,
      clientWithPreferences(ACCOUNT),
      undefined,
      { ...SERVED_RUN_OPTIONS, agentSpec: AGENT_ON_CLAUDE },
    );
    expect(prepared.harness).toBe("claude");
    expect(prepared.model).toBe("");
  });

  it("an explicit --harness off the agent's engine takes the account model for that engine", async () => {
    const prepared = await prepareAgentExec(
      { ...BASE_FLAGS, harness: "stigmer" },
      clientWithPreferences(ACCOUNT),
      undefined,
      { ...SERVED_RUN_OPTIONS, agentSpec: AGENT_ON_CLAUDE },
    );
    expect(prepared.harness).toBe("stigmer");
    expect(prepared.model).toBe("claude-sonnet-4-6");
  });

  it("a Claude session takes the account's Claude model, from the account's engine or a flag", async () => {
    const onClaude = { defaultHarness: "claude", defaultStigmerModel: "claude-sonnet-4-6", defaultClaudeModel: "claude-sonnet-5" };
    const fromAccount = await prepareAgentExec(BASE_FLAGS, clientWithPreferences(onClaude), undefined, SERVED_RUN_OPTIONS);
    expect([fromAccount.harness, fromAccount.model]).toEqual(["claude", "claude-sonnet-5"]);
    const fromFlag = await prepareAgentExec({ ...BASE_FLAGS, harness: "claude" }, clientWithPreferences({ ...onClaude, defaultHarness: "stigmer" }), undefined, SERVED_RUN_OPTIONS);
    expect([fromFlag.harness, fromFlag.model]).toEqual(["claude", "claude-sonnet-5"]);
  });

  it("an agent naming an engine but no model keeps the account model fill", async () => {
    const prepared = await prepareAgentExec(
      BASE_FLAGS,
      clientWithPreferences(ACCOUNT),
      undefined,
      { ...SERVED_RUN_OPTIONS, agentSpec: create(AgentSpecSchema, { harness: Harness.CLAUDE }) },
    );
    expect(prepared.harness).toBe("claude");
    expect(prepared.model).toBe("claude-sonnet-5");
  });

  it("an explicit --model always wins, and alone it names no engine, neither the agent's nor the account's", async () => {
    const prepared = await prepareAgentExec(
      { ...BASE_FLAGS, model: "default" },
      clientWithPreferences({ ...ACCOUNT, defaultHarness: "claude" }),
      undefined,
      { ...SERVED_RUN_OPTIONS, agentSpec: AGENT_ON_CLAUDE },
    );
    expect(prepared.model).toBe("default");
    // The server reads a model named alone on Stigmer.
    expect(prepared.harness).toBe("");
  });

  it("--model with --harness keeps the engine named", async () => {
    const prepared = await prepareAgentExec(
      { ...BASE_FLAGS, model: "claude-opus-4-7", harness: "claude" },
      clientWithPreferences(ACCOUNT),
      undefined,
      { ...SERVED_RUN_OPTIONS, agentSpec: AGENT_ON_CLAUDE },
    );
    expect(prepared.harness).toBe("claude");
    expect(prepared.model).toBe("claude-opus-4-7");
  });

  it("an agent naming the Stigmer harness outranks an account that prefers claude", async () => {
    const prepared = await prepareAgentExec(
      BASE_FLAGS,
      clientWithPreferences({ ...ACCOUNT, defaultHarness: "claude" }),
      undefined,
      {
        ...SERVED_RUN_OPTIONS,
        agentSpec: create(AgentSpecSchema, {
          harness: Harness.STIGMER,
          runConfig: { modelName: "claude-opus-4-1" },
        }),
      },
    );
    expect(prepared.harness).toBe("stigmer");
    expect(prepared.model).toBe("");
  });
});

describe("prepareAgentExec harness-aware model fill (oss#293)", () => {
  const BOTH_MODELS: StubPreferences = {
    defaultStigmerModel: "claude-sonnet-4.6",
    defaultClaudeModel: "claude-opus-4-7",
  };

  it("fills the Claude model when the explicit harness is claude", async () => {
    const prepared = await prepareAgentExec(
      { ...BASE_FLAGS, harness: "claude" },
      clientWithPreferences(BOTH_MODELS),
      undefined,
      SERVED_RUN_OPTIONS,
    );
    expect(prepared.model).toBe("claude-opus-4-7");
  });

  it("fills the Claude model when the preference resolves the harness to claude", async () => {
    const prepared = await prepareAgentExec(
      BASE_FLAGS,
      clientWithPreferences({ ...BOTH_MODELS, defaultHarness: "claude" }),
      undefined,
      SERVED_RUN_OPTIONS,
    );
    expect(prepared.harness).toBe("claude");
    expect(prepared.model).toBe("claude-opus-4-7");
  });

  it("fills the Stigmer harness's model when the harness resolves stigmer or empty", async () => {
    const explicit = await prepareAgentExec(
      { ...BASE_FLAGS, harness: "stigmer" },
      clientWithPreferences(BOTH_MODELS),
      undefined,
      SERVED_RUN_OPTIONS,
    );
    expect(explicit.model).toBe("claude-sonnet-4.6");

    const unset = await prepareAgentExec(
      BASE_FLAGS,
      clientWithPreferences(BOTH_MODELS),
      undefined,
      SERVED_RUN_OPTIONS,
    );
    expect(unset.model).toBe("claude-sonnet-4.6");
  });

  it("an explicit --model outranks the harness-matched preference", async () => {
    const prepared = await prepareAgentExec(
      { ...BASE_FLAGS, harness: "claude", model: "gpt-5.3" },
      clientWithPreferences(BOTH_MODELS),
      undefined,
      SERVED_RUN_OPTIONS,
    );
    expect(prepared.model).toBe("gpt-5.3");
  });

  it("draft with an explicit --harness claude fills the Claude model despite no harness opt-in", async () => {
    // The opt-in scopes only the silent preference fill; the model fill follows
    // whatever harness the user explicitly chose.
    const prepared = await prepareAgentExec(
      { ...BASE_FLAGS, harness: "claude" },
      clientWithPreferences(BOTH_MODELS),
      undefined,
      { accountPreferencesAvailable: true },
    );
    expect(prepared.harness).toBe("claude");
    expect(prepared.model).toBe("claude-opus-4-7");
  });

  it("serves both fills from one whoAmI round trip, and none when both flags are explicit", async () => {
    const single = countingClient({ ...BOTH_MODELS, defaultHarness: "claude" });
    const filled = await prepareAgentExec(BASE_FLAGS, single.client, undefined, SERVED_RUN_OPTIONS);
    expect(filled.harness).toBe("claude");
    expect(filled.model).toBe("claude-opus-4-7");
    expect(single.calls(), "harness + model fills share one whoAmI").toBe(1);

    const skipped = countingClient(BOTH_MODELS);
    const explicit = await prepareAgentExec(
      { ...BASE_FLAGS, harness: "stigmer", model: "gpt-5.3" },
      skipped.client,
      undefined,
      SERVED_RUN_OPTIONS,
    );
    expect(explicit.harness).toBe("stigmer");
    expect(explicit.model).toBe("gpt-5.3");
    expect(skipped.calls(), "explicit flags leave nothing to fill — no round trip").toBe(0);
  });
});
