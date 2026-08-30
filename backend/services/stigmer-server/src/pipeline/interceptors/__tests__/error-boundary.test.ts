/**
 * Pins the error boundary (20260830.03, all gate rulings as recommended):
 * the structural raw-error conversion (Q2 — a non-ConnectError from any
 * handler becomes the pipeline's sanitized Internal, never
 * Unknown-with-raw-message), the policy-driven visitor rewrite (the six
 * leak-prone codes, code ALWAYS preserved, ref format byte-pinned,
 * details and metadata dropped), the pass-through arms (deliberate
 * refusal codes untouched byte-identically; non-eligible callers keep
 * full diagnostics — the cloud's schedule-caller arm rides this), the
 * fail-safe arms (eligibility throw → sanitize; copy rejection → the
 * fallback copy, never the original), the mid-stream guard, and the
 * NEGATIVE CONTROL: the same call WITHOUT the boundary proves the raw
 * message crosses verbatim (the Java wire suite's pre-fix-red pattern).
 */
import { describe, expect, it } from "vitest";
import { Code, ConnectError, createContextValues } from "@connectrpc/connect";
import type { Interceptor } from "@connectrpc/connect";
import type { DescMethod } from "@bufbuild/protobuf";

import { ApiKeyQueryController } from "@stigmer/protos/ai/stigmer/iam/apikey/v1/query_pb";
import { PlatformQueryController } from "@stigmer/protos/ai/stigmer/platform/v1/server_info_pb";

import type { CallerIdentity } from "../../../extensions/identity.js";
import { callerIdentityKey } from "../auth.js";
import {
  createErrorBoundaryInterceptor,
  supportRefSuffix,
} from "../error-boundary.js";
import type { VisitorErrorPolicy } from "../error-boundary.js";

const silentLogger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
};

const GUEST: CallerIdentity = {
  identityId: "ida_guest",
  callerClass: "guest",
  issuer: "stigmer",
  rawToken: "tok",
};

const MEMBER: CallerIdentity = {
  identityId: "ida_member",
  callerClass: "user",
  issuer: "stigmer",
  rawToken: "tok",
};

/** A guest-only policy with fixed copy — the cloud shape in miniature. */
function guestPolicy(
  copy = "This agent is currently unavailable.",
): VisitorErrorPolicy {
  return {
    eligible: (identity) => identity?.callerClass === "guest",
    replacementCopy: () => Promise.resolve(copy),
  };
}

interface RunOptions {
  identity?: CallerIdentity;
  method?: DescMethod;
}

/**
 * Drives the boundary with a unary-shaped request whose handler throws.
 * Returns the error that would reach the wire.
 */
async function runFailing(
  interceptor: Interceptor,
  thrown: unknown,
  options: RunOptions = {},
): Promise<ConnectError> {
  const contextValues = createContextValues();
  if (options.identity !== undefined) {
    contextValues.set(callerIdentityKey, options.identity);
  }
  const next = () => Promise.reject(thrown);
  try {
    await interceptor(next as never)({
      header: new Headers(),
      contextValues,
      method: options.method ?? ApiKeyQueryController.method.get,
      service: ApiKeyQueryController,
      stream: false,
    } as never);
  } catch (error) {
    expect(error).toBeInstanceOf(ConnectError);
    return error as ConnectError;
  }
  throw new Error("expected the interceptor to rethrow");
}

/** Drives the boundary with a stream response that fails mid-iteration. */
async function runFailingStream(
  interceptor: Interceptor,
  thrown: unknown,
  identity?: CallerIdentity,
): Promise<{ received: string[]; error: ConnectError }> {
  const contextValues = createContextValues();
  if (identity !== undefined) {
    contextValues.set(callerIdentityKey, identity);
  }
  async function* failingMessages(): AsyncIterable<string> {
    yield "first";
    throw thrown;
  }
  const next = () =>
    Promise.resolve({ stream: true, message: failingMessages() });
  const response = (await interceptor(next as never)({
    header: new Headers(),
    contextValues,
    method: ApiKeyQueryController.method.get,
    service: ApiKeyQueryController,
    stream: false,
  } as never)) as { stream: true; message: AsyncIterable<string> };
  const received: string[] = [];
  try {
    for await (const message of response.message) {
      received.push(message);
    }
  } catch (error) {
    expect(error).toBeInstanceOf(ConnectError);
    return { received, error: error as ConnectError };
  }
  throw new Error("expected the guarded stream to rethrow");
}

/** The byte-pinned ref shape: " (ref: <8 hex chars>)" at the end. */
const REF_PATTERN = /^(.*) \(ref: [0-9a-f]{8}\)$/;

describe("arm 1: structural raw-error conversion (ruling Q2)", () => {
  it("converts a raw Error to the pipeline's sanitized Internal", async () => {
    const error = await runFailing(
      createErrorBoundaryInterceptor(silentLogger),
      new Error("ENOENT: /var/lib/stigmer/secrets.db"),
    );
    expect(error.code).toBe(Code.Internal);
    expect(error.rawMessage).toBe("internal server error");
  });

  it("converts thrown non-Error values the same way", async () => {
    const error = await runFailing(
      createErrorBoundaryInterceptor(silentLogger),
      "string thrown from a handler",
    );
    expect(error.code).toBe(Code.Internal);
    expect(error.rawMessage).toBe("internal server error");
  });

  it("NEGATIVE CONTROL: without the boundary, the raw message crosses verbatim", async () => {
    // The pre-fix wiring: connect-node's default conversion — proves the
    // leak the boundary closes (the Java wire suite's control pattern).
    const raw = new Error("ENOENT: /var/lib/stigmer/secrets.db");
    const withoutBoundary = ConnectError.from(raw);
    expect(withoutBoundary.code).toBe(Code.Unknown);
    expect(withoutBoundary.rawMessage).toContain(
      "ENOENT: /var/lib/stigmer/secrets.db",
    );
  });

  it("passes ConnectErrors through byte-identically with no policy", async () => {
    const thrown = new ConnectError(
      "agent 'my-agent' not found",
      Code.NotFound,
    );
    const error = await runFailing(
      createErrorBoundaryInterceptor(silentLogger),
      thrown,
    );
    expect(error).toBe(thrown);
  });
});

describe("arm 2: the visitor rewrite", () => {
  it("rewrites a leak-prone description for an eligible caller, preserving the code and appending the ref", async () => {
    const error = await runFailing(
      createErrorBoundaryInterceptor(silentLogger, guestPolicy()),
      new ConnectError(
        "pg: connection refused at 10.0.3.7:5432",
        Code.Unavailable,
      ),
      { identity: GUEST },
    );
    expect(error.code).toBe(Code.Unavailable);
    const match = REF_PATTERN.exec(error.rawMessage);
    expect(match?.[1]).toBe("This agent is currently unavailable.");
    expect(error.rawMessage).not.toContain("10.0.3.7");
  });

  it("rewrites all six leak-prone codes and no others", async () => {
    const leaky = [
      Code.Internal,
      Code.Unknown,
      Code.DataLoss,
      Code.Unavailable,
      Code.DeadlineExceeded,
      Code.Unimplemented,
    ];
    for (const code of leaky) {
      const error = await runFailing(
        createErrorBoundaryInterceptor(silentLogger, guestPolicy()),
        new ConnectError("internals", code),
        { identity: GUEST },
      );
      expect(error.code).toBe(code);
      expect(error.rawMessage).toMatch(REF_PATTERN);
    }
    const passThrough = [
      Code.NotFound,
      Code.AlreadyExists,
      Code.InvalidArgument,
      Code.FailedPrecondition,
      Code.PermissionDenied,
      Code.ResourceExhausted,
      Code.Unauthenticated,
      Code.Aborted,
      Code.OutOfRange,
      Code.Canceled,
    ];
    for (const code of passThrough) {
      const thrown = new ConnectError("authored refusal copy", code);
      const error = await runFailing(
        createErrorBoundaryInterceptor(silentLogger, guestPolicy()),
        thrown,
        { identity: GUEST },
      );
      // Byte-identical pass-through: the SAME instance, trailers intact.
      expect(error).toBe(thrown);
    }
  });

  it("keeps full diagnostics for non-eligible callers (the org-member and schedule arms)", async () => {
    for (const identity of [
      MEMBER,
      { ...MEMBER, callerClass: "schedule" } satisfies CallerIdentity,
    ]) {
      const thrown = new ConnectError(
        "step Persist failed: disk full",
        Code.Internal,
      );
      const error = await runFailing(
        createErrorBoundaryInterceptor(silentLogger, guestPolicy()),
        thrown,
        { identity },
      );
      expect(error).toBe(thrown);
    }
  });

  it("consults the policy even with NO stamped identity (the Java no-context pin)", async () => {
    // An is_public-shaped policy answers on the method alone — the arm
    // that must hold when position 1 itself failed before stamping.
    const publicOnly: VisitorErrorPolicy = {
      eligible: (_identity, method) =>
        method.name === PlatformQueryController.method.getServerInfo.name,
      replacementCopy: () =>
        Promise.resolve("Something went wrong on our side."),
    };
    const error = await runFailing(
      createErrorBoundaryInterceptor(silentLogger, publicOnly),
      new ConnectError("verifier chain wiring fault", Code.Internal),
      { method: PlatformQueryController.method.getServerInfo },
    );
    expect(error.code).toBe(Code.Internal);
    expect(error.rawMessage).toMatch(REF_PATTERN);
    expect(error.rawMessage).toContain("Something went wrong on our side.");
  });

  it("sanitizes the RAW-error arm for eligible callers too (raw → Internal → visitor copy)", async () => {
    const error = await runFailing(
      createErrorBoundaryInterceptor(silentLogger, guestPolicy()),
      new Error("raw driver detail"),
      { identity: GUEST },
    );
    expect(error.code).toBe(Code.Internal);
    expect(error.rawMessage).toMatch(REF_PATTERN);
    expect(error.rawMessage).not.toContain("raw driver detail");
  });

  it("drops details and metadata on sanitize (the Java trailers-drop)", async () => {
    const thrown = new ConnectError("internals", Code.Internal);
    thrown.metadata.set("x-debug-hint", "table=oauth_grant");
    const error = await runFailing(
      createErrorBoundaryInterceptor(silentLogger, guestPolicy()),
      thrown,
      { identity: GUEST },
    );
    expect(error).not.toBe(thrown);
    expect(error.details).toHaveLength(0);
    expect([...error.metadata.keys()]).toHaveLength(0);
  });
});

describe("fail-safe arms", () => {
  it("a throwing eligibility check fails toward sanitizing", async () => {
    const broken: VisitorErrorPolicy = {
      eligible: () => {
        throw new Error("policy bug");
      },
      replacementCopy: () => Promise.resolve("neutral copy"),
    };
    const error = await runFailing(
      createErrorBoundaryInterceptor(silentLogger, broken),
      new ConnectError("internals", Code.Internal),
      { identity: GUEST },
    );
    expect(error.rawMessage).toContain("neutral copy");
    expect(error.rawMessage).not.toContain("internals");
  });

  it("a rejecting copy resolution falls back to the sanitized-Internal copy, never the original", async () => {
    const failingCopy: VisitorErrorPolicy = {
      eligible: () => true,
      replacementCopy: () => Promise.reject(new Error("share store down")),
    };
    const error = await runFailing(
      createErrorBoundaryInterceptor(silentLogger, failingCopy),
      new ConnectError("internals", Code.Unavailable),
      { identity: GUEST },
    );
    expect(error.code).toBe(Code.Unavailable);
    const match = REF_PATTERN.exec(error.rawMessage);
    expect(match?.[1]).toBe("internal server error");
  });
});

describe("the stream guard", () => {
  it("sanitizes a raw mid-stream error (arm 1)", async () => {
    const { received, error } = await runFailingStream(
      createErrorBoundaryInterceptor(silentLogger),
      new Error("mid-stream driver detail"),
    );
    expect(received).toEqual(["first"]);
    expect(error.code).toBe(Code.Internal);
    expect(error.rawMessage).toBe("internal server error");
  });

  it("rewrites a leak-prone mid-stream ConnectError for an eligible caller (arm 2)", async () => {
    const { received, error } = await runFailingStream(
      createErrorBoundaryInterceptor(silentLogger, guestPolicy()),
      new ConnectError("broker connection lost: 10.0.3.7", Code.Unavailable),
      GUEST,
    );
    expect(received).toEqual(["first"]);
    expect(error.code).toBe(Code.Unavailable);
    expect(error.rawMessage).toMatch(REF_PATTERN);
    expect(error.rawMessage).not.toContain("10.0.3.7");
  });
});

describe("the ref format", () => {
  it("is the Java byte-pinned suffix shape", () => {
    expect(supportRefSuffix("9c1b2a3d")).toBe(" (ref: 9c1b2a3d)");
  });
});
