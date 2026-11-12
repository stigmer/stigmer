import { afterEach, describe, expect, it, vi } from "vitest";
import type { Config } from "../../../config/config.js";

const checks = vi.hoisted(() => [] as Array<{ key: string; baseUrl: string }>);
vi.mock("../../key-check.js", () => ({
  checkAnthropicKey: async (key: string, baseUrl: string) => {
    checks.push({ key, baseUrl });
    return "accepted" as const;
  },
}));
import { readLlm } from "../../llm-config.js";
import { readOperator } from "../../operator-config.js";
import {
  PROVIDER_CHOICES,
  applyChoice,
  applyOperatorIdentity,
  buildLlmForChoice,
  buildOperatorForInputs,
  runInteractiveWizard,
  runKeyStep,
  type WizardKeyDeps,
} from "../wizard.js";
import type { KeyCheck } from "../../key-check.js";
import { ENV_KEY_REJECTED } from "../../model-key-step.js";

function config(local?: unknown): Config {
  return { backend: { local } };
}

// Regression pin: every provider offered by `stigmer setup` promises an
// execution path the Stigmer harness must actually serve. The runner constructs
// Anthropic clients only and the registry's Stigmer-harness entries are all
// Anthropic — so this list is anthropic + skip, full stop. If this test fails
// because a provider was added, the Stigmer harness and model registry must gain
// real support for it first (see sdk/react DISABLED_PROVIDERS for the same
// decision on the UI side).
describe("PROVIDER_CHOICES", () => {
  it("offers exactly anthropic and skip", () => {
    expect([...PROVIDER_CHOICES]).toEqual(["anthropic", "skip"]);
  });
});

describe("buildLlmForChoice", () => {
  it("persists provider and key only — there is no model concept, the registry owns it (oss#314)", () => {
    expect(buildLlmForChoice("anthropic")).toEqual({ provider: "anthropic" });
    expect(buildLlmForChoice("anthropic", { apiKey: "k" })).toEqual({
      provider: "anthropic",
      api_key: "k",
    });
  });

  it("returns undefined for skip (clears config)", () => {
    expect(buildLlmForChoice("skip")).toBeUndefined();
  });
});

describe("applyChoice", () => {
  it("writes the selection while preserving siblings", () => {
    const cfg = config({ temporal: { managed: true }, llm: { provider: "anthropic", model: "stale" } });
    const updated = applyChoice(cfg, "anthropic", { apiKey: "k" });
    expect(readLlm(updated)).toEqual({ provider: "anthropic", api_key: "k" });
    expect((updated.backend.local as { temporal: unknown }).temporal).toEqual({ managed: true });
  });

  it("skip clears the llm section", () => {
    const updated = applyChoice(config({ llm: { provider: "anthropic" } }), "skip");
    expect(readLlm(updated)).toBeUndefined();
  });
});

describe("buildOperatorForInputs", () => {
  it("persists email (and optional name), trimmed", () => {
    expect(buildOperatorForInputs(" ada@example.com ", "")).toEqual({ email: "ada@example.com" });
    expect(buildOperatorForInputs("ada@example.com", " Ada ")).toEqual({
      email: "ada@example.com",
      name: "Ada",
    });
  });

  it("returns undefined for empty inputs — nothing to persist, identity stays anonymous", () => {
    expect(buildOperatorForInputs("", "")).toBeUndefined();
    expect(buildOperatorForInputs("  ", "")).toBeUndefined();
  });

  // The server's boot rules, surfaced at setup time (oss#796): a malformed
  // identity must never be persisted only to fail the next `stigmer up`.
  it("refuses what the server's boot check would refuse", () => {
    expect(() => buildOperatorForInputs("not-an-email", "")).toThrow(/missing '@'/);
    expect(() => buildOperatorForInputs("", "Ada")).toThrow(/set both or neither/);
  });
});

describe("applyOperatorIdentity", () => {
  it("writes the identity while preserving siblings", () => {
    const cfg = config({ temporal: { managed: true }, llm: { provider: "anthropic" } });
    const updated = applyOperatorIdentity(cfg, "ada@example.com", "Ada");
    expect(readOperator(updated)).toEqual({ email: "ada@example.com", name: "Ada" });
    expect(readLlm(updated)).toEqual({ provider: "anthropic" });
    expect((updated.backend.local as { temporal: unknown }).temporal).toEqual({ managed: true });
  });

  it("empty inputs leave the config unchanged (skip, not clear)", () => {
    const cfg = config({ operator: { email: "keep@example.com" } });
    const updated = applyOperatorIdentity(cfg, "", "");
    expect(readOperator(updated)).toEqual({ email: "keep@example.com" });
  });
});

// stigmer setup's key prompt is stigmer up's: it says why, checks the key with
// Anthropic, asks again on a rejection; an exported key is checked and said.
describe("CLI-17 stigmer setup checks the key with Anthropic and asks again when it is rejected", () => {
  function deps(env: NodeJS.ProcessEnv, answers: string[], checks: Record<string, KeyCheck>): WizardKeyDeps & { said: () => string } {
    let said = "";
    return {
      env,
      promptSecret: async () => answers.shift() ?? "",
      write: (text) => {
        said += text;
      },
      check: async (key) => checks[key] ?? "accepted",
      said: () => said,
    };
  }

  it("asks again after a rejected key and saves the one Anthropic takes", async () => {
    const d = deps({}, ["sk-ant-typo", "sk-ant-right"], { "sk-ant-typo": "rejected" });
    const updated = await runKeyStep(config({}), d);
    expect(readLlm(updated)).toEqual({ provider: "anthropic", api_key: "sk-ant-right" });
    expect(d.said()).toContain("Anthropic rejected this key.");
    expect(d.said()).toContain("Stigmer uses your own Anthropic key");
  });

  it("says what Anthropic made of an exported key, and what to do when it was rejected", async () => {
    const good = deps({ ANTHROPIC_API_KEY: "sk-ant-env" }, [], {});
    expect(readLlm(await runKeyStep(config({}), good))).toEqual({ provider: "anthropic" });
    expect(good.said()).toContain("Using ANTHROPIC_API_KEY from environment (checked with Anthropic just now)");

    const bad = deps({ ANTHROPIC_API_KEY: "sk-ant-env" }, [], { "sk-ant-env": "rejected" });
    await runKeyStep(config({}), bad);
    expect(bad.said()).toContain("Using ANTHROPIC_API_KEY from environment (rejected by Anthropic)");
    expect(bad.said()).toContain(ENV_KEY_REJECTED);
  });

  it("clears the section on Enter", async () => {
    const d = deps({}, [""], {});
    expect(readLlm(await runKeyStep(config({ llm: { provider: "anthropic" } }), d))).toBeUndefined();
  });

  it("asks nothing of Anthropic for a key bound for a cloud backend: it is saved, not checked here", async () => {
    const d = deps({ STIGMER_ANTHROPIC_BACKEND: "vertex", CLOUD_ML_REGION: "us-east5" }, ["sk-ant-any"], {});
    expect(readLlm(await runKeyStep(config({}), d))).toEqual({ provider: "anthropic", api_key: "sk-ant-any" });
    expect(d.said()).not.toContain("Checking with Anthropic");
  });
});

describe("runInteractiveWizard", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    checks.length = 0;
  });

  it("checks an exported key with Anthropic on the terminal's behalf, and asks nothing the shell already says", async () => {
    let said = "";
    vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
      said += String(chunk);
      return true;
    });
    const updated = await runInteractiveWizard(config({}), {
      ANTHROPIC_API_KEY: "sk-ant-env",
      STIGMER_OPERATOR_EMAIL: "ada@example.com",
    });
    expect(readLlm(updated)).toEqual({ provider: "anthropic" });
    expect(checks).toEqual([{ key: "sk-ant-env", baseUrl: "" }]);
    expect(said).toContain("Using ANTHROPIC_API_KEY from environment (checked with Anthropic just now)");
  });
});

