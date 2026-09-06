/**
 * Pins the identity chassis (O2, DD-007 §1): the claim-or-pass verifier
 * walk, the Q6 conditional-strictness contract (zero verifiers = silent
 * fall-through for unclaimed tokens; any verifier configured = unclaimed
 * is UNAUTHENTICATED), the O3 require-authentication posture (rulings
 * Q1+Q2 — tokenless is UNAUTHENTICATED with the Java byte-pinned copy,
 * except is_public methods and the gRPC health service by name — the
 * 20260904.02 exemption predicate), the trusted-local modeled state in both
 * operator postures, the internal caller class's structural minting
 * invariant (ruling Q4 — a wire request can never carry it), the
 * caller-guard walk (20260902.02 ruling Q1 — guards run over the FINAL
 * stamped identity, first throw wins, ConnectError is the guard's own
 * wire mapping, any other throw is INTERNAL), and the shared bearer
 * parser's shape.
 */
import { describe, expect, it, afterEach } from "vitest";
import { Code, ConnectError, createContextValues } from "@connectrpc/connect";
import type { Interceptor } from "@connectrpc/connect";
import type { DescMethod } from "@bufbuild/protobuf";

import { ApiKeyQueryController } from "@stigmer/protos/ai/stigmer/iam/apikey/v1/query_pb";
import { PlatformQueryController } from "@stigmer/protos/ai/stigmer/platform/v1/server_info_pb";
import { Health } from "@stigmer/protos/grpc/health/v1/health_pb";

import type { CallerGuard } from "../../../extensions/caller-guards.js";
import type {
  CallerIdentity,
  IdentityVerifier,
} from "../../../extensions/identity.js";
import {
  AUTHENTICATION_EXEMPT_SERVICES,
  AUTHENTICATION_TOKEN_MISSING_MESSAGE,
  authenticateBearerToken,
  callerIdentityKey,
  createInProcessCallerInterceptor,
  createVerifierChainInterceptor,
  isAuthenticationExempt,
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
 * The method defaults to a config-annotated (non-public) descriptor so
 * the require-auth arm sees the common case; tests of the is_public
 * exemption pass their own.
 */
async function runInterceptor(
  interceptor: Interceptor,
  authorizationHeader?: string,
  method: DescMethod = ApiKeyQueryController.method.get,
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
    method,
    // The parent service descriptor rides every real request; the guard
    // fault log reads its typeName.
    service: method.parent,
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
        [],
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
        [],
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
          [],
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
        [],
        silentLogger,
      ),
      "Bearer tok",
    ).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ConnectError);
    expect((error as ConnectError).code).toBe(Code.Internal);
    expect((error as ConnectError).rawMessage).toBe("internal server error");
  });
});

/**
 * The exported walk (stigmer#991) — the SAME function the interceptor
 * calls, reachable by a composition's non-Connect HTTP edges. Pinned
 * separately so an edge that consumes it can rely on the contract without
 * a Connect request in hand: first claim wins, pass moves on, ConnectError
 * propagates, plain throw is INTERNAL, and no claim is `undefined` — the
 * strictness decision (Q6) is the caller's, never the walk's.
 */
describe("authenticateBearerToken (the exported walk)", () => {
  it("first claim wins; later verifiers never run", async () => {
    let secondRan = false;
    const identity = await authenticateBearerToken(
      [
        verifier("first", () => Promise.resolve(CLAIMED)),
        verifier("second", () => {
          secondRan = true;
          return Promise.resolve(null);
        }),
      ],
      "tok",
      silentLogger,
    );
    expect(identity).toEqual(CLAIMED);
    expect(secondRan).toBe(false);
  });

  it("a pass (null) moves to the next verifier; the claimed identity carries the token it verified", async () => {
    const seen: string[] = [];
    const identity = await authenticateBearerToken(
      [
        verifier("first", (token) => {
          seen.push(`first:${token}`);
          return Promise.resolve(null);
        }),
        verifier("second", (token) => {
          seen.push(`second:${token}`);
          return Promise.resolve({ ...CLAIMED, rawToken: token });
        }),
      ],
      "tok",
      silentLogger,
    );
    expect(seen).toEqual(["first:tok", "second:tok"]);
    expect(identity?.rawToken).toBe("tok");
  });

  it("no verifier claims → undefined; the walk never applies strictness itself", async () => {
    await expect(
      authenticateBearerToken(
        [verifier("first", () => Promise.resolve(null))],
        "tok",
        silentLogger,
      ),
    ).resolves.toBeUndefined();
    await expect(
      authenticateBearerToken([], "tok", silentLogger),
    ).resolves.toBeUndefined();
  });

  it("a verifier's ConnectError is its own wire mapping (propagated)", async () => {
    const reject = new ConnectError("token expired", Code.Unauthenticated);
    await expect(
      authenticateBearerToken(
        [verifier("oidc", () => Promise.reject(reject))],
        "tok",
        silentLogger,
      ),
    ).rejects.toBe(reject);
  });

  it("a verifier's plain throw is an infrastructure fault → INTERNAL, never a denial", async () => {
    const error = await authenticateBearerToken(
      [verifier("oidc", () => Promise.reject(new Error("JWKS unreachable")))],
      "tok",
      silentLogger,
    ).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ConnectError);
    expect((error as ConnectError).code).toBe(Code.Internal);
    expect((error as ConnectError).rawMessage).toBe("internal server error");
  });
});

describe("conditional strictness (ruling Q6 — both postures)", () => {
  it("zero verifiers: a presented-but-unclaimed token falls through SILENTLY to trusted-local", async () => {
    const identity = await runInterceptor(
      createVerifierChainInterceptor([], [], silentLogger),
      "Bearer garbage-token",
    );
    expect(identity).toEqual(trustedLocalIdentity());
  });

  it("any verifier configured: a presented-but-unclaimed token is UNAUTHENTICATED", async () => {
    const error = await runInterceptor(
      createVerifierChainInterceptor(
        [verifier("oidc", () => Promise.resolve(null))],
        [],
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

  it("an absent token falls to trusted-local in both verifier postures when authentication is not required", async () => {
    expect(
      await runInterceptor(
        createVerifierChainInterceptor([], [], silentLogger),
      ),
    ).toEqual(trustedLocalIdentity());
    expect(
      await runInterceptor(
        createVerifierChainInterceptor(
          [verifier("oidc", () => Promise.resolve(null))],
          [],
          silentLogger,
        ),
      ),
    ).toEqual(trustedLocalIdentity());
  });
});

describe("require-authentication posture (O3 rulings Q1+Q2)", () => {
  const requiringChassis = createVerifierChainInterceptor(
    [
      verifier("oidc", (token) =>
        Promise.resolve(token === "tok" ? CLAIMED : null),
      ),
    ],
    [],
    silentLogger,
    true,
  );

  it("an absent token is UNAUTHENTICATED with the Java byte-pinned copy", async () => {
    const error = await runInterceptor(requiringChassis).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(ConnectError);
    expect((error as ConnectError).code).toBe(Code.Unauthenticated);
    expect((error as ConnectError).rawMessage).toBe(
      AUTHENTICATION_TOKEN_MISSING_MESSAGE,
    );
  });

  it("an is_public method stays reachable tokenless (the Java isPublic skip)", async () => {
    const identity = await runInterceptor(
      requiringChassis,
      undefined,
      PlatformQueryController.method.getServerInfo,
    );
    expect(identity).toEqual(trustedLocalIdentity());
  });

  it("the gRPC health service stays reachable tokenless — the Java by-name skip (stigmer#974)", async () => {
    // A Kubernetes `grpc:` probe is a tokenless Health/Check; the health
    // proto is third-party and cannot carry is_public, so the exemption
    // is by service name. Without it the posture crash-loops the pod.
    const identity = await runInterceptor(
      requiringChassis,
      undefined,
      Health.method.check,
    );
    expect(identity).toEqual(trustedLocalIdentity());
  });

  it("a claimed credential authenticates exactly as in the lenient posture", async () => {
    const identity = await runInterceptor(requiringChassis, "Bearer tok");
    expect(identity).toEqual(CLAIMED);
  });

  it("a presented-but-unclaimed token keeps the Q6 rejection (not the missing-token copy)", async () => {
    const error = await runInterceptor(
      requiringChassis,
      "Bearer garbage",
    ).catch((e: unknown) => e);
    expect((error as ConnectError).rawMessage).toBe(
      "the presented token was not accepted by any configured identity verifier",
    );
  });
});

describe("isAuthenticationExempt (the one exemption predicate, 20260904.02)", () => {
  it("is_public methods are exempt (our protos carry the option)", () => {
    expect(
      isAuthenticationExempt(PlatformQueryController.method.getServerInfo),
    ).toBe(true);
  });

  it("every method of the gRPC health service is exempt by service name (third-party proto)", () => {
    for (const method of Object.values(Health.method)) {
      expect(isAuthenticationExempt(method), method.name).toBe(true);
    }
  });

  it("a config-annotated method is not exempt", () => {
    expect(isAuthenticationExempt(ApiKeyQueryController.method.get)).toBe(
      false,
    );
  });

  it("the by-name set holds exactly the services OSS serves without our option", () => {
    // Java's list has a second entry (ServerReflection); OSS registers no
    // reflection service, so its presence here would be dead vocabulary —
    // a future registration adds it in the same change.
    expect([...AUTHENTICATION_EXEMPT_SERVICES]).toEqual([
      "grpc.health.v1.Health",
    ]);
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
      createVerifierChainInterceptor([], [], silentLogger),
      "Bearer forged.internal.token",
    );
    expect(identity?.callerClass).toBe("user");
  });
});

describe("caller-guard walk (20260902.02 ruling Q1)", () => {
  function guard(
    name: string,
    body: (caller: CallerIdentity) => Promise<void>,
  ): CallerGuard {
    return { name, guard: (caller) => body(caller) };
  }

  it("guards run over the FINAL stamped identity — the claimed arm", async () => {
    const seen: CallerIdentity[] = [];
    await runInterceptor(
      createVerifierChainInterceptor(
        [verifier("oidc", () => Promise.resolve(CLAIMED))],
        [
          guard("recorder", (caller) => {
            seen.push(caller);
            return Promise.resolve();
          }),
        ],
        silentLogger,
      ),
      "Bearer tok",
    );
    expect(seen).toEqual([CLAIMED]);
  });

  it("guards run over the FINAL stamped identity — the trusted-local arm", async () => {
    const seen: CallerIdentity[] = [];
    await runInterceptor(
      createVerifierChainInterceptor(
        [],
        [
          guard("recorder", (caller) => {
            seen.push(caller);
            return Promise.resolve();
          }),
        ],
        silentLogger,
      ),
    );
    expect(seen).toEqual([trustedLocalIdentity()]);
  });

  it("a guard receives the request's method descriptor and headers", async () => {
    let seenMethod: DescMethod | undefined;
    let seenOrigin: string | null = null;
    const inspecting: CallerGuard = {
      name: "inspector",
      guard: (_caller, method, headers) => {
        seenMethod = method;
        seenOrigin = headers.get("origin");
        return Promise.resolve();
      },
    };
    const header = new Headers();
    header.set("origin", "https://app.example.test");
    const contextValues = createContextValues();
    await createVerifierChainInterceptor(
      [],
      [inspecting],
      silentLogger,
    )(((request: { contextValues: typeof contextValues }) => {
      void request;
      return Promise.resolve({} as never);
    }) as never)({
      header,
      contextValues,
      method: ApiKeyQueryController.method.get,
      service: ApiKeyQueryController,
      stream: false,
    } as never);
    expect(seenMethod).toBe(ApiKeyQueryController.method.get);
    expect(seenOrigin).toBe("https://app.example.test");
  });

  it("a guard's ConnectError is its own wire mapping (propagated untouched)", async () => {
    const refusal = new ConnectError(
      "platform client was deleted",
      Code.Unauthenticated,
    );
    await expect(
      runInterceptor(
        createVerifierChainInterceptor(
          [],
          [guard("platform-client", () => Promise.reject(refusal))],
          silentLogger,
        ),
      ),
    ).rejects.toBe(refusal);
  });

  it("a guard's plain throw is an infrastructure fault → INTERNAL, never a denial", async () => {
    const error = await runInterceptor(
      createVerifierChainInterceptor(
        [],
        [
          guard("platform-client", () =>
            Promise.reject(new Error("postgres unreachable")),
          ),
        ],
        silentLogger,
      ),
    ).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ConnectError);
    expect((error as ConnectError).code).toBe(Code.Internal);
    expect((error as ConnectError).rawMessage).toBe("internal server error");
  });

  it("guards run in composed order; the first throw wins and later guards never run", async () => {
    const ran: string[] = [];
    const refusal = new ConnectError("refused", Code.PermissionDenied);
    const error = await runInterceptor(
      createVerifierChainInterceptor(
        [],
        [
          guard("first", () => {
            ran.push("first");
            return Promise.resolve();
          }),
          guard("second", () => {
            ran.push("second");
            return Promise.reject(refusal);
          }),
          guard("third", () => {
            ran.push("third");
            return Promise.resolve();
          }),
        ],
        silentLogger,
      ),
    ).catch((e: unknown) => e);
    expect(error).toBe(refusal);
    expect(ran).toEqual(["first", "second"]);
  });

  it("a refused request never reaches the handler", async () => {
    let handlerRan = false;
    const interceptor = createVerifierChainInterceptor(
      [],
      [
        guard("refuser", () =>
          Promise.reject(new ConnectError("no", Code.PermissionDenied)),
        ),
      ],
      silentLogger,
    );
    await interceptor((() => {
      handlerRan = true;
      return Promise.resolve({} as never);
    }) as never)({
      header: new Headers(),
      contextValues: createContextValues(),
      method: ApiKeyQueryController.method.get,
      service: ApiKeyQueryController,
      stream: false,
    } as never).catch(() => undefined);
    expect(handlerRan).toBe(false);
  });

  it("guards never run when the verifier chain already refused the request", async () => {
    let guardRan = false;
    await runInterceptor(
      createVerifierChainInterceptor(
        [verifier("oidc", () => Promise.resolve(null))],
        [
          guard("recorder", () => {
            guardRan = true;
            return Promise.resolve();
          }),
        ],
        silentLogger,
      ),
      "Bearer unclaimed-token",
    ).catch(() => undefined);
    expect(guardRan).toBe(false);
  });

  it("the chassis records a refusal with the guard's name (position 1 is outside the logging interceptor)", async () => {
    const warned: Array<Record<string, unknown>> = [];
    const capturingLogger = {
      ...silentLogger,
      warn: (_message: string, fields?: Record<string, unknown>) => {
        warned.push(fields ?? {});
      },
    };
    await runInterceptor(
      createVerifierChainInterceptor(
        [],
        [
          guard("platform-client", () =>
            Promise.reject(new ConnectError("no", Code.PermissionDenied)),
          ),
        ],
        capturingLogger,
      ),
    ).catch(() => undefined);
    expect(warned).toHaveLength(1);
    expect(warned[0]).toMatchObject({
      guard: "platform-client",
      code: "PermissionDenied",
    });
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
