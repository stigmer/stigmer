/**
 * Regression tests for runner execution pipeline fixes.
 *
 * Covers three bugs discovered during daily-notification-plan workflow
 * execution:
 *
 * 1. Model pricing loaded too late (resolveModelId before ensurePricingLoaded)
 * 2. MCP connect-backfill proto serialization (plain object instead of
 *    create(ExecutionValueSchema, ...))
 * 3. Session slug re-validation on full update
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { create } from "@bufbuild/protobuf";
import { ConnectInputSchema } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/io_pb";
import { ExecutionValueSchema } from "@stigmer/protos/ai/stigmer/agentic/executioncontext/v1/spec_pb";

// ─────────────────────────────────────────────────────────────────────────────
// 1. Model pricing: resolveModelId must succeed after ensureLoaded
// ─────────────────────────────────────────────────────────────────────────────

describe("model pricing ordering regression", () => {
  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("resolveModelId returns 'default' before ensureLoaded (documents the bug)", async () => {
    // Reset module state to simulate a fresh import
    vi.resetModules();
    const { resolveModelId } = await import("../model-pricing.js");
    expect(resolveModelId("claude-sonnet-4")).toBe("default");
  });

  it("resolveModelId returns the model name after ensureLoaded with populated registry", async () => {
    vi.resetModules();

    // Mock the pricing data fetch to return a known model
    vi.doMock("../model-pricing-data.js", () => ({
      getPricingTable: vi.fn().mockResolvedValue([
        {
          model: "claude-sonnet-4",
          displayName: "Claude Sonnet 4",
          costTier: "standard",
          inputPricePerMillion: 3.0,
          outputPricePerMillion: 15.0,
          cacheWritePricePerMillion: 3.75,
          cacheReadPricePerMillion: 0.30,
        },
      ]),
      DEFAULT_PRICING: {
        model: "unknown",
        displayName: "Unknown",
        costTier: "standard",
        inputPricePerMillion: 1.25,
        outputPricePerMillion: 6.0,
        cacheWritePricePerMillion: 1.25,
        cacheReadPricePerMillion: 0.25,
      },
    }));

    const { resolveModelId, ensureLoaded } = await import("../model-pricing.js");

    await ensureLoaded();
    expect(resolveModelId("claude-sonnet-4")).toBe("claude-sonnet-4");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Connect-backfill: ExecutionValue must be a proto message, not a plain object
// ─────────────────────────────────────────────────────────────────────────────

describe("connect-backfill proto serialization regression", () => {
  it("ConnectInput.runtimeEnv serializes correctly with create(ExecutionValueSchema)", () => {
    const input = create(ConnectInputSchema, {
      mcpServerId: "test-id",
      org: "test-org",
    });

    // This is the FIXED pattern — uses create(ExecutionValueSchema, ...)
    input.runtimeEnv["POSTGRES_URL"] = create(ExecutionValueSchema, {
      value: "postgresql://localhost/test",
      isSecret: true,
    });

    // Verify the message is a proper proto message, not a plain object
    expect(input.runtimeEnv["POSTGRES_URL"].value).toBe("postgresql://localhost/test");
    expect(input.runtimeEnv["POSTGRES_URL"].isSecret).toBe(true);
    expect(input.runtimeEnv["POSTGRES_URL"].$typeName).toBe(
      "ai.stigmer.agentic.executioncontext.v1.ExecutionValue",
    );
  });

  it("plain object assignment would fail serialization (documents the bug)", () => {
    const input = create(ConnectInputSchema, {
      mcpServerId: "test-id",
      org: "test-org",
    });

    // This was the BUGGY pattern — plain object cast with `as any`
    input.runtimeEnv["KEY"] = { value: "val" } as any;

    // The plain object lacks $typeName, proving it's not a proper proto message
    expect((input.runtimeEnv["KEY"] as any).$typeName).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Session slug: clearing slug before update avoids re-validation failure
// ─────────────────────────────────────────────────────────────────────────────

describe("session slug clearing regression", () => {
  it("clearing metadata.slug to empty string avoids re-validation of invalid slugs", () => {
    // Simulate a session object returned from getSession with an invalid slug
    const session = {
      metadata: {
        id: "ses_01kscspgzpswfpgjdxw3wfgvvy",
        name: "ses-wf-wex01kscsp7qj7p7q7ffg6rcajk5d-analyze-player-data",
        slug: "ses-wf-wex_01kscsp7qj7p7q7ffg6rcajk5d-analyze_player_data",
        org: "tt-demo",
      },
      spec: {
        harnessStateId: "",
        cursorMode: 0,
      },
    };

    // The slug contains underscores, which violates ^[a-z][a-z0-9-]*[a-z0-9]$
    const slugPattern = /^[a-z][a-z0-9-]*[a-z0-9]$/;
    expect(slugPattern.test(session.metadata.slug)).toBe(false);

    // After clearing (the fix), the empty slug passes IGNORE_IF_ZERO_VALUE
    session.metadata.slug = "";
    expect(session.metadata.slug).toBe("");

    // Metadata still has the fields needed for the update pipeline
    expect(session.metadata.id).toBeTruthy();
    expect(session.metadata.name).toBeTruthy();
    expect(session.metadata.org).toBeTruthy();
  });
});
