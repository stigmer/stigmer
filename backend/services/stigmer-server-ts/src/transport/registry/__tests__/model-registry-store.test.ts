/**
 * Model-registry store unit tests, pinning the Go refresh semantics
 * (model_registry_store.go): the sanity gate (parse + ≥1 model), keep-
 * current-on-failure, warn-then-debug failure logging with reset on
 * success, the size cap, and the fail-loud bundled-snapshot guard.
 */
import { describe, expect, it } from "vitest";

import { createLogger } from "../../../boot/logger.js";
import {
  MODEL_REGISTRY_MAX_BYTES,
  ModelRegistryStore,
} from "../model-registry-store.js";

const VALID_BUNDLE = JSON.stringify({ models: [{ id: "anthropic/claude" }] });
const UPGRADED = JSON.stringify({
  models: [{ id: "anthropic/claude" }, { id: "openai/gpt" }],
});

function capturingLogger() {
  const lines: Array<{ level: string; message: string }> = [];
  return {
    lines,
    logger: createLogger({
      level: "debug",
      pretty: false,
      write: (line) =>
        lines.push(JSON.parse(line) as { level: string; message: string }),
    }),
  };
}

function store(
  fetchImpl: typeof fetch,
  logger = capturingLogger().logger,
): ModelRegistryStore {
  return new ModelRegistryStore({
    bundledDocument: VALID_BUNDLE,
    upstreamOrigin: "http://upstream.test",
    refreshEnabled: true,
    logger,
    fetchImpl,
  });
}

describe("ModelRegistryStore", () => {
  it("refuses to construct on an invalid bundled snapshot (build defect, fail loud)", () => {
    expect(
      () =>
        new ModelRegistryStore({
          bundledDocument: JSON.stringify({ models: [] }),
          upstreamOrigin: "http://upstream.test",
          refreshEnabled: true,
          logger: capturingLogger().logger,
        }),
    ).toThrow(/no models/);
  });

  it("applies an upstream document that passes the sanity gate", async () => {
    const subject = store(async () => new Response(UPGRADED, { status: 200 }));

    await subject.refreshOnce();

    expect(subject.document()).toBe(UPGRADED);
  });

  it.each([
    ["non-JSON body", "not json at all"],
    ["empty models array", JSON.stringify({ models: [] })],
    ["missing models key", JSON.stringify({ descriptors: [] })],
  ])(
    "keeps the current document when the upstream serves %s",
    async (_case, body) => {
      const subject = store(async () => new Response(body, { status: 200 }));

      await subject.refreshOnce();

      expect(subject.document()).toBe(VALID_BUNDLE);
    },
  );

  it("keeps the current document on upstream errors and oversized bodies", async () => {
    const failing = store(async () => new Response("nope", { status: 503 }));
    await failing.refreshOnce();
    expect(failing.document()).toBe(VALID_BUNDLE);

    const oversized = store(
      async () =>
        new Response(
          `{"models":[{"pad":"${"x".repeat(MODEL_REGISTRY_MAX_BYTES)}"}]}`,
          {
            status: 200,
          },
        ),
    );
    await oversized.refreshOnce();
    expect(oversized.document()).toBe(VALID_BUNDLE);
  });

  it("logs the first consecutive failure at warn, repeats at debug, resets on success", async () => {
    const { lines, logger } = capturingLogger();
    let mode: "fail" | "ok" = "fail";
    const subject = store(async () => {
      if (mode === "fail") {
        return new Response("down", { status: 500 });
      }
      return new Response(UPGRADED, { status: 200 });
    }, logger);

    await subject.refreshOnce();
    await subject.refreshOnce();
    expect(lines.map((line) => line.level)).toEqual(["warn", "debug"]);

    mode = "ok";
    await subject.refreshOnce();
    expect(subject.document()).toBe(UPGRADED);

    // The flag reset: the NEXT failure is "first" again → warn.
    mode = "fail";
    await subject.refreshOnce();
    expect(lines.map((line) => line.level)).toEqual(["warn", "debug", "warn"]);
  });
});
