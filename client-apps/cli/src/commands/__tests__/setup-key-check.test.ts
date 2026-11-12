// Command-level contract for `stigmer setup --provider anthropic --api-key`
// (stigmer#3036): the key is checked with Anthropic where the runner would
// send it before it is saved. A key Anthropic rejects ends the command with
// exit code 1, its sentence and where to get a key, and nothing is saved; a
// key Anthropic did not answer for is saved, with a line saying so; a key
// Anthropic took is saved quietly; a key bound for a cloud backend is not
// Stigmer's to judge and is saved unchecked by Stigmer.
//
// The config file, the check and the daemon probe are replaced; the command
// tree, the flag parsing, the decision core and the result card are real.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Config } from "../../config/config.js";
import { CliExitError } from "../../errors/cli-exit-error.js";
import type { KeyCheck } from "../../local/key-check.js";
import { readLlm } from "../../local/llm-config.js";
import { buildProgram } from "../../program.js";

const io = vi.hoisted(() => ({
  saved: [] as Config[],
  checked: [] as Array<{ key: string; baseUrl: string }>,
  answers: {} as Record<string, KeyCheck>,
}));

vi.mock("../../config/config.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../config/config.js")>();
  return {
    ...actual,
    load: () => actual.getDefault(),
    save: (config: Config) => {
      io.saved.push(config);
    },
  };
});

vi.mock("../../local/key-check.js", () => ({
  checkAnthropicKey: async (key: string, baseUrl: string): Promise<KeyCheck> => {
    io.checked.push({ key, baseUrl });
    return io.answers[key] ?? "accepted";
  },
}));

vi.mock("../../local/daemon/launch.js", () => ({ isRunning: async () => false }));

const SHELL_KEYS = ["ANTHROPIC_API_KEY", "ANTHROPIC_BASE_URL", "STIGMER_ANTHROPIC_BACKEND", "CLOUD_ML_REGION", "STIGMER_PROXY_ENDPOINT"];
let shell: Record<string, string | undefined> = {};

beforeEach(() => {
  io.saved.length = 0;
  io.checked.length = 0;
  io.answers = {};
  shell = Object.fromEntries(SHELL_KEYS.map((key) => [key, process.env[key]]));
  for (const key of SHELL_KEYS) delete process.env[key];
});

afterEach(() => {
  for (const [key, value] of Object.entries(shell)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

interface Card {
  readonly hints?: readonly string[];
}

async function setup(...args: string[]): Promise<Card> {
  const program = buildProgram();
  program.exitOverride();
  let stdout = "";
  const outSpy = vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    stdout += String(chunk);
    return true;
  });
  const errSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  try {
    await program.parseAsync(["node", "stigmer", "setup", ...args, "--json"]);
  } finally {
    outSpy.mockRestore();
    errSpy.mockRestore();
  }
  return JSON.parse(stdout) as Card;
}

describe("CLI-17 stigmer setup --api-key checks the key with Anthropic before saving it", () => {
  it("refuses a key Anthropic rejects with exit code 1, saving nothing", async () => {
    io.answers = { "sk-ant-bad": "rejected" };

    const error = await setup("--provider", "anthropic", "--api-key", "sk-ant-bad").catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(CliExitError);
    expect((error as CliExitError).exitCode).toBe(1);
    expect((error as CliExitError).message).toBe("Anthropic rejected this key. Check that it is a valid, active API key.");
    expect((error as CliExitError).hints).toEqual(["Nothing was saved. Get a key at https://console.anthropic.com/settings/keys"]);
    expect(io.saved).toEqual([]);
  });

  it("saves a key Anthropic did not answer for, and says it was not checked", async () => {
    io.answers = { "sk-ant-quiet": "unchecked" };

    const card = await setup("--provider", "anthropic", "--api-key", "sk-ant-quiet");

    expect(readLlm(io.saved[0]!)).toEqual({ provider: "anthropic", api_key: "sk-ant-quiet" });
    expect(card.hints).toContain("Anthropic didn't answer, so the key is saved but not checked.");
  });

  it("saves a key Anthropic took, checked where the runner sends it", async () => {
    process.env.ANTHROPIC_BASE_URL = "http://127.0.0.1:4100";

    const card = await setup("--provider", "anthropic", "--api-key", "sk-ant-good");

    expect(io.checked).toEqual([{ key: "sk-ant-good", baseUrl: "http://127.0.0.1:4100" }]);
    expect(readLlm(io.saved[0]!)?.api_key).toBe("sk-ant-good");
    expect(card.hints ?? []).not.toContain("Anthropic didn't answer, so the key is saved but not checked.");
  });

  it("checks nothing for a key bound for a cloud backend", async () => {
    process.env.STIGMER_ANTHROPIC_BACKEND = "vertex";
    process.env.CLOUD_ML_REGION = "us-east5";

    await setup("--provider", "anthropic", "--api-key", "sk-ant-any");

    expect(io.checked).toEqual([]);
    expect(readLlm(io.saved[0]!)?.api_key).toBe("sk-ant-any");
  });
});
