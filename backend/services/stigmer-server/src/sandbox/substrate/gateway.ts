/**
 * The substrate driver's gateway: the ONLY surface that touches Agent
 * Substrate's Control API, so the driver's logic stays pure above it and a
 * test drives it with a fake.
 *
 * The client speaks native gRPC over HTTP/2 and TLS 1.3, because that is
 * all the Control API serves (a plain gRPC server, no Connect or gRPC-Web
 * handler), and sends `authorization: Bearer <token>` with every call, the
 * token read from a file and re-read when the file changes (a projected
 * ServiceAccount token rotates under a running server). The CA, like the
 * token, follows its file (pem-files.ts): a changed CA builds a new
 * connection under it, and the old one closes once its calls finish
 * (transportFollowingCa). The stubs are generated from the Substrate
 * release this server speaks to (../../../buf.gen.substrate.yaml):
 * Substrate refuses any field it does not know, so they must match the
 * deployment's release exactly.
 *
 * Errors are translated where the driver must act on them and passed on
 * otherwise: NOT_FOUND becomes "absent" on reads and success on deletes,
 * ALREADY_EXISTS success on creates, FAILED_PRECONDITION a refused move.
 * ABORTED becomes SubstrateAbortedError and is never retried here,
 * because Substrate uses it both for a lease held by another operation
 * and for an actor that crashed while resuming; the driver answers it by
 * re-reading the actor, which handles both. RESOURCE_EXHAUSTED (no free
 * worker) becomes SubstrateNoWorkerError. PERMISSION_DENIED is thrown
 * with the grant the server lacks named, because an operator meets it
 * once, at the first sandbox. Every call has a deadline.
 *
 * An actor's state is Substrate's, read as an enum. A suspend asks for
 * Substrate's asynchronous mode: the call returns once the snapshot is
 * captured on the actor's node, so a quick wake restores from there, and
 * Substrate copies it to storage in the background. Nothing here waits for
 * that copy or reads it: a wake takes the same call either way.
 *
 * Substrate always enforces authorization (OpenFGA). The caller is its
 * token's subject, `system:serviceaccount:<namespace>:<name>`, and
 * everything the driver does inside its atespace needs `editor` there;
 * creating the atespace needs a global owner, so the atespace is read
 * first and created only when it is missing. The operator guide names
 * both grants.
 *
 * With the atespace, the gateway ensures the atespace's access policy:
 * `editor` for this server, its token's subject read from the token file,
 * the one grant the server's own calls need. Substrate's node agent reads
 * each actor's egress policy through a system role of its own, so the
 * atespace grants it nothing. A new atespace gets the policy at once; an
 * existing one gets only the binding it lacks, and no binding is ever
 * removed. Writing a policy needs an owner of the atespace (a global owner
 * is one, as a hosted install's bootstrap owners are), so a refusal is
 * reported, not thrown: an owner may have made the grant by hand.
 */
import { readFileSync, statSync } from "node:fs";

import { create, equals } from "@bufbuild/protobuf";
import { timestampDate } from "@bufbuild/protobuf/wkt";
import {
  Code,
  ConnectError,
  createClient,
  type Interceptor,
  type Transport,
} from "@connectrpc/connect";
import {
  createGrpcTransport,
  Http2SessionManager,
} from "@connectrpc/connect-node";

import {
  AccessPolicySchema,
  ActorSchema,
  ActorState,
  ActorTemplateSchema,
  type ActorStatus,
  AtespaceSchema,
  BindingSchema,
  Control,
  DurabilityMode,
  EgressPolicySchema,
  EgressRuleSchema,
  ObjectRefSchema,
  type Actor,
  type ActorTemplate,
  type EgressRule,
} from "./gen/ateapipb/ateapi_pb.js";
import type { SubstrateDriverSettings } from "./config.js";
import { caFromFile } from "./pem-files.js";

const API_CA_FILE_VARIABLE = "STIGMER_SANDBOX_SUBSTRATE_API_CA_FILE";

/** Lease contention or a crash during resume; re-read the actor (module header). */
export class SubstrateAbortedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SubstrateAbortedError";
  }
}

/** No worker has room for the actor. */
export class SubstrateNoWorkerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SubstrateNoWorkerError";
  }
}

/** The grant the server lacks, named for the operator (module header). */
export class SubstratePermissionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SubstratePermissionError";
  }
}

/** An actor's state, in the platform's words: Substrate's (module header). */
export type SubstrateSandboxState =
  | "resuming"
  | "running"
  | "suspending"
  | "suspended"
  | "crashed"
  | "deleting"
  | "reverting"
  | "unknown";

/** One actor as the driver sees it. */
export interface SubstrateActorView {
  readonly name: string;
  readonly uid: string;
  readonly version: bigint;
  readonly state: SubstrateSandboxState;
  /** The template's name (always in this server's atespace). */
  readonly template: string;
  readonly createTime: Date | undefined;
  readonly updateTime: Date | undefined;
}

/** One template as the driver sees it. */
export interface SubstrateTemplateView {
  readonly name: string;
  readonly uid: string;
  readonly version: bigint;
  readonly createTime: Date | undefined;
  /** The golden snapshot is published: actors may be created from it. */
  readonly goldenReady: boolean;
  /** Non-empty when publishing the golden snapshot failed; terminal. */
  readonly goldenError: string;
}

/** One binding the server wants on its atespace's access policy. */
export interface AtespaceGrant {
  readonly role: "editor";
  /** A policy member, `user:<principal id>`. */
  readonly member: string;
}

/**
 * What ensuring the atespace's access policy did: created it, added the
 * bindings it lacked, found every binding there, or was refused the write
 * (this server is no owner of the atespace).
 */
export type AtespacePolicyOutcome = "created" | "added" | "complete" | "denied";

export interface AtespaceOutcome {
  readonly policy: AtespacePolicyOutcome;
  /** The bindings asked for, so a refusal can name them. */
  readonly grants: readonly AtespaceGrant[];
}

export interface SubstrateGateway {
  /** Makes the atespace exist and its access policy hold the server's grants (module header). */
  ensureAtespace(): Promise<AtespaceOutcome>;
  getActor(name: string): Promise<SubstrateActorView | undefined>;
  listActors(): Promise<SubstrateActorView[]>;
  createActor(name: string, template: string): Promise<"created" | "exists">;
  /** Repoint a SUSPENDED actor at another template; "refused" when Substrate will not. */
  moveActor(
    actor: SubstrateActorView,
    template: string,
  ): Promise<"moved" | "refused">;
  resumeActor(name: string): Promise<void>;
  /** Returns once the snapshot is on the actor's node; storage follows in the background. */
  suspendActor(name: string): Promise<void>;
  revertActor(name: string): Promise<void>;
  /** In any state; an absent actor is success. */
  deleteActor(name: string): Promise<void>;
  /**
   * Makes the actor's egress policy exactly `rules`: creates it, or, when one
   * exists with other rules, replaces it at the version read.
   */
  ensureEgressPolicy(
    name: string,
    rules: readonly EgressRule[],
  ): Promise<"created" | "unchanged" | "replaced">;
  getTemplate(name: string): Promise<SubstrateTemplateView | undefined>;
  listTemplates(): Promise<SubstrateTemplateView[]>;
  createTemplate(template: ActorTemplate): Promise<"created" | "exists">;
  /** Deletes the template at the version read; an absent one is success. */
  deleteTemplate(template: SubstrateTemplateView): Promise<void>;
}

/** Deadline of an ordinary call. */
const CALL_TIMEOUT_MS = 30_000;
/**
 * Deadline of the calls that move an actor's memory or files: a resume
 * waits for the restore and the wakeup probe (30 s by Substrate's
 * default), a suspend for the snapshot on the node, and a delete for the
 * actor's worker to let go.
 */
const LIFECYCLE_TIMEOUT_MS = 120_000;
/** The largest page Substrate serves. */
const PAGE_SIZE = 1000;
/** An actor has at most one egress policy, and it is named so. */
const EGRESS_POLICY_NAME = "default";
/** An atespace has at most one access policy, and it is named so. */
const ACCESS_POLICY_NAME = "default";
/** How often a policy write that lost a race is read and tried again. */
const POLICY_ATTEMPTS = 3;

/** A bearer-token interceptor over a file, re-read when its mtime moves. */
export function bearerFromFile(path: string): Interceptor {
  let cached: { mtimeMs: number; token: string } | undefined;
  const token = (): string => {
    const mtimeMs = statSync(path).mtimeMs;
    if (cached === undefined || cached.mtimeMs !== mtimeMs) {
      cached = { mtimeMs, token: readFileSync(path, "utf8").trim() };
    }
    return cached.token;
  };
  return (next) => (request) => {
    request.header.set("authorization", `Bearer ${token()}`);
    return next(request);
  };
}

/** The live gateway: gRPC over TLS 1.3 to the configured Control API. */
export function newSubstrateClientGateway(
  settings: SubstrateDriverSettings,
): SubstrateGateway {
  const url = new URL(settings.apiEndpoint);
  // One interceptor for every connection, so the token's cache outlives a
  // CA rotation.
  const interceptors = [bearerFromFile(settings.apiTokenFile)];
  const tls = {
    servername:
      settings.apiServerName !== "" ? settings.apiServerName : url.hostname,
    minVersion: "TLSv1.3" as const,
  };
  const transport =
    settings.apiCaFile === ""
      ? createGrpcTransport({
          baseUrl: settings.apiEndpoint,
          interceptors,
          nodeOptions: tls,
        })
      : transportFollowingCa(
          caFromFile(
            settings.apiCaFile,
            API_CA_FILE_VARIABLE,
            "the Control API's CA",
          ),
          (ca) => {
            // Given a session manager, the transport takes its TLS options
            // from it and ignores nodeOptions.
            const sessionManager = new Http2SessionManager(
              settings.apiEndpoint,
              undefined,
              { ...tls, ca },
            );
            return {
              sessionManager,
              transport: createGrpcTransport({
                baseUrl: settings.apiEndpoint,
                interceptors,
                sessionManager,
              }),
            };
          },
        );
  return newSubstrateGatewayOverTransport(transport, settings.atespace, {
    principal: () => subjectOfTokenFile(settings.apiTokenFile),
  });
}

/** One transport built under one CA, and the HTTP/2 session manager its connection lives in. */
export interface CaGeneration {
  readonly transport: Transport;
  readonly sessionManager: Pick<Http2SessionManager, "abort">;
}

/**
 * A transport that follows a CA: before each call it reads `ca`, and when
 * the CA changed (by identity) it builds a new generation under it and
 * retires the old one, whose connection was trusted under the replaced
 * CA. A retired generation's calls in flight finish on it, as the
 * router's requests do on a retired agent (push.ts), and its session is
 * closed when the last one settles, at once when none is in flight,
 * rather than at the session manager's own 15-minute idle timeout. A
 * unary call is in flight until it settles; a stream until its messages
 * end or the call rejects. A `ca` that throws fails the call, and the
 * next call reads it again.
 */
export function transportFollowingCa(
  ca: () => string,
  build: (ca: string) => CaGeneration,
): Transport {
  interface Live {
    readonly ca: string;
    readonly generation: CaGeneration;
    inFlight: number;
    retired: boolean;
  }
  let current: Live | undefined;
  const closeIfDone = (live: Live): void => {
    if (live.retired && live.inFlight === 0)
      live.generation.sessionManager.abort();
  };
  const begin = (): Live => {
    const pem = ca();
    if (current === undefined || current.ca !== pem) {
      const replaced = current;
      current = {
        ca: pem,
        generation: build(pem),
        inFlight: 0,
        retired: false,
      };
      if (replaced !== undefined) {
        replaced.retired = true;
        closeIfDone(replaced);
      }
    }
    current.inFlight += 1;
    return current;
  };
  const settle = (live: Live): void => {
    live.inFlight -= 1;
    closeIfDone(live);
  };
  return {
    async unary(method, signal, timeoutMs, header, input, contextValues) {
      const live = begin();
      try {
        return await live.generation.transport.unary(
          method,
          signal,
          timeoutMs,
          header,
          input,
          contextValues,
        );
      } finally {
        settle(live);
      }
    },
    async stream(method, signal, timeoutMs, header, input, contextValues) {
      const live = begin();
      let response;
      try {
        response = await live.generation.transport.stream(
          method,
          signal,
          timeoutMs,
          header,
          input,
          contextValues,
        );
      } catch (error) {
        settle(live);
        throw error;
      }
      const messages = response.message;
      return {
        ...response,
        message: (async function* () {
          try {
            yield* messages;
          } finally {
            settle(live);
          }
        })(),
      };
    },
  };
}

/** The subject of the token in `path`; undefined when the file cannot be read or names none. */
export function subjectOfTokenFile(path: string): string | undefined {
  try {
    return tokenSubject(readFileSync(path, "utf8"));
  } catch {
    return undefined;
  }
}

/**
 * A token's subject, the principal Substrate names its bearer by, read
 * from the JWT's payload without verifying it (Substrate verifies it);
 * undefined for a token that is no JWT or names no subject.
 */
export function tokenSubject(token: string): string | undefined {
  const payload = token.trim().split(".")[1];
  if (payload === undefined) return undefined;
  try {
    const claims: unknown = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    );
    const sub =
      typeof claims === "object" && claims !== null && "sub" in claims
        ? claims.sub
        : undefined;
    return typeof sub === "string" && sub !== "" ? sub : undefined;
  } catch {
    return undefined;
  }
}

/** A principal id as a policy member: `user:<id>`, as Substrate's policies name them. */
export function policyMember(principal: string): string {
  return principal.startsWith("user:") ? principal : `user:${principal}`;
}

/**
 * The bindings `bindings` gains from `grants`: every one it lacks added,
 * none removed; undefined when it lacks none.
 */
export function withGrants(
  bindings: readonly { readonly role: string; readonly members: readonly string[] }[],
  grants: readonly AtespaceGrant[],
): { role: string; members: string[] }[] | undefined {
  const merged = bindings.map((binding) => ({
    role: binding.role,
    members: [...binding.members],
  }));
  let changed = false;
  for (const grant of grants) {
    const binding = merged.find((candidate) => candidate.role === grant.role);
    if (binding === undefined) {
      merged.push({ role: grant.role, members: [grant.member] });
      changed = true;
    } else if (!binding.members.includes(grant.member)) {
      binding.members.push(grant.member);
      changed = true;
    }
  }
  return changed ? merged : undefined;
}

/** The gateway over any transport: the live one above, or a test's in-process one. */
export function newSubstrateGatewayOverTransport(
  transport: Transport,
  atespace: string,
  access: {
    /** This server's principal id, or undefined when it cannot be known. */
    readonly principal: () => string | undefined;
  } = { principal: () => undefined },
): SubstrateGateway {
  const client = createClient(Control, transport);
  const ref = (name: string) => create(ObjectRefSchema, { atespace, name });
  const call = { timeoutMs: CALL_TIMEOUT_MS };
  const lifecycle = { timeoutMs: LIFECYCLE_TIMEOUT_MS };

  return {
    async ensureAtespace() {
      // An atespace is global: its reference names it and nothing else.
      const atespaceRef = create(ObjectRefSchema, { name: atespace });
      const principal = access.principal();
      const grants: AtespaceGrant[] =
        principal !== undefined
          ? [{ role: "editor", member: policyMember(principal) }]
          : [];
      const created = await translate(async () => {
        // Read first: under authorization, an atespace someone else created
        // and granted this server needs no global owner (module header).
        try {
          await client.getAtespace({ atespace: atespaceRef }, call);
          return false;
        } catch (error) {
          if (!hasCode(error, Code.NotFound)) throw error;
        }
        try {
          await client.createAtespace(
            {
              atespace: create(AtespaceSchema, {
                metadata: { name: atespace },
              }),
            },
            call,
          );
          return true;
        } catch (error) {
          if (!hasCode(error, Code.AlreadyExists)) throw error;
          return false;
        }
      });
      if (grants.length === 0) return { policy: "complete", grants };

      const createPolicy = async (): Promise<"created" | "exists"> => {
        try {
          await client.createAtespaceAccessPolicy(
            {
              atespace: atespaceRef,
              accessPolicy: create(AccessPolicySchema, {
                metadata: { name: ACCESS_POLICY_NAME },
                bindings: withGrants([], grants) ?? [],
              }),
            },
            call,
          );
          return "created";
        } catch (error) {
          if (hasCode(error, Code.AlreadyExists)) return "exists";
          throw error;
        }
      };
      const policy = await translate(
        async (): Promise<AtespacePolicyOutcome> => {
          try {
            if (created && (await createPolicy()) === "created") {
              return "created";
            }
            for (let attempt = 1; ; attempt += 1) {
              let stored;
              try {
                stored = await client.getAtespaceAccessPolicy(
                  { atespace: atespaceRef, name: ACCESS_POLICY_NAME },
                  call,
                );
              } catch (error) {
                if (!hasCode(error, Code.NotFound)) throw error;
                if ((await createPolicy()) === "created") return "created";
                continue;
              }
              const bindings = withGrants(stored.bindings, grants);
              if (bindings === undefined) return "complete";
              stored.bindings = bindings.map((binding) =>
                create(BindingSchema, binding),
              );
              try {
                await client.updateAtespaceAccessPolicy(
                  { atespace: atespaceRef, accessPolicy: stored },
                  call,
                );
                return "added";
              } catch (error) {
                // Another writer moved it since the read: read it again.
                if (!hasCode(error, Code.Aborted) || attempt >= POLICY_ATTEMPTS)
                  throw error;
              }
            }
          } catch (error) {
            if (hasCode(error, Code.PermissionDenied)) return "denied";
            throw error;
          }
        },
      );
      return { policy, grants };
    },

    getActor: (name) =>
      translate(async () => {
        try {
          return actorView(await client.getActor({ actor: ref(name) }, call));
        } catch (error) {
          if (hasCode(error, Code.NotFound)) return undefined;
          throw error;
        }
      }),

    listActors: () =>
      translate(async () => {
        const actors: SubstrateActorView[] = [];
        let pageToken = "";
        do {
          const page = await client.listActors(
            { atespace, options: { pageSize: PAGE_SIZE, pageToken } },
            call,
          );
          actors.push(...page.actors.map(actorView));
          pageToken = page.nextPageToken;
        } while (pageToken !== "");
        return actors;
      }),

    createActor: (name, template) =>
      translate(async () => {
        try {
          await client.createActor(
            {
              actor: create(ActorSchema, {
                metadata: { atespace, name },
                actorTemplate: ref(template),
              }),
            },
            call,
          );
          return "created";
        } catch (error) {
          if (hasCode(error, Code.AlreadyExists)) return "exists";
          throw error;
        }
      }),

    moveActor: (actor, template) =>
      translate(async () => {
        try {
          // A whole-object replace: what Substrate stored for this actor,
          // with only its template changed, under its uid and version.
          const stored = await client.getActor(
            { actor: ref(actor.name) },
            call,
          );
          if (
            stored.metadata?.uid !== actor.uid ||
            stored.metadata?.version !== actor.version
          ) {
            throw new SubstrateAbortedError(
              `actor ${actor.name} changed since it was read`,
            );
          }
          stored.actorTemplate = ref(template);
          stored.status = undefined;
          await client.updateActor({ actor: stored }, call);
          return "moved";
        } catch (error) {
          if (hasCode(error, Code.FailedPrecondition)) return "refused";
          throw error;
        }
      }),

    resumeActor: (name) =>
      translate(async () => {
        await client.resumeActor({ actor: ref(name) }, lifecycle);
      }),
    suspendActor: (name) =>
      translate(async () => {
        await client.suspendActor(
          {
            actor: ref(name),
            options: { mode: DurabilityMode.ASYNCHRONOUS },
          },
          lifecycle,
        );
      }),
    revertActor: (name) =>
      translate(async () => {
        await client.revertActor({ actor: ref(name) }, lifecycle);
      }),

    deleteActor: (name) =>
      translate(async () => {
        try {
          await client.deleteActor({ actor: ref(name) }, lifecycle);
        } catch (error) {
          if (!hasCode(error, Code.NotFound)) throw error;
        }
      }),

    ensureEgressPolicy: (name, rules) =>
      translate(async () => {
        try {
          await client.createActorEgressPolicy(
            {
              actor: ref(name),
              egressPolicy: create(EgressPolicySchema, {
                metadata: { atespace, name: EGRESS_POLICY_NAME },
                rules: [...rules],
              }),
            },
            call,
          );
          return "created";
        } catch (error) {
          if (!hasCode(error, Code.AlreadyExists)) throw error;
        }
        // One exists: replace it only when its rules differ, at the version
        // read (a concurrent writer answers ABORTED, and the caller re-reads).
        const stored = await client.getActorEgressPolicy(
          { actor: ref(name), name: EGRESS_POLICY_NAME },
          call,
        );
        if (
          stored.rules.length === rules.length &&
          rules.every((rule, i) => {
            const current = stored.rules[i];
            return (
              current !== undefined && equals(EgressRuleSchema, current, rule)
            );
          })
        ) {
          return "unchanged";
        }
        stored.rules = [...rules];
        await client.updateActorEgressPolicy(
          { actor: ref(name), egressPolicy: stored },
          call,
        );
        return "replaced";
      }),

    getTemplate: (name) =>
      translate(async () => {
        try {
          return templateView(
            await client.getActorTemplate({ actorTemplate: ref(name) }, call),
          );
        } catch (error) {
          if (hasCode(error, Code.NotFound)) return undefined;
          throw error;
        }
      }),

    listTemplates: () =>
      translate(async () => {
        const templates: SubstrateTemplateView[] = [];
        let pageToken = "";
        do {
          const page = await client.listActorTemplates(
            { atespace, options: { pageSize: PAGE_SIZE, pageToken } },
            call,
          );
          templates.push(...page.actorTemplates.map(templateView));
          pageToken = page.nextPageToken;
        } while (pageToken !== "");
        return templates;
      }),

    createTemplate: (template) =>
      translate(async () => {
        try {
          await client.createActorTemplate(
            { actorTemplate: create(ActorTemplateSchema, template) },
            call,
          );
          return "created";
        } catch (error) {
          if (hasCode(error, Code.AlreadyExists)) return "exists";
          throw error;
        }
      }),

    deleteTemplate: (template) =>
      translate(async () => {
        try {
          await client.deleteActorTemplate(
            {
              actorTemplate: ref(template.name),
              options: { uid: template.uid, version: template.version },
            },
            call,
          );
        } catch (error) {
          if (!hasCode(error, Code.NotFound)) throw error;
        }
      }),
  };
}

function hasCode(error: unknown, code: Code): boolean {
  return error instanceof ConnectError && error.code === code;
}

/** ABORTED, RESOURCE_EXHAUSTED and PERMISSION_DENIED into the driver's typed errors (module header). */
async function translate<T>(body: () => Promise<T>): Promise<T> {
  try {
    return await body();
  } catch (error) {
    if (hasCode(error, Code.PermissionDenied)) {
      throw new SubstratePermissionError(
        `Substrate's Control API refused this server (${(error as ConnectError).rawMessage}); with authorization on, the server's identity (its token's subject, system:serviceaccount:<namespace>:<name>) needs the editor role on its atespace, and the atespace must exist unless the server is a global owner`,
      );
    }
    if (hasCode(error, Code.Aborted)) {
      throw new SubstrateAbortedError((error as ConnectError).rawMessage);
    }
    if (hasCode(error, Code.ResourceExhausted)) {
      throw new SubstrateNoWorkerError((error as ConnectError).rawMessage);
    }
    throw error;
  }
}

function actorView(actor: Actor): SubstrateActorView {
  return {
    name: actor.metadata?.name ?? "",
    uid: actor.metadata?.uid ?? "",
    version: actor.metadata?.version ?? 0n,
    state: stateOf(actor.status),
    template: actor.actorTemplate?.name ?? "",
    createTime: actor.metadata?.createTime
      ? timestampDate(actor.metadata.createTime)
      : undefined,
    updateTime: actor.metadata?.updateTime
      ? timestampDate(actor.metadata.updateTime)
      : undefined,
  };
}

function templateView(template: ActorTemplate): SubstrateTemplateView {
  const golden = template.status?.goldenSnapshotStatus;
  return {
    name: template.metadata?.name ?? "",
    uid: template.metadata?.uid ?? "",
    version: template.metadata?.version ?? 0n,
    createTime: template.metadata?.createTime
      ? timestampDate(template.metadata.createTime)
      : undefined,
    goldenReady: (golden?.goldenTag?.name ?? "") !== "",
    goldenError: golden?.errorMessage ?? "",
  };
}

/** Substrate's state in the driver's words (module header). */
export function stateOf(status: ActorStatus | undefined): SubstrateSandboxState {
  const state = status?.state ?? ActorState.UNSPECIFIED;
  switch (state) {
    case ActorState.RESUMING:
      return "resuming";
    case ActorState.RUNNING:
      return "running";
    case ActorState.SUSPENDING:
      return "suspending";
    case ActorState.SUSPENDED:
      return "suspended";
    case ActorState.CRASHED:
      return "crashed";
    case ActorState.DELETING:
      return "deleting";
    case ActorState.REVERTING:
      return "reverting";
    case ActorState.UNSPECIFIED:
      return "unknown";
    default: {
      // Only a number outside the enum reaches here, from another release.
      const unexpected: never = state;
      void unexpected;
      return "unknown";
    }
  }
}
