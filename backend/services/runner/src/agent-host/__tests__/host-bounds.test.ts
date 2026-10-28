/**
 * A hosted adapter boots with the operator's bounds the runner was given,
 * as an in-process adapter does: the runner hands them across the host's
 * wire (`supervisor.ts`) and the host builds its adapters' `Config` from
 * them (`host.ts`). The Claude engine runs in the host and gives every MCP
 * server it is served the open-operation bound as its per-call timeout, so a
 * default in its place would cut a call the runtime still allows.
 */
import { describe, expect, it } from "vitest";

import { CLAUDE_CAPABILITIES } from "../../activities/execute-claude/claude-capabilities.js";
import { testConfig } from "../../__test-utils__/config-fixture.js";
import { loopbackHostedRow } from "../../__test-utils__/loopback-host.js";
import type { Config } from "../../config.js";

const BOUNDS = {
  cursorStreamStallTimeoutMs: 11_000,
  openOperationMaxMs: 7_200_000,
  shellTimeoutMaxSeconds: 13,
  shellBackgroundEnabled: false,
  workspaceLockTimeoutMs: 17_000,
} as const;

describe("the agent host's adapters", () => {
  it("boot with the operator's bounds the runner was given, the open-operation bound among them", async () => {
    const booted: Config[] = [];
    const row = loopbackHostedRow({
      harness: "claude",
      adapter: {
        name: "bounds-probe",
        capabilities: CLAUDE_CAPABILITIES,
        boot: async (config) => void booted.push(config),
        shutdown: async () => {},
        releaseSession: async () => {},
        runTurn: async () => ({ kind: "completed" }),
      },
    });

    await row.adapter.boot(testConfig(BOUNDS));
    await row.adapter.shutdown();

    expect(booted).toHaveLength(1);
    expect(booted[0]).toMatchObject(BOUNDS);
  });
});
