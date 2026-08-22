// Unit tests for the capture-context resolution — the attribution twin of
// client.ts resolveToken: per-request headers (http) supersede the
// startup environment (stdio), whole-object, never mixed per-field.

import { describe, expect, it } from "vitest";

import {
  EMPTY_CAPTURE_CONTEXT,
  loadCaptureContextFromEnv,
  resolveCaptureContext,
  type CaptureContext,
} from "./context";

const startup: CaptureContext = {
  org: "env-org",
  agentId: "agt_env",
  sessionId: "ses_env",
  agentExecutionId: "aex_env",
};

describe("loadCaptureContextFromEnv", () => {
  it("reads the four STIGMER_MEMORY_* variables", () => {
    const ctx = loadCaptureContextFromEnv({
      STIGMER_MEMORY_ORG: "acme",
      STIGMER_MEMORY_AGENT_ID: "agt_1",
      STIGMER_MEMORY_SESSION_ID: "ses_1",
      STIGMER_MEMORY_EXECUTION_ID: "aex_1",
    });
    expect(ctx).toEqual({
      org: "acme",
      agentId: "agt_1",
      sessionId: "ses_1",
      agentExecutionId: "aex_1",
    });
  });

  it("degrades missing variables to empty strings (best-effort attribution)", () => {
    expect(loadCaptureContextFromEnv({})).toEqual(EMPTY_CAPTURE_CONTEXT);
  });
});

describe("resolveCaptureContext", () => {
  it("uses the startup context when the transport carries no request info (stdio)", () => {
    expect(resolveCaptureContext(undefined, startup)).toEqual(startup);
    expect(resolveCaptureContext({}, startup)).toEqual(startup);
  });

  it("uses the request headers when present (http), superseding startup wholesale", () => {
    const ctx = resolveCaptureContext(
      {
        requestInfo: {
          headers: {
            "x-stigmer-memory-org": "acme",
            "x-stigmer-memory-agent-id": "agt_http",
            "x-stigmer-memory-session-id": "ses_http",
            "x-stigmer-memory-execution-id": "aex_http",
          },
        },
      },
      startup,
    );
    expect(ctx).toEqual({
      org: "acme",
      agentId: "agt_http",
      sessionId: "ses_http",
      agentExecutionId: "aex_http",
    });
  });

  it("never mixes carriers: a header set missing a field yields empty, not the env value", () => {
    // The two carriers are written by different processes; falling back
    // per-field would attribute an http request to a stale stdio env.
    const ctx = resolveCaptureContext(
      { requestInfo: { headers: { "x-stigmer-memory-org": "acme" } } },
      startup,
    );
    expect(ctx).toEqual({ org: "acme", agentId: "", sessionId: "", agentExecutionId: "" });
  });

  it("looks headers up case-insensitively and collapses Node's array form", () => {
    const ctx = resolveCaptureContext(
      {
        requestInfo: {
          headers: {
            "X-Stigmer-Memory-Org": "acme",
            "x-stigmer-memory-agent-id": ["agt_1", "agt_dup"],
          },
        },
      },
      startup,
    );
    expect(ctx.org).toBe("acme");
    expect(ctx.agentId).toBe("agt_1");
  });
});
