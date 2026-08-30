/**
 * Pins the gate→defaults capture-credential handoff (parity entry
 * 20260830.05, the Java MemoryCreateHandler sandbox semantics): when
 * GuardMemoryCapture admitted a session-scoped capture credential,
 * ResolveMemoryDefaults writes the token's proved subject ("the sub IS
 * the human subject the session belongs to") and overrides
 * provenance.session_id with the proved session (server-proved beats
 * runner-reported), creating provenance when the request supplied none;
 * without the handoff the OSS arms stand (empty-string sentinel subject,
 * provenance stored as supplied).
 */
import { describe, expect, it } from "vitest";
import { create } from "@bufbuild/protobuf";

import { MemorySchema } from "@stigmer/protos/ai/stigmer/agentic/memory/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import type { CallerIdentity } from "../../../extensions/identity.js";
import { RequestContext } from "../../../pipeline/request-context.js";
import { MEMORY_CAPTURE_CREDENTIAL_KEY } from "../../../pipeline/steps/guard-memory-capture.js";
import { newResolveMemoryDefaultsStep } from "../steps.js";

const CALLER: CallerIdentity = {
  identityId: "ida_human",
  callerClass: "sandbox",
  issuer: "stigmer",
  rawToken: "opaque",
};

function memoryCtx(spec: {
  provenance?: { sessionId?: string; agentId?: string; toolCallId?: string };
}): RequestContext<typeof MemorySchema> {
  return new RequestContext(
    MemorySchema,
    create(MemorySchema, {
      metadata: { name: "m", org: "org_acme" },
      spec: { content: "fact", ...spec },
    }),
    CALLER,
    ApiResourceKind.memory,
  );
}

describe("ResolveMemoryDefaults with an admitted capture credential", () => {
  it("writes the proved subject and overrides provenance.session_id", () => {
    const ctx = memoryCtx({
      provenance: {
        sessionId: "ses_runner_reported",
        agentId: "agt_1",
        toolCallId: "forged",
      },
    });
    ctx.set(MEMORY_CAPTURE_CREDENTIAL_KEY, {
      subjectIdentityAccountId: "ida_human",
      provedSessionId: "ses_proved",
    });
    newResolveMemoryDefaultsStep().execute(ctx);
    expect(ctx.newState.spec?.subjectIdentityAccountId).toBe("ida_human");
    expect(ctx.newState.spec?.provenance?.sessionId).toBe("ses_proved");
    // The threaded agent id survives; the forged tool_call_id never does.
    expect(ctx.newState.spec?.provenance?.agentId).toBe("agt_1");
    expect(ctx.newState.spec?.provenance?.toolCallId).toBe("");
  });

  it("creates provenance when the request supplied none", () => {
    const ctx = memoryCtx({});
    ctx.set(MEMORY_CAPTURE_CREDENTIAL_KEY, {
      subjectIdentityAccountId: "ida_human",
      provedSessionId: "ses_proved",
    });
    newResolveMemoryDefaultsStep().execute(ctx);
    expect(ctx.newState.spec?.provenance?.sessionId).toBe("ses_proved");
  });

  it("without the handoff the OSS arms stand", () => {
    const ctx = memoryCtx({
      provenance: { sessionId: "ses_supplied", toolCallId: "forged" },
    });
    newResolveMemoryDefaultsStep().execute(ctx);
    expect(ctx.newState.spec?.subjectIdentityAccountId).toBe("");
    expect(ctx.newState.spec?.provenance?.sessionId).toBe("ses_supplied");
    expect(ctx.newState.spec?.provenance?.toolCallId).toBe("");
  });
});
