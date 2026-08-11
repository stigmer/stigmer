/**
 * Boot preflight tests.
 *
 * The preflight is what turns a raw ERR_UNKNOWN_BUILTIN_MODULE from the
 * checkpointer's `node:sqlite` import (on Node < 22.13 / 23.0–23.3) into an
 * actionable first-line-of-output error. These tests pin:
 * - the pass/fail contract of preflightNodeRuntime around an injected probe
 *   (so the failure path is testable on a supported Node), and
 * - the message contract: it must name the found version, the missing
 *   capability, and both known-good floors — that exact text is what reaches
 *   the desktop Run dialog via the IPC handshake.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  isNodeSqliteAvailable,
  preflightNodeRuntime,
  assertLlmBackendsPreflight,
} from "../preflight.js";

describe("preflightNodeRuntime", () => {
  it("passes (returns null) when node:sqlite is available", () => {
    expect(preflightNodeRuntime(() => true)).toBeNull();
  });

  it("fails with the actionable message contract when node:sqlite is absent", () => {
    const message = preflightNodeRuntime(() => false);

    expect(message).not.toBeNull();
    // Found version, so the operator knows what they are actually running.
    expect(message).toContain(`Node v${process.versions.node}`);
    // The missing capability, so the error is searchable and precise.
    expect(message).toContain("node:sqlite");
    // Both floors — including the 23.4 one whose omission caused the original bug.
    expect(message).toContain("22.13");
    expect(message).toContain("23.4");
  });

  it("wires the real-runtime probe as the default", () => {
    // Asserted as consistency, not as an environment fact: the suite may
    // itself run under a Node without node:sqlite (e.g. 23.0–23.3), in which
    // case BOTH sides must report unsupported.
    expect(preflightNodeRuntime() === null).toBe(isNodeSqliteAvailable());
  });
});

describe("assertLlmBackendsPreflight", () => {
  // This is the gate both runner factories run at construction — the throw
  // is what a misconfigured deployment sees instead of accepting work. The
  // per-case parse/prereq tables live in shared/__tests__/llm-backend.test.ts;
  // here we pin the wrapper's contract: throw on fatal, warn on precedence,
  // silent when clean, and options-proxy treated like the env proxy.
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  /** Pin the vars this gate reads so ambient shell env cannot leak in. */
  function stubBackendEnv(vars: Record<string, string>) {
    vi.stubEnv("STIGMER_PROXY_ENDPOINT", "");
    vi.stubEnv("STIGMER_ANTHROPIC_BACKEND", "");
    vi.stubEnv("STIGMER_OPENAI_BACKEND", "");
    vi.stubEnv("CLOUD_ML_REGION", "");
    for (const [key, value] of Object.entries(vars)) {
      vi.stubEnv(key, value);
    }
  }

  it("passes silently for an unconfigured deployment", () => {
    stubBackendEnv({});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(() => assertLlmBackendsPreflight(null)).not.toThrow();
    expect(warn).not.toHaveBeenCalled();
  });

  it("throws the actionable message for a misconfigured backend", () => {
    stubBackendEnv({ STIGMER_ANTHROPIC_BACKEND: "vertex" });
    expect(() => assertLlmBackendsPreflight(null)).toThrow(/CLOUD_ML_REGION/);
  });

  it("warns instead of throwing when an options-supplied proxy makes the var inert", () => {
    stubBackendEnv({ STIGMER_ANTHROPIC_BACKEND: "vertex" });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(() => assertLlmBackendsPreflight("https://api.stigmer.ai")).not.toThrow();
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("STIGMER_ANTHROPIC_BACKEND=vertex is ignored"),
    );
  });
});
