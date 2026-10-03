/**
 * The substrate driver's gateway: the ONLY surface that touches Agent
 * Substrate's Control API (the kubernetes driver's KubernetesSandboxGateway
 * shape), so the driver's logic stays pure above it and a test drives it
 * with a fake.
 *
 * The client speaks native gRPC over HTTP/2 and TLS 1.3, because that is
 * all the Control API serves (a plain gRPC server, no Connect or gRPC-Web
 * handler), and sends `authorization: Bearer <token>` with every call, the
 * token read from a file and re-read when the file changes (a projected
 * ServiceAccount token rotates under a running server). The stubs are
 * generated from the Substrate release this server speaks to
 * (../../../buf.gen.substrate.yaml): Substrate refuses any field it does
 * not know, so they must match the deployment's release exactly.
 *
 * Errors are translated where the driver must act on them and passed on
 * otherwise: NOT_FOUND becomes "absent" on reads and success on deletes,
 * ALREADY_EXISTS success on creates, FAILED_PRECONDITION a refused move.
 * ABORTED becomes SubstrateAbortedError and is never retried here,
 * because Substrate uses it both for a lease held by another operation
 * and for an actor that crashed while resuming; the driver answers it by
 * re-reading the actor, which handles both. RESOURCE_EXHAUSTED (no free
 * worker) becomes SubstrateNoWorkerError. Every call has a deadline.
 *
 * Substrate's Control API authorizes nobody: whoever holds this token
 * controls every actor, template and worker of that Substrate. The
 * operator guide says so.
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
import { createGrpcTransport } from "@connectrpc/connect-node";

import {
  ActorSchema,
  ActorState,
  ActorTemplateSchema,
  AtespaceSchema,
  Control,
  EgressPolicySchema,
  EgressRuleSchema,
  ObjectRefSchema,
  type Actor,
  type ActorTemplate,
  type EgressRule,
} from "./gen/ateapipb/ateapi_pb.js";
import type { SubstrateDriverSettings } from "./config.js";

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

/** One actor as the driver sees it. */
export interface SubstrateActorView {
  readonly name: string;
  readonly uid: string;
  readonly version: bigint;
  readonly state: ActorState;
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

export interface SubstrateGateway {
  ensureAtespace(): Promise<void>;
  getActor(name: string): Promise<SubstrateActorView | undefined>;
  listActors(): Promise<SubstrateActorView[]>;
  createActor(name: string, template: string): Promise<"created" | "exists">;
  /** Repoint a SUSPENDED actor at another template; "refused" when Substrate will not. */
  moveActor(
    actor: SubstrateActorView,
    template: string,
  ): Promise<"moved" | "refused">;
  resumeActor(name: string): Promise<void>;
  pauseActor(name: string): Promise<void>;
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
 * default), a suspend for the commit to storage.
 */
const LIFECYCLE_TIMEOUT_MS = 120_000;
/** The largest page Substrate serves. */
const PAGE_SIZE = 1000;

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
  const transport = createGrpcTransport({
    baseUrl: settings.apiEndpoint,
    interceptors: [bearerFromFile(settings.apiTokenFile)],
    nodeOptions: {
      servername:
        settings.apiServerName !== "" ? settings.apiServerName : url.hostname,
      minVersion: "TLSv1.3",
      ...(settings.apiCaFile !== ""
        ? { ca: readFileSync(settings.apiCaFile, "utf8") }
        : {}),
    },
  });
  return newSubstrateGatewayOverTransport(transport, settings.atespace);
}

/** The gateway over any transport: the live one above, or a test's in-process one. */
export function newSubstrateGatewayOverTransport(
  transport: Transport,
  atespace: string,
): SubstrateGateway {
  const client = createClient(Control, transport);
  const ref = (name: string) => create(ObjectRefSchema, { atespace, name });
  const call = { timeoutMs: CALL_TIMEOUT_MS };
  const lifecycle = { timeoutMs: LIFECYCLE_TIMEOUT_MS };

  return {
    async ensureAtespace() {
      await translate(async () => {
        try {
          await client.createAtespace(
            {
              atespace: create(AtespaceSchema, {
                metadata: { name: atespace },
              }),
            },
            call,
          );
        } catch (error) {
          if (!hasCode(error, Code.AlreadyExists)) throw error;
        }
      });
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
            { atespace, pageSize: PAGE_SIZE, pageToken },
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
    pauseActor: (name) =>
      translate(async () => {
        await client.pauseActor({ actor: ref(name) }, lifecycle);
      }),
    suspendActor: (name) =>
      translate(async () => {
        await client.suspendActor({ actor: ref(name) }, lifecycle);
      }),
    revertActor: (name) =>
      translate(async () => {
        await client.revertActor({ actor: ref(name) }, lifecycle);
      }),

    deleteActor: (name) =>
      translate(async () => {
        try {
          await client.deleteActor(
            { actor: ref(name), anyState: true },
            lifecycle,
          );
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
                // An actor has at most one policy, and it is named "default".
                metadata: { atespace, name: "default" },
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
          { actor: ref(name) },
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
            { atespace, pageSize: PAGE_SIZE, pageToken },
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

/** ABORTED and RESOURCE_EXHAUSTED into the driver's two typed errors (module header). */
async function translate<T>(body: () => Promise<T>): Promise<T> {
  try {
    return await body();
  } catch (error) {
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
    state: actor.status?.state ?? ActorState.UNSPECIFIED,
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
