/**
 * Pins the identity chassis (O2, DD-007 §1): the claim-or-pass verifier
 * walk, the Q6 conditional-strictness contract (zero verifiers = silent
 * fall-through for unclaimed tokens; any verifier configured = unclaimed
 * is UNAUTHENTICATED), the trusted-local modeled state in both operator
 * postures, the internal caller class's structural minting invariant
 * (ruling Q4 — a wire request can never carry it), and the shared bearer
 * parser's shape.
 */
import { describe, expect, it, afterEach } from "vitest";
import { Code, ConnectError, createContextValues } from "@connectrpc/connect";
import type { Interceptor } from "@connectrpc/connect";

import type {
  CallerIdentity,
  IdentityVerifier,
} from "../../../extensions/identity.js";
import {
  callerIdentityKey,
  createInProcessCallerInterceptor,
  createVerifierChainInterceptor,
  parseBearerToken,
  trustedLocalIdentity,
} from "../auth.js";
import {
  resetOperatorIdentityForTests,
  setOperatorIdentity,
} from "../../steps/defaults.js";

const silentLogger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
};

afterEach(() => {
  resetOperatorIdentityForTests();
});

/**
 * Drives an interceptor with a minimal unary-shaped request and returns
 * the identity it stamped (undefined when it rejected before next()).
 */
async function runInterceptor(
  interceptor: Interceptor,
  authorizationHeader?: string,
): Promise<CallerIdentity | undefined> {
  const header = new Headers();
  if (authorizationHeader !== undefined) {
    header.set("authorization", authorizationHeader);
  }
  const contextValues = createContextValues();
  let stamped: CallerIdentity | undefined;
  const next = (request: { contextValues: typeof contextValues }) => {
    stamped = request.contextValues.get(callerIdentityKey);
    return Promise.resolve({} as never);
  };
  await interceptor(next as never)({
    header,
    contextValues,
    stream: false,
  } as never);
  return stamped;
}

function verifier(
  name: string,
  verify: (token: string) => Promise<CallerIdentity | null>,
): IdentityVerifier {
  return { name, verify };
}

const CLAIMED: CallerIdentity = {
  identityId: "ida_claimed",
  callerClass: "user",
  issuer: "https://issuer.test",
  rawToken: "tok",
};

describe("verifier chain walk", () => {
  it("first claim wins; later verifiers never run", async () => {
    let secondRan = false;
    const identity = await runInterceptor(
      createVerifierChainInterceptor(
        [
          verifier("first", () => Promise.resolve(CLAIMED)),
          verifier("second", () => {
            secondRan = true;
            return Promise.resolve(null);
          }),
        ],
        silentLogger,
      ),
      "Bearer tok",
    );
    expect(identity).toEqual(CLAIMED);
    expect(secondRan).toBe(false);
  });

  it("a pass (null) moves to the next verifier in order", async () => {
    const order: string[] = [];
    const identity = await runInterceptor(
      createVerifierChainInterceptor(
        [
          verifier("first", () => {
            order.push("first");
            return Promise.resolve(null);
          }),
          verifier("second", () => {
            order.push("second");
            return Promise.resolve(CLAIMED);
          }),
        ],
        silentLogger,
      ),
      "Bearer tok",
    );
    expect(order).toEqual(["first", "second"]);
    expect(identity).toEqual(CLAIMED);
  });

  it("a verifier's ConnectError is its own wire mapping (propagated)", async () => {
    const reject = new ConnectError("token expired", Code.Unauthenticated);
    await expect(
      runInterceptor(
        createVerifierChainInterceptor(
          [verifier("oidc", () => Promise.reject(reject))],
          silentLogger,
        ),
        "Bearer tok",
      ),
    ).rejects.toBe(reject);
  });

  it("a verifier's plain throw is an infrastructure fault → INTERNAL, never a denial", async () => {
    const error = await runInterceptor(
      createVerifierChainInterceptor(
        [verifier("oidc", () => Promise.reject(new Error("JWKS unreachable")))],
        silentLogger,
      ),
      "Bearer tok",
    ).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ConnectError);
    expect((error as ConnectError).code).toBe(Code.Internal);
    expect((error as ConnectError).rawMessage).toBe("internal server error");
  });
});

describe("conditional strictness (ruling Q6 — both postures)", () => {
  it("zero verifiers: a presented-but-unclaimed token falls through SILENTLY to trusted-local", async () => {
    const identity = await runInterceptor(
      createVerifierChainInterceptor([], silentLogger),
      "Bearer garbage-token",
    );
    expect(identity).toEqual(trustedLocalIdentity());
  });

  it("any verifier configured: a presented-but-unclaimed token is UNAUTHENTICATED", async () => {
    const error = await runInterceptor(
      createVerifierChainInterceptor(
        [verifier("oidc", () => Promise.resolve(null))],
        silentLogger,
      ),
      "Bearer garbage-token",
    ).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ConnectError);
    expect((error as ConnectError).code).toBe(Code.Unauthenticated);
    expect((error as ConnectError).rawMessage).toBe(
      "the presented token was not accepted by any configured identity verifier",
    );
  });

  it("an absent token falls to trusted-local in both postures (the require-auth posture is O3's)", async () => {
    expect(
      await runInterceptor(createVerifierChainInterceptor([], silentLogger)),
    ).toEqual(trustedLocalIdentity());
    expect(
      await runInterceptor(
        createVerifierChainInterceptor(
          [verifier("oidc", () => Promise.resolve(null))],
          silentLogger,
        ),
      ),
    ).toEqual(trustedLocalIdentity());
  });
});

describe("trusted-local identity (the explicit modeled state)", () => {
  it("unconfigured operator = the 'system' principal (pre-O2 audit bytes)", () => {
    expect(trustedLocalIdentity()).toEqual({
      identityId: "system",
      callerClass: "user",
      issuer: "",
      rawToken: "",
    });
  });

  it("configured operator = email-first identity with display fields", () => {
    setOperatorIdentity("op@example.com", "Op Erator");
    expect(trustedLocalIdentity()).toEqual({
      identityId: "op@example.com",
      callerClass: "user",
      issuer: "",
      rawToken: "",
      email: "op@example.com",
      displayName: "Op Erator",
    });
  });
});

describe("internal caller class (ruling Q4 — structurally unmintable from the wire)", () => {
  it("the in-process interceptor stamps the internal class", async () => {
    const identity = await runInterceptor(createInProcessCallerInterceptor());
    expect(identity?.callerClass).toBe("internal");
  });

  it("a wire request can never mint it: any token through the serving chassis stays a wire class", async () => {
    // Zero verifiers: even a forged token resolves to trusted-local
    // ("user"), never "internal" — the serving chain has no code path
    // that produces the class.
    const identity = await runInterceptor(
      createVerifierChainInterceptor([], silentLogger),
      "Bearer forged.internal.token",
    );
    expect(identity?.callerClass).toBe("user");
  });
});

describe("parseBearerToken (the one shared bearer shape)", () => {
  it.each([
    ["Bearer abc.def.ghi", "abc.def.ghi"],
    ["bearer abc", "abc"],
    ["BEARER abc  ", "abc"],
    ["Bearer abc, Bearer second", "abc"],
    ["Basic abc", ""],
    ["Bearer ", ""],
    ["", ""],
  ])("%j → %j", (header, expected) => {
    expect(parseBearerToken(header)).toBe(expected);
  });
});
