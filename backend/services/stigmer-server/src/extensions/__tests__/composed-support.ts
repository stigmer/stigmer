/**
 * Shared fakes for the composed-server extension proofs (the
 * `*-composed.test.ts` files): the pieces a test needs to boot
 * `composeServer` with a fake unit in the cloud's own shape — a declared
 * require-authentication posture and the unit's OWN verifier — and to talk
 * to it over the wire as a chosen subject.
 *
 * The verifier vouches for an unsigned JWT-shaped token (`header.payload.
 * unsigned`) and admits its `sub` as a `user` whose identityId is the RAW
 * subject with an empty issuer: it deliberately does NOT resolve to an
 * account, exactly like a composition verifier that runs before any row
 * exists, so a first provisioning runs for real with no network. It passes
 * on every other token, so the OSS lanes composed ahead of it keep their
 * claims. Lifted from identity-account-composed.test.ts (20260911.11 slice
 * 3) when a second composed proof needed the same shape (20260913.01 S1).
 *
 * `servedServices` reads what a composed server ROUTES without binding a
 * port: compose.ts hands one `routes` closure to both transports, and
 * replaying it into a recording router yields the served service
 * descriptors — the enumeration the tier-truthfulness, annotation and
 * wire-permission invariants all stand on, kept here so each does not
 * carry its own recorder.
 */
import path from "node:path";

import type { DescMethod, DescService } from "@bufbuild/protobuf";
import type {
  ConnectRouter,
  Interceptor,
  Transport,
} from "@connectrpc/connect";
import { createGrpcTransport } from "@connectrpc/connect-node";

import { createLogger } from "../../boot/logger.js";
import type { CallerIdentity, IdentityVerifier } from "../identity.js";

export const silentLogger = createLogger({
  level: "error",
  pretty: false,
  write: () => {},
});

/** The smallest config a composed server boots with, everything under `dir`. */
export function baseConfig(dir: string): Record<string, string> {
  return {
    STIGMER_MODEL_REGISTRY_REFRESH: "off",
    TEMPORAL_HOST_PORT: "127.0.0.1:1",
    DB_PATH: path.join(dir, "stigmer.db"),
    STORAGE_PATH: path.join(dir, "storage"),
    ARTIFACT_LOCAL_BASE_PATH: path.join(dir, "artifacts"),
  };
}

/** An unsigned JWT-shaped token the fake verifier vouches for; idpIdOf reads its `sub` as it reads a real token's. */
export function fakeJwt(sub: string, email: string): string {
  const segment = (value: unknown): string =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${segment({ alg: "none" })}.${segment({ sub, email })}.unsigned`;
}

/** The composition's own verifier (the cloud's shape) — see the module header. */
export const fakeVerifier: IdentityVerifier = {
  name: "fake-composition-verifier",
  verify: (token) => {
    const segments = token.split(".");
    if (segments.length !== 3 || segments[2] !== "unsigned") {
      return Promise.resolve(null);
    }
    const claims = JSON.parse(
      Buffer.from(segments[1] ?? "", "base64url").toString("utf8"),
    ) as { sub?: unknown; email?: unknown };
    if (typeof claims.sub !== "string") {
      return Promise.resolve(null);
    }
    const identity: CallerIdentity = {
      identityId: claims.sub,
      callerClass: "user",
      issuer: "",
      rawToken: token,
      ...(typeof claims.email === "string" ? { email: claims.email } : {}),
    };
    return Promise.resolve(identity);
  },
};

export function bearer(token: string): Interceptor {
  return (next) => (request) => {
    request.header.set("authorization", `Bearer ${token}`);
    return next(request);
  };
}

/** Replays a composed server's `routes` closure into a recorder and returns the services it serves. */
export function servedServices(
  routes: (router: ConnectRouter) => void,
): DescService[] {
  return servedRegistrations(routes).map((r) => r.service);
}

/** One `router.service(desc, implementation)` registration, as replayed. */
export interface ServedRegistration {
  readonly service: DescService;
  readonly implementation: Readonly<Record<string, unknown>>;
}

/**
 * The registrations themselves, with each service's implementation map,
 * for a reader that must know which of a service's methods are actually
 * served: a partially implemented service (a method registered only when
 * a composed capability carries it) lists the method on its descriptor
 * and omits it from the map, and ConnectRPC answers UNIMPLEMENTED for it.
 */
export function servedRegistrations(
  routes: (router: ConnectRouter) => void,
): ServedRegistration[] {
  const served: ServedRegistration[] = [];
  const recorder = {
    handlers: [],
    service(desc: DescService, implementation: Record<string, unknown>) {
      served.push({ service: desc, implementation });
      return recorder;
    },
    rpc() {
      return recorder;
    },
  };
  routes(recorder as unknown as ConnectRouter);
  return served;
}

/** The methods a composed server actually serves: on a registered service AND in its implementation map. */
export function servedMethods(
  routes: (router: ConnectRouter) => void,
): DescMethod[] {
  const methods: DescMethod[] = [];
  for (const { service, implementation } of servedRegistrations(routes)) {
    for (const method of service.methods) {
      if (method.localName in implementation) {
        methods.push(method);
      }
    }
  }
  return methods;
}

/** A gRPC transport to the composed server on `port`, presenting `token` when given. */
export function transportFor(port: number, token?: string): Transport {
  return createGrpcTransport({
    baseUrl: `http://127.0.0.1:${port}`,
    interceptors: token !== undefined ? [bearer(token)] : [],
  });
}
