// Contract for the model key step `stigmer up` runs (stigmer#3036): which key
// it checks and where, when it asks, what it says, and what it saves.
//
//   - It checks the key the runner will send: the saved one, or an exported
//     ANTHROPIC_API_KEY, which wins; on the key route against Anthropic, and
//     through a gateway against the gateway. A gateway with no key, a cloud
//     backend or the proxy is not checked.
//   - On a terminal it asks when no key is set (and one would serve), or when
//     the saved key is rejected; it says why and where to get a key first,
//     asks again after a rejection, and saves an accepted or unanswered key.
//   - It never prompts over an exported key, and never off a terminal.
//
// The config, the prompt and the check are replaced; nothing is written to
// disk and nothing is dialled.

import { describe, expect, it } from "vitest";
import type { Config } from "../../config/config.js";
import { readLlm, setLlm } from "../llm-config.js";
import type { KeyCheck } from "../key-check.js";
import {
  anthropicKeyTarget,
  ENV_KEY_REJECTED,
  KEY_QUESTION,
  KEY_REASON_LINES,
  type KeyStepDeps,
  modelKeyStep,
} from "../model-key-step.js";

interface Harness {
  readonly deps: KeyStepDeps;
  readonly said: () => string;
  readonly asked: string[];
  readonly checked: Array<{ key: string; baseUrl: string }>;
  readonly saved: Config[];
}

function harness(options: {
  env?: NodeJS.ProcessEnv;
  interactive?: boolean;
  savedKey?: string;
  answers?: string[];
  checks?: Record<string, KeyCheck>;
}): Harness {
  let config: Config = { backend: { local: {} } };
  if (options.savedKey !== undefined) config = setLlm(config, { provider: "anthropic", api_key: options.savedKey });
  const answers = [...(options.answers ?? [])];
  let said = "";
  const asked: string[] = [];
  const checked: Array<{ key: string; baseUrl: string }> = [];
  const saved: Config[] = [];
  return {
    deps: {
      env: options.env ?? {},
      interactive: options.interactive ?? false,
      loadConfig: () => config,
      saveConfig: (next) => {
        saved.push(next);
        config = next;
      },
      promptSecret: async (question) => {
        asked.push(question);
        return answers.shift() ?? "";
      },
      write: (text) => {
        said += text;
      },
      check: async (key, baseUrl) => {
        checked.push({ key, baseUrl });
        return options.checks?.[key] ?? "accepted";
      },
    },
    said: () => said,
    asked,
    checked,
    saved,
  };
}

const GATEWAY = "http://127.0.0.1:4100";

describe("anthropicKeyTarget", () => {
  it("is Anthropic's own API for a key, and the gateway for a gateway with a key", () => {
    expect(anthropicKeyTarget({ ANTHROPIC_API_KEY: "k" })).toEqual({ baseUrl: "" });
    expect(anthropicKeyTarget({ ANTHROPIC_API_KEY: "k", ANTHROPIC_BASE_URL: GATEWAY })).toEqual({ baseUrl: GATEWAY });
  });

  it("is nothing Stigmer can judge for no key, a keyless gateway, a cloud backend or the proxy", () => {
    expect(anthropicKeyTarget({})).toBeNull();
    expect(anthropicKeyTarget({ ANTHROPIC_BASE_URL: GATEWAY })).toBeNull();
    expect(anthropicKeyTarget({ ANTHROPIC_API_KEY: "k", STIGMER_ANTHROPIC_BACKEND: "vertex", CLOUD_ML_REGION: "us" })).toBeNull();
    expect(anthropicKeyTarget({ ANTHROPIC_API_KEY: "k", STIGMER_PROXY_ENDPOINT: "http://proxy" })).toBeNull();
  });
});

describe("modelKeyStep — off a terminal", () => {
  it("checks the saved key and reports the answer, asking nothing", async () => {
    const h = harness({ savedKey: "sk-ant-saved", checks: { "sk-ant-saved": "rejected" } });
    expect(await modelKeyStep(h.deps)).toEqual({ check: "rejected", fromEnvironment: false });
    expect(h.checked).toEqual([{ key: "sk-ant-saved", baseUrl: "" }]);
    expect(h.asked).toEqual([]);
    expect(h.said()).toBe("");
  });

  it("checks an exported key, which wins over the saved one, against the gateway it goes to", async () => {
    const h = harness({
      env: { ANTHROPIC_API_KEY: "sk-ant-exported", ANTHROPIC_BASE_URL: GATEWAY },
      savedKey: "sk-ant-saved",
      checks: { "sk-ant-exported": "unchecked" },
    });
    expect(await modelKeyStep(h.deps)).toEqual({ check: "unchecked", fromEnvironment: true });
    expect(h.checked).toEqual([{ key: "sk-ant-exported", baseUrl: GATEWAY }]);
  });

  it("checks nothing and asks nothing when there is no key", async () => {
    const h = harness({});
    expect(await modelKeyStep(h.deps)).toBeUndefined();
    expect(h.checked).toEqual([]);
    expect(h.asked).toEqual([]);
  });
});

describe("CLI-17 stigmer up checks the model key before calling it ready, and on a terminal asks again when it is rejected", () => {
  it("asks a person with no key why first, checks the answer and saves it", async () => {
    const h = harness({ interactive: true, answers: ["sk-ant-new"] });
    expect(await modelKeyStep(h.deps)).toEqual({ check: "accepted", fromEnvironment: false });
    expect(h.said()).toContain(KEY_REASON_LINES.join("\n"));
    expect(h.said()).toContain("https://console.anthropic.com/settings/keys");
    expect(h.said()).toContain("Checking with Anthropic… ✓ accepted");
    expect(h.said()).toContain("Saved for this computer's agents.");
    expect(h.asked).toEqual([KEY_QUESTION]);
    expect(readLlm(h.saved[0]!)).toEqual({ provider: "anthropic", api_key: "sk-ant-new" });
  });

  it("says a saved key was rejected, asks again after each rejection, and saves the key Anthropic takes", async () => {
    const h = harness({
      interactive: true,
      savedKey: "sk-ant-old",
      answers: ["sk-ant-typo", "sk-ant-right"],
      checks: { "sk-ant-old": "rejected", "sk-ant-typo": "rejected" },
    });
    expect(await modelKeyStep(h.deps)).toEqual({ check: "accepted", fromEnvironment: false });
    expect(h.said()).toContain("Anthropic rejected the saved key.");
    expect(h.said()).toContain(
      "✗ Anthropic rejected this key. Check that it is a valid, active API key, then paste it again, or press Enter to skip.",
    );
    expect(h.asked).toHaveLength(2);
    expect(h.saved).toHaveLength(1);
    expect(readLlm(h.saved[0]!)?.api_key).toBe("sk-ant-right");
  });

  it("saves a key Anthropic did not answer for, and says so", async () => {
    const h = harness({ interactive: true, answers: ["sk-ant-quiet"], checks: { "sk-ant-quiet": "unchecked" } });
    expect(await modelKeyStep(h.deps)).toEqual({ check: "unchecked", fromEnvironment: false });
    expect(h.said()).toContain("Anthropic didn't answer, so the key is saved but not checked.");
    expect(readLlm(h.saved[0]!)?.api_key).toBe("sk-ant-quiet");
  });

  it("keeps a rejected saved key when the person presses Enter, and reports it rejected", async () => {
    const h = harness({ interactive: true, savedKey: "sk-ant-old", answers: [""], checks: { "sk-ant-old": "rejected" } });
    expect(await modelKeyStep(h.deps)).toEqual({ check: "rejected", fromEnvironment: false });
    expect(h.saved).toEqual([]);
  });

  it("skips on Enter with no key, saving and checking nothing", async () => {
    const h = harness({ interactive: true, answers: [""] });
    expect(await modelKeyStep(h.deps)).toBeUndefined();
    expect(h.saved).toEqual([]);
    expect(h.checked).toEqual([]);
  });

  it("never prompts over an exported key Anthropic rejects: one line says what to do", async () => {
    const h = harness({ interactive: true, env: { ANTHROPIC_API_KEY: "sk-ant-bad" }, checks: { "sk-ant-bad": "rejected" } });
    expect(await modelKeyStep(h.deps)).toEqual({ check: "rejected", fromEnvironment: true });
    expect(h.asked).toEqual([]);
    expect(h.said()).toBe(`${ENV_KEY_REJECTED}\n`);
  });

  it("asks nothing where a key would not serve: a cloud backend or the proxy", async () => {
    const vertex = harness({ interactive: true, env: { STIGMER_ANTHROPIC_BACKEND: "vertex", CLOUD_ML_REGION: "us" } });
    expect(await modelKeyStep(vertex.deps)).toBeUndefined();
    const proxy = harness({ interactive: true, env: { STIGMER_PROXY_ENDPOINT: "http://proxy" } });
    expect(await modelKeyStep(proxy.deps)).toBeUndefined();
    expect([...vertex.asked, ...proxy.asked]).toEqual([]);
  });

  it("checks a pasted key against the gateway the shell set", async () => {
    const h = harness({ interactive: true, env: { ANTHROPIC_BASE_URL: GATEWAY }, answers: ["sk-ant-new"] });
    await modelKeyStep(h.deps);
    expect(h.checked).toEqual([{ key: "sk-ant-new", baseUrl: GATEWAY }]);
  });
});
