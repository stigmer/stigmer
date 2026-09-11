/**
 * Pins the harness registry's two load-bearing properties — ORDER and ERROR
 * POSTURE — and the byte-pinned activity names.
 *
 * Order: boot in declaration order, one at a time (the Cursor interceptors
 * must precede anything that dials the control plane); shutdown in reverse.
 * Posture: boot validates the table before touching any adapter and fails
 * fast at the first rejection; shutdown and release continue past a failing
 * adapter and surface every failure in one AggregateError. Names: the map
 * must equal the server's constants byte for byte; the runner cannot import
 * the server, so the literals are asserted here and the server's file is
 * cited beside them.
 */

import { describe, it, expect } from "vitest";

import { testConfig } from "../../__test-utils__/config-fixture.js";
import { DEEP_AGENT_VISION_PROFILE } from "../../shared/attachment-vision.js";
import { HARNESS_ACTIVITY_NAMES, bootHarnesses, releaseHarnessSession, shutdownHarnesses } from "../registry.js";
import type { HarnessAdapter } from "../types.js";

interface StubBehaviour {
  readonly bootRejects?: Error;
  readonly shutdownRejects?: Error;
  readonly releaseRejects?: Error;
}

/** An adapter that only records lifecycle calls into a shared, ordered log. */
function stubAdapter(name: string, log: string[], behaviour: StubBehaviour = {}): HarnessAdapter {
  return {
    name,
    capabilities: {
      pausePrimitive: "interrupt",
      stateIdSource: "deterministic",
      systemPrompt: true,
      subAgents: false,
      toolRestriction: true,
      visionProfile: DEEP_AGENT_VISION_PROFILE,
    },
    async boot() {
      log.push(`boot:${name}`);
      if (behaviour.bootRejects) throw behaviour.bootRejects;
    },
    async shutdown() {
      log.push(`shutdown:${name}`);
      if (behaviour.shutdownRejects) throw behaviour.shutdownRejects;
    },
    async releaseSession(sessionId) {
      log.push(`release:${name}:${sessionId}`);
      if (behaviour.releaseRejects) throw behaviour.releaseRejects;
    },
    async runTurn() {
      throw new Error(`${name}: runTurn is not under test here`);
    },
  };
}

describe("HARNESS_ACTIVITY_NAMES", () => {
  it("equals the server's byte-pinned activity names (stigmer-server temporal/agentexecution/names.ts)", () => {
    expect(HARNESS_ACTIVITY_NAMES.cursor).toBe("ExecuteCursor");
    expect(HARNESS_ACTIVITY_NAMES["deep-agent"]).toBe("ExecuteDeepAgent");
    expect(Object.keys(HARNESS_ACTIVITY_NAMES).sort()).toEqual(["cursor", "deep-agent"]);
  });
});

describe("bootHarnesses", () => {
  it("boots adapters in declaration order, one at a time", async () => {
    const log: string[] = [];
    await bootHarnesses([stubAdapter("first", log), stubAdapter("second", log), stubAdapter("third", log)], testConfig());
    expect(log).toEqual(["boot:first", "boot:second", "boot:third"]);
  });

  it("hands every adapter the same config", async () => {
    const seen: unknown[] = [];
    const config = testConfig({ taskQueue: "registry-test-queue" });
    const adapters = ["a", "b"].map((name) => ({
      ...stubAdapter(name, []),
      async boot(c: unknown) {
        seen.push(c);
      },
    }));
    await bootHarnesses(adapters, config);
    expect(seen, "each adapter must receive the one worker config").toEqual([config, config]);
  });

  it("refuses duplicate adapter names before booting anything", async () => {
    const log: string[] = [];
    const adapters = [stubAdapter("cursor", log), stubAdapter("other", log), stubAdapter("cursor", log)];
    await expect(bootHarnesses(adapters, testConfig())).rejects.toThrow(/duplicate adapter name 'cursor'/);
    expect(log, "a table with a duplicate must not boot even its first adapter").toEqual([]);
  });

  it("fails fast: the first rejection propagates and later adapters never boot", async () => {
    const log: string[] = [];
    const adapters = [
      stubAdapter("first", log),
      stubAdapter("broken", log, { bootRejects: new Error("interceptor install failed") }),
      stubAdapter("third", log),
    ];
    await expect(bootHarnesses(adapters, testConfig())).rejects.toThrow("interceptor install failed");
    expect(log).toEqual(["boot:first", "boot:broken"]);
  });

  it("boots an empty table as a no-op", async () => {
    await expect(bootHarnesses([], testConfig())).resolves.toBeUndefined();
  });
});

describe("shutdownHarnesses", () => {
  it("shuts adapters down in reverse declaration order", async () => {
    const log: string[] = [];
    await shutdownHarnesses([stubAdapter("first", log), stubAdapter("second", log), stubAdapter("third", log)]);
    expect(log).toEqual(["shutdown:third", "shutdown:second", "shutdown:first"]);
  });

  it("continues past a failing adapter and reports every failure in one AggregateError", async () => {
    const log: string[] = [];
    const adapters = [
      stubAdapter("first", log, { shutdownRejects: new Error("first leaked") }),
      stubAdapter("second", log),
      stubAdapter("third", log, { shutdownRejects: new Error("third leaked") }),
    ];
    const failure = await shutdownHarnesses(adapters).catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(AggregateError);
    const aggregate = failure as AggregateError;
    expect(aggregate.message).toContain("third: shutdown rejected: third leaked");
    expect(aggregate.message).toContain("first: shutdown rejected: first leaked");
    expect(aggregate.errors.map((e: Error) => e.message)).toEqual([
      "third: shutdown rejected: third leaked",
      "first: shutdown rejected: first leaked",
    ]);
    expect(log, "every adapter must be shut down even when an earlier one failed").toEqual([
      "shutdown:third",
      "shutdown:second",
      "shutdown:first",
    ]);
  });

  it("preserves the original error as the cause of each reported failure", async () => {
    const original = new Error("socket already closed");
    const failure = await shutdownHarnesses([stubAdapter("only", [], { shutdownRejects: original })]).catch((e: unknown) => e);
    expect((failure as AggregateError).errors[0]?.cause).toBe(original);
  });
});

describe("releaseHarnessSession", () => {
  it("tells every adapter, in declaration order, with the session id", async () => {
    const log: string[] = [];
    await releaseHarnessSession([stubAdapter("first", log), stubAdapter("second", log)], "ses-42");
    expect(log).toEqual(["release:first:ses-42", "release:second:ses-42"]);
  });

  it("continues past a failing adapter and reports the failure with the session id", async () => {
    const log: string[] = [];
    const adapters = [
      stubAdapter("first", log, { releaseRejects: new Error("executor busy") }),
      stubAdapter("second", log),
    ];
    const failure = await releaseHarnessSession(adapters, "ses-7").catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(AggregateError);
    expect((failure as AggregateError).message).toContain("releaseSession('ses-7') failed");
    expect((failure as AggregateError).errors.map((e: Error) => e.message)).toEqual([
      "first: releaseSession('ses-7') rejected: executor busy",
    ]);
    expect(log).toEqual(["release:first:ses-7", "release:second:ses-7"]);
  });
});
