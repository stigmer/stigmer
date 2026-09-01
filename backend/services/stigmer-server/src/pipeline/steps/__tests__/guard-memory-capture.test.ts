/**
 * Pins the memory capture-eligibility gate (parity entry 20260830.05,
 * stigmer-cloud#564): the authorizeMemoryCapture capability's three
 * verdicts (admit stashes the proved claims, refuse answers the
 * byte-pinned PERMISSION_DENIED copy, no-opinion falls through to the
 * gate's own machine/platform_client_id logic), the capture org handed to
 * the capability, the org-mismatch throw propagating untouched, and the
 * absent-capability posture staying byte-identical to the pre-seam gate
 * (trusted-local and OIDC callers admit; machine and
 * platform_client_id-carrying callers refuse).
 */
import { describe, expect, it } from "vitest";
import { Code, ConnectError } from "@connectrpc/connect";
import { create } from "@bufbuild/protobuf";

import { MemorySchema } from "@stigmer/protos/ai/stigmer/agentic/memory/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import type { CallerIdentity } from "../../../extensions/identity.js";
import type {
  MemoryCaptureDecision,
  RunnerCredentialProvider,
} from "../../../runnerauth/runner-credential-provider.js";
import { RequestContext } from "../../request-context.js";
import {
  MEMORY_CAPTURE_CALLER_MESSAGE,
  memoryCaptureCredentialOf,
  newGuardMemoryCaptureStep,
} from "../guard-memory-capture.js";

const LOCAL_USER: CallerIdentity = {
  identityId: "local",
  callerClass: "user",
  issuer: "",
  rawToken: "",
};

/** A cloud-shaped caller whose class is its token_type (sandbox lane). */
const SANDBOX_CALLER: CallerIdentity = {
  identityId: "ida_human",
  callerClass: "sandbox",
  issuer: "stigmer",
  rawToken: "opaque-to-oss",
};

function memoryCtx(
  caller: CallerIdentity,
  org = "org_acme",
): RequestContext<typeof MemorySchema> {
  return new RequestContext(
    MemorySchema,
    create(MemorySchema, {
      metadata: { name: "m", org },
      spec: { content: "fact" },
    }),
    caller,
    ApiResourceKind.memory,
  );
}

/** A provider whose only relevant surface is the capture capability. */
function providerWith(
  decide?: (caller: CallerIdentity, org: string) => MemoryCaptureDecision,
): RunnerCredentialProvider {
  return {
    isEnabled: () => false,
    mint: () => {
      throw new Error("not under test");
    },
    verify: () => {
      throw new Error("not under test");
    },
    ...(decide === undefined ? {} : { authorizeMemoryCapture: decide }),
  };
}

function jwtWith(payload: Record<string, unknown>): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `header.${body}.signature`;
}

describe("GuardMemoryCapture with the capability composed", () => {
  it("admit stashes the proved claims for ResolveMemoryDefaults", () => {
    const step = newGuardMemoryCaptureStep<typeof MemorySchema>(
      providerWith(() => ({
        verdict: "admit",
        subjectIdentityAccountId: "ida_human",
        provedSessionId: "ses_proved",
      })),
    );
    const ctx = memoryCtx(SANDBOX_CALLER);
    step.execute(ctx);
    expect(memoryCaptureCredentialOf(ctx)).toEqual({
      subjectIdentityAccountId: "ida_human",
      provedSessionId: "ses_proved",
    });
  });

  it("refuse answers the byte-pinned PERMISSION_DENIED copy", () => {
    const step = newGuardMemoryCaptureStep<typeof MemorySchema>(
      providerWith(() => ({ verdict: "refuse" })),
    );
    let error: unknown;
    try {
      step.execute(memoryCtx(SANDBOX_CALLER));
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(ConnectError);
    expect((error as ConnectError).code).toBe(Code.PermissionDenied);
    expect((error as ConnectError).rawMessage).toBe(
      MEMORY_CAPTURE_CALLER_MESSAGE,
    );
  });

  it("hands the capability the caller and the capture org", () => {
    const observed: Array<{ caller: CallerIdentity; org: string }> = [];
    const step = newGuardMemoryCaptureStep<typeof MemorySchema>(
      providerWith((caller, org) => {
        observed.push({ caller, org });
        return { verdict: "no-opinion" };
      }),
    );
    step.execute(memoryCtx(SANDBOX_CALLER, "org_zeta"));
    expect(observed).toEqual([{ caller: SANDBOX_CALLER, org: "org_zeta" }]);
  });

  it("an org-mismatch throw from the capability propagates untouched", () => {
    const mismatch = new ConnectError(
      "memory capture is scoped to the session's organization",
      Code.PermissionDenied,
    );
    const step = newGuardMemoryCaptureStep<typeof MemorySchema>(
      providerWith(() => {
        throw mismatch;
      }),
    );
    let error: unknown;
    try {
      step.execute(memoryCtx(SANDBOX_CALLER, "org_other"));
    } catch (e) {
      error = e;
    }
    expect(error).toBe(mismatch);
  });

  it("no-opinion falls through: platform_client_id carriers still refuse", () => {
    const step = newGuardMemoryCaptureStep<typeof MemorySchema>(
      providerWith(() => ({ verdict: "no-opinion" })),
    );
    const minted: CallerIdentity = {
      identityId: "ida_guest",
      callerClass: "guest",
      issuer: "stigmer",
      rawToken: jwtWith({ platform_client_id: "pc_1" }),
    };
    expect(() => step.execute(memoryCtx(minted))).toThrowError(
      MEMORY_CAPTURE_CALLER_MESSAGE,
    );
  });

  it("internal and in-process callers never consult the capability", () => {
    const step = newGuardMemoryCaptureStep<typeof MemorySchema>(
      providerWith(() => {
        throw new Error("must not be consulted");
      }),
    );
    step.execute(
      memoryCtx({
        identityId: "internal",
        callerClass: "internal",
        issuer: "",
        rawToken: "",
      }),
    );
    step.execute(memoryCtx({ ...LOCAL_USER, origin: "in-process" }));
  });
});

describe("GuardMemoryCapture without the capability (the pre-seam gate)", () => {
  it("admits trusted-local and OIDC callers", () => {
    const step = newGuardMemoryCaptureStep<typeof MemorySchema>(
      providerWith(),
    );
    step.execute(memoryCtx(LOCAL_USER));
    step.execute(
      memoryCtx({
        identityId: "ida_oidc",
        callerClass: "user",
        issuer: "https://issuer.example",
        rawToken: jwtWith({ sub: "ida_oidc" }),
      }),
    );
  });

  it("refuses machine callers and platform_client_id carriers", () => {
    const step = newGuardMemoryCaptureStep<typeof MemorySchema>(
      providerWith(),
    );
    expect(() =>
      step.execute(memoryCtx({ ...LOCAL_USER, callerClass: "machine" })),
    ).toThrowError(MEMORY_CAPTURE_CALLER_MESSAGE);
    expect(() =>
      step.execute(
        memoryCtx({
          ...LOCAL_USER,
          rawToken: jwtWith({ platform_client_id: "pc_1" }),
        }),
      ),
    ).toThrowError(MEMORY_CAPTURE_CALLER_MESSAGE);
  });

  it("admits a runner-shaped caller — the recorded pre-fix posture", () => {
    // With no capability composed the gate cannot classify runner
    // credentials — the single-user OSS posture admits them (the #564
    // narrowing is CLOUD policy, shipped in the cloud capability).
    const step = newGuardMemoryCaptureStep<typeof MemorySchema>(
      providerWith(),
    );
    step.execute(memoryCtx(SANDBOX_CALLER));
  });
});
