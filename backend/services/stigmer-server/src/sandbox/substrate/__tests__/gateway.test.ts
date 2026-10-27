/**
 * Pins the gateway against the generated Control service, served in
 * process (gateway.ts), with no network, and the live client against it
 * served over HTTP/2 and TLS under CAs minted at test time:
 *
 *   - every call carries `authorization: Bearer <token>` from the token
 *     file, re-read when the file changes;
 *   - NOT_FOUND reads as absent and deletes as success; ALREADY_EXISTS
 *     creates as "exists"; FAILED_PRECONDITION moves as "refused";
 *   - ABORTED and RESOURCE_EXHAUSTED become the driver's two typed errors,
 *     and PERMISSION_DENIED one naming the grant the server needs;
 *   - the atespace is read first and created only when it is missing, so
 *     an atespace granted to the server needs no global owner;
 *   - an actor's state is Substrate's, whatever snapshot it holds;
 *   - a suspend asks for Substrate's asynchronous mode, and a delete sends
 *     the actor's reference alone;
 *   - the atespace's access policy: created with the atespace, holding
 *     `editor` for the server's principal and nothing else; on an
 *     existing atespace, the binding it lacks added and none
 *     removed, at the version read (read again after a lost race), nothing
 *     written when it holds them all; a refused write reported as denied,
 *     never thrown; the principal read from the token's subject;
 *   - the egress policy is read by its singleton name, "default";
 *   - lists follow page tokens, in Substrate's list options;
 *   - a move replaces the stored actor with only its template changed, and
 *     refuses one that changed since it was read;
 *   - the live client's CA follows its file: a CA file replaced on disk is
 *     trusted from the next call, on a new connection, and the connection
 *     made under the old CA is closed, at once when idle and after the
 *     call in flight across the rotation finishes; a file unusable after
 *     boot fails the call naming its variable and is read again on the
 *     next; a CA file whose certificate cannot be parsed is a boot throw;
 *   - under that, transportFollowingCa builds one generation per CA and
 *     closes a replaced one when its last call settles: a unary call when
 *     it settles, a stream when its messages end or the call rejects.
 */
import { mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import * as http2 from "node:http2";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";

import { create } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import {
  Code,
  ConnectError,
  createRouterTransport,
  type ServiceImpl,
  type Transport,
} from "@connectrpc/connect";
import { connectNodeAdapter } from "@connectrpc/connect-node";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { SubstrateDriverSettings } from "../config.js";
import {
  mintCa,
  mintServerCertificate,
  type TestCa,
  type TestServerCertificate,
} from "../__test-utils__/test-ca.js";

import {
  AccessPolicySchema,
  ActorSchema,
  ActorState,
  ActorTemplateSchema,
  Control,
  DurabilityMode,
  EgressPolicySchema,
  EgressRuleSchema,
} from "../gen/ateapipb/ateapi_pb.js";
import {
  bearerFromFile,
  newSubstrateClientGateway,
  newSubstrateGatewayOverTransport,
  stateOf,
  subjectOfTokenFile,
  tokenSubject,
  transportFollowingCa,
  type CaGeneration,
  SubstrateAbortedError,
  SubstrateNoWorkerError,
  SubstratePermissionError,
} from "../gateway.js";

let dir: string;
let tokenFile: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "substrate-gateway-test-"));
  tokenFile = path.join(dir, "token");
  writeFileSync(tokenFile, "token-one\n");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function gatewayOver(impl: Partial<ServiceImpl<typeof Control>>) {
  const transport = createRouterTransport(
    (router) => {
      router.service(Control, impl);
    },
    { transport: { interceptors: [bearerFromFile(tokenFile)] } },
  );
  return newSubstrateGatewayOverTransport(transport, "stigmer");
}

const actor = (
  name: string,
  state: ActorState,
  version = 3n,
  snapshots: { locality: string; durable: boolean }[] = [],
) =>
  create(ActorSchema, {
    metadata: {
      atespace: "stigmer",
      name,
      uid: `uid-${name}`,
      version,
      createTime: timestampFromDate(new Date("2026-10-03T10:00:00Z")),
      updateTime: timestampFromDate(new Date("2026-10-03T11:00:00Z")),
    },
    actorTemplate: { atespace: "stigmer", name: "stigmer-runner-old" },
    status: {
      state,
      lastAssignedGeneration: snapshots.length,
      snapshots: snapshots.map((snapshot, i) => ({
        uuid: `snap-${i + 1}`,
        generation: i + 1,
        locality: snapshot.locality,
        ...(snapshot.durable
          ? {
              durableSnapshot: {
                object: { snapshotUri: `gs://b/snap-${i + 1}` },
              },
            }
          : {}),
      })),
    },
  });
/** The snapshot an asynchronous suspend leaves: on its node, its upload not yet recorded. */
const NODE_SNAPSHOT = { locality: "node-1", durable: false };
/** The snapshot a suspend leaves: in storage. */
const STORED_SNAPSHOT = { locality: "", durable: true };

describe("the bearer token", () => {
  it("rides every call and follows the file when it changes", async () => {
    const seen: string[] = [];
    const gateway = gatewayOver({
      getActor(request, context) {
        seen.push(context.requestHeader.get("authorization") ?? "");
        return actor(request.actor?.name ?? "", ActorState.RUNNING);
      },
    });
    await gateway.getActor("a");
    writeFileSync(tokenFile, "token-two\n");
    const later = new Date(Date.now() + 5_000);
    utimesSync(tokenFile, later, later);
    await gateway.getActor("a");
    expect(seen).toEqual(["Bearer token-one", "Bearer token-two"]);
  });
});

describe("error translation", () => {
  it("NOT_FOUND reads as absent and deletes as success", async () => {
    const notFound = () => {
      throw new ConnectError("nope", Code.NotFound);
    };
    const gateway = gatewayOver({
      getActor: notFound,
      deleteActor: notFound,
      getActorTemplate: notFound,
      deleteActorTemplate: notFound,
    });
    expect(await gateway.getActor("a")).toBeUndefined();
    expect(await gateway.getTemplate("t")).toBeUndefined();
    await expect(gateway.deleteActor("a")).resolves.toBeUndefined();
    await expect(
      gateway.deleteTemplate({
        name: "t",
        uid: "u",
        version: 1n,
        createTime: undefined,
        goldenReady: false,
        goldenError: "",
      }),
    ).resolves.toBeUndefined();
  });

  it("ALREADY_EXISTS creates as exists, and an existing policy or atespace is success", async () => {
    const exists = () => {
      throw new ConnectError("dup", Code.AlreadyExists);
    };
    const gateway = gatewayOver({
      createActor: exists,
      createActorTemplate: exists,
      createActorEgressPolicy: exists,
      getActorEgressPolicy: () =>
        create(EgressPolicySchema, {
          metadata: { name: "default" },
          rules: [],
        }),
      getAtespace() {
        throw new ConnectError("no atespace", Code.NotFound);
      },
      createAtespace: exists,
    });
    expect(await gateway.createActor("a", "t")).toBe("exists");
    expect(
      await gateway.createTemplate(
        create(ActorTemplateSchema, { metadata: { name: "t" } }),
      ),
    ).toBe("exists");
    expect(await gateway.ensureEgressPolicy("a", [])).toBe("unchanged");
    await expect(gateway.ensureAtespace()).resolves.toEqual({
      policy: "complete",
      grants: [],
    });
  });

  it("ABORTED and RESOURCE_EXHAUSTED become the driver's typed errors; anything else passes through", async () => {
    const gateway = gatewayOver({
      resumeActor() {
        throw new ConnectError("actor a crashed", Code.Aborted);
      },
      revertActor() {
        throw new ConnectError(
          "no free workers available",
          Code.ResourceExhausted,
        );
      },
      suspendActor() {
        throw new ConnectError("boom", Code.Internal);
      },
    });
    await expect(gateway.resumeActor("a")).rejects.toBeInstanceOf(
      SubstrateAbortedError,
    );
    await expect(gateway.revertActor("a")).rejects.toBeInstanceOf(
      SubstrateNoWorkerError,
    );
    await expect(gateway.suspendActor("a")).rejects.toMatchObject({
      code: Code.Internal,
    });
  });

  it("PERMISSION_DENIED names the grant the server needs", async () => {
    const gateway = gatewayOver({
      createActor() {
        throw new ConnectError("permission denied", Code.PermissionDenied);
      },
    });
    const refusal = gateway.createActor("a", "t");
    await expect(refusal).rejects.toBeInstanceOf(SubstratePermissionError);
    await expect(refusal).rejects.toThrow(
      /needs the editor role on its atespace/,
    );
  });
});

describe("the atespace", () => {
  it("is read first, and an existing one is never created, so a granted atespace needs no global owner", async () => {
    const seen: string[] = [];
    const gateway = gatewayOver({
      getAtespace(request) {
        // Global: the reference carries the name only (Substrate refuses an atespace in it).
        seen.push(
          `get ${request.atespace?.atespace ?? ""}/${request.atespace?.name ?? ""}`,
        );
        return { metadata: { name: request.atespace?.name ?? "" } };
      },
      createAtespace() {
        seen.push("create");
        throw new ConnectError("permission denied", Code.PermissionDenied);
      },
    });
    await gateway.ensureAtespace();
    expect(seen).toEqual(["get /stigmer"]);
  });

  it("is created when it is missing", async () => {
    const seen: string[] = [];
    const gateway = gatewayOver({
      getAtespace() {
        seen.push("get");
        throw new ConnectError("no atespace", Code.NotFound);
      },
      createAtespace(request) {
        seen.push(`create ${request.atespace?.metadata?.name ?? ""}`);
        return request.atespace ?? {};
      },
    });
    await gateway.ensureAtespace();
    expect(seen).toEqual(["get", "create stigmer"]);
  });
});

describe("the atespace's access policy", () => {
  const SERVER = "system:serviceaccount:stigmer:stigmer-server";
  const ATELET = "spiffe://cluster.local/ns/ate-system/sa/atelet";
  const wanted = [{ role: "editor", member: `user:${SERVER}` }];

  function withAccess(impl: Partial<ServiceImpl<typeof Control>>) {
    const transport = createRouterTransport((router) => {
      router.service(Control, impl);
    });
    return newSubstrateGatewayOverTransport(transport, "stigmer", {
      principal: () => SERVER,
    });
  }
  const missing = () => {
    throw new ConnectError("absent", Code.NotFound);
  };
  const denied = () => {
    throw new ConnectError("permission denied", Code.PermissionDenied);
  };
  const stored = (bindings: { role: string; members: string[] }[]) =>
    create(AccessPolicySchema, {
      metadata: { name: "default", uid: "pol-1", version: 4n },
      bindings,
    });

  it("is created with a new atespace, holding the server's editor and nothing for the node agent", async () => {
    let written: unknown;
    const gateway = withAccess({
      getAtespace: missing,
      createAtespace: (request) => request.atespace ?? {},
      createAtespaceAccessPolicy(request) {
        written = request;
        return request.accessPolicy ?? {};
      },
    });
    expect(await gateway.ensureAtespace()).toEqual({
      policy: "created",
      grants: wanted,
    });
    expect(written).toMatchObject({
      atespace: { atespace: "", name: "stigmer" },
      accessPolicy: {
        metadata: { name: "default" },
        bindings: [{ role: "editor", members: [`user:${SERVER}`] }],
      },
    });
  });

  it("gains only the binding an existing atespace's policy lacks, keeping every other, at the version read", async () => {
    let written: unknown;
    const gateway = withAccess({
      getAtespace: (request) => ({ metadata: { name: request.atespace?.name ?? "" } }),
      getAtespaceAccessPolicy: () =>
        stored([
          { role: "owner", members: ["user:admin"] },
          { role: "editor", members: ["user:someone-else"] },
        ]),
      updateAtespaceAccessPolicy(request) {
        written = request.accessPolicy;
        return request.accessPolicy ?? {};
      },
    });
    expect((await gateway.ensureAtespace()).policy).toBe("added");
    expect(written).toMatchObject({
      metadata: { name: "default", uid: "pol-1", version: 4n },
      bindings: [
        { role: "owner", members: ["user:admin"] },
        { role: "editor", members: ["user:someone-else", `user:${SERVER}`] },
      ],
    });
  });

  it("writes nothing when the policy already holds the binding, and removes none (an upgraded atespace's node-agent viewer stays)", async () => {
    let writes = 0;
    const gateway = withAccess({
      getAtespace: () => ({ metadata: { name: "stigmer" } }),
      getAtespaceAccessPolicy: () =>
        stored([
          { role: "editor", members: [`user:${SERVER}`] },
          { role: "viewer", members: ["user:other", `user:${ATELET}`] },
        ]),
      updateAtespaceAccessPolicy() {
        writes += 1;
        return stored([]);
      },
    });
    expect((await gateway.ensureAtespace()).policy).toBe("complete");
    expect(writes).toBe(0);
  });

  it("reports a write it may not make as denied, never thrown, for a new atespace and an existing one", async () => {
    const fresh = withAccess({
      getAtespace: missing,
      createAtespace: (request) => request.atespace ?? {},
      createAtespaceAccessPolicy: denied,
    });
    expect((await fresh.ensureAtespace()).policy).toBe("denied");
    const existing = withAccess({
      getAtespace: () => ({ metadata: { name: "stigmer" } }),
      getAtespaceAccessPolicy: () => stored([]),
      updateAtespaceAccessPolicy: denied,
    });
    expect((await existing.ensureAtespace()).policy).toBe("denied");
    const unreadable = withAccess({
      getAtespace: () => ({ metadata: { name: "stigmer" } }),
      getAtespaceAccessPolicy: denied,
    });
    expect((await unreadable.ensureAtespace()).policy).toBe("denied");
  });

  it("creates the policy an existing atespace lacks, and reads it again after losing a race", async () => {
    const lacking = withAccess({
      getAtespace: () => ({ metadata: { name: "stigmer" } }),
      getAtespaceAccessPolicy: missing,
      createAtespaceAccessPolicy: (request) => request.accessPolicy ?? {},
    });
    expect((await lacking.ensureAtespace()).policy).toBe("created");
    let updates = 0;
    const raced = withAccess({
      getAtespace: () => ({ metadata: { name: "stigmer" } }),
      getAtespaceAccessPolicy: () => stored([]),
      updateAtespaceAccessPolicy(request) {
        updates += 1;
        if (updates === 1) throw new ConnectError("version moved", Code.Aborted);
        return request.accessPolicy ?? {};
      },
    });
    expect((await raced.ensureAtespace()).policy).toBe("added");
    expect(updates).toBe(2);
  });

  it("names the server by its token's subject", () => {
    const claims = Buffer.from(JSON.stringify({ sub: SERVER })).toString(
      "base64url",
    );
    expect(tokenSubject(`e30.${claims}.c2ln\n`)).toBe(SERVER);
    expect(tokenSubject("not-a-jwt")).toBeUndefined();
    expect(tokenSubject(`e30.${Buffer.from("{}").toString("base64url")}.x`)).toBeUndefined();
    expect(tokenSubject("e30.!!!.x")).toBeUndefined();
    const file = path.join(dir, "jwt");
    writeFileSync(file, `e30.${claims}.c2ln`);
    expect(subjectOfTokenFile(file)).toBe(SERVER);
    expect(subjectOfTokenFile(path.join(dir, "absent"))).toBeUndefined();
  });

  it("asks for nothing, and reads no policy, when the server's principal cannot be known", async () => {
    let policyCalls = 0;
    const transport = createRouterTransport((router) => {
      router.service(Control, {
        getAtespace: () => ({ metadata: { name: "stigmer" } }),
        getAtespaceAccessPolicy() {
          policyCalls += 1;
          return stored([]);
        },
      });
    });
    const gateway = newSubstrateGatewayOverTransport(transport, "stigmer", {
      principal: () => undefined,
    });
    expect(await gateway.ensureAtespace()).toEqual({
      policy: "complete",
      grants: [],
    });
    expect(policyCalls).toBe(0);
  });

  it("falls back to reading a policy someone else created first, and gives up after three lost races", async () => {
    const beaten = withAccess({
      getAtespace: missing,
      createAtespace: (request) => request.atespace ?? {},
      createAtespaceAccessPolicy() {
        throw new ConnectError("dup", Code.AlreadyExists);
      },
      getAtespaceAccessPolicy: () => stored([]),
      updateAtespaceAccessPolicy: (request) => request.accessPolicy ?? {},
    });
    expect((await beaten.ensureAtespace()).policy).toBe("added");
    let reads = 0;
    const appeared = withAccess({
      getAtespace: () => ({ metadata: { name: "stigmer" } }),
      getAtespaceAccessPolicy() {
        reads += 1;
        if (reads === 1) throw new ConnectError("absent", Code.NotFound);
        return stored([{ role: "editor", members: [`user:${SERVER}`] }]);
      },
      createAtespaceAccessPolicy() {
        throw new ConnectError("dup", Code.AlreadyExists);
      },
    });
    expect((await appeared.ensureAtespace()).policy).toBe("complete");
    const losing = withAccess({
      getAtespace: () => ({ metadata: { name: "stigmer" } }),
      getAtespaceAccessPolicy: () => stored([]),
      updateAtespaceAccessPolicy() {
        throw new ConnectError("version moved", Code.Aborted);
      },
    });
    await expect(losing.ensureAtespace()).rejects.toBeInstanceOf(
      SubstrateAbortedError,
    );
  });
});

describe("an actor's state", () => {
  it("reads Substrate's state alone, whichever snapshot the actor holds", () => {
    const stateOfActor = (
      state: ActorState,
      snapshots: { locality: string; durable: boolean }[] = [],
    ) => stateOf(actor("a", state, 1n, snapshots).status);
    // Suspended with its snapshot on its node, in storage, or both: one state.
    expect(stateOfActor(ActorState.SUSPENDED)).toBe("suspended");
    expect(stateOfActor(ActorState.SUSPENDED, [NODE_SNAPSHOT])).toBe(
      "suspended",
    );
    expect(stateOfActor(ActorState.SUSPENDED, [STORED_SNAPSHOT])).toBe(
      "suspended",
    );
    expect(
      stateOfActor(ActorState.SUSPENDED, [STORED_SNAPSHOT, NODE_SNAPSHOT]),
    ).toBe("suspended");
    expect(
      stateOfActor(ActorState.SUSPENDING, [
        STORED_SNAPSHOT,
        { locality: "", durable: false },
      ]),
    ).toBe("suspending");
    expect(stateOfActor(ActorState.RUNNING, [NODE_SNAPSHOT])).toBe("running");
    expect(stateOfActor(ActorState.RESUMING)).toBe("resuming");
    expect(stateOfActor(ActorState.CRASHED)).toBe("crashed");
    expect(stateOfActor(ActorState.DELETING)).toBe("deleting");
    expect(stateOfActor(ActorState.REVERTING)).toBe("reverting");
    expect(stateOfActor(ActorState.UNSPECIFIED)).toBe("unknown");
    expect(stateOf(undefined)).toBe("unknown");
    // A state only another release sends (the stubs are this release's).
    expect(stateOfActor(42 as ActorState)).toBe("unknown");
  });
});

describe("an existing egress policy", () => {
  it("is replaced at the version read when its rules differ, and left when they match", async () => {
    let updated: unknown;
    const read: string[] = [];
    const rule = create(EgressRuleSchema, {
      http: { hostnames: ["stigmer.example"], ports: { numbers: [7234] } },
    });
    let storedRules = [rule];
    const gateway = gatewayOver({
      createActorEgressPolicy() {
        throw new ConnectError("dup", Code.AlreadyExists);
      },
      getActorEgressPolicy: (request) => {
        read.push(`${request.actor?.name ?? ""}/${request.name}`);
        return create(EgressPolicySchema, {
          metadata: { name: "default", uid: "pol-1", version: 7n },
          rules: storedRules,
        });
      },
      updateActorEgressPolicy(request) {
        updated = request.egressPolicy;
        return request.egressPolicy ?? create(EgressPolicySchema, {});
      },
    });
    expect(await gateway.ensureEgressPolicy("a", [rule])).toBe("unchanged");
    expect(read).toEqual(["a/default"]);
    expect(updated).toBeUndefined();
    const wildcard = create(EgressRuleSchema, { https: { hostnames: ["*"] } });
    expect(await gateway.ensureEgressPolicy("a", [rule, wildcard])).toBe(
      "replaced",
    );
    expect(updated).toMatchObject({
      metadata: { name: "default", uid: "pol-1", version: 7n },
    });
    expect((updated as { rules: unknown[] }).rules).toHaveLength(2);
    storedRules = [wildcard];
    expect(await gateway.ensureEgressPolicy("a", [rule])).toBe("replaced");
  });
});

describe("lists and moves", () => {
  it("lists follow page tokens", async () => {
    const gateway = gatewayOver({
      listActors(request) {
        return (request.options?.pageToken ?? "") === ""
          ? { actors: [actor("a", ActorState.RUNNING)], nextPageToken: "p2" }
          : {
              actors: [
                actor("b", ActorState.SUSPENDED, 3n, [NODE_SNAPSHOT]),
              ],
              nextPageToken: "",
            };
      },
    });
    const actors = await gateway.listActors();
    expect(actors.map((a) => [a.name, a.state, a.template])).toEqual([
      ["a", "running", "stigmer-runner-old"],
      ["b", "suspended", "stigmer-runner-old"],
    ]);
    expect(actors[0]?.updateTime).toEqual(new Date("2026-10-03T11:00:00Z"));
  });

  it("a move replaces the stored actor with only its template changed", async () => {
    let updated: unknown;
    const gateway = gatewayOver({
      getActor: () => actor("a", ActorState.SUSPENDED),
      updateActor(request) {
        updated = request.actor;
        return request.actor ?? actor("a", ActorState.SUSPENDED);
      },
    });
    const view = (await gateway.getActor("a"))!;
    expect(await gateway.moveActor(view, "stigmer-runner-new")).toBe("moved");
    expect(updated).toMatchObject({
      metadata: { name: "a", uid: "uid-a", version: 3n },
      actorTemplate: { atespace: "stigmer", name: "stigmer-runner-new" },
    });
    // The status is Substrate's to keep; the update carries none.
    expect((updated as { status?: unknown }).status).toBeUndefined();
  });

  it("a move Substrate refuses reads as refused; one on a changed actor is ABORTED", async () => {
    let version = 3n;
    const gateway = gatewayOver({
      getActor: () => actor("a", ActorState.SUSPENDED, version),
      updateActor() {
        throw new ConnectError("volumes differ", Code.FailedPrecondition);
      },
    });
    const view = (await gateway.getActor("a"))!;
    expect(await gateway.moveActor(view, "t")).toBe("refused");
    version = 4n;
    await expect(gateway.moveActor(view, "t")).rejects.toBeInstanceOf(
      SubstrateAbortedError,
    );
  });

  it("a template reads ready once its golden tag is set, and failed on an error", async () => {
    const gateway = gatewayOver({
      getActorTemplate(request) {
        const name = request.actorTemplate?.name ?? "";
        return create(ActorTemplateSchema, {
          metadata: { name, uid: "u", version: 1n },
          status: {
            goldenSnapshotStatus:
              name === "ready"
                ? { goldenTag: { atespace: "ate-golden", name: "tag" } }
                : name === "failed"
                  ? { errorMessage: "the waiter exited" }
                  : {},
          },
        });
      },
    });
    expect(await gateway.getTemplate("ready")).toMatchObject({
      goldenReady: true,
      goldenError: "",
    });
    expect(await gateway.getTemplate("failed")).toMatchObject({
      goldenReady: false,
      goldenError: "the waiter exited",
    });
    expect(await gateway.getTemplate("pending")).toMatchObject({
      goldenReady: false,
      goldenError: "",
    });
  });
});

describe("the calls that succeed", () => {
  it("creates, lists, moves through the lifecycle and deletes", async () => {
    const seen: string[] = [];
    const record =
      <T>(name: string, answer: T) =>
      () => {
        seen.push(name);
        return answer;
      };
    const gateway = gatewayOver({
      getAtespace() {
        seen.push("getAtespace");
        throw new ConnectError("no atespace", Code.NotFound);
      },
      createAtespace: record("createAtespace", {}),
      createActor: record("createActor", actor("a", ActorState.SUSPENDED)),
      createActorTemplate: record(
        "createActorTemplate",
        create(ActorTemplateSchema, {}),
      ),
      createActorEgressPolicy: record("createActorEgressPolicy", {}),
      resumeActor: record("resumeActor", { resumed: true }),
      suspendActor(request) {
        seen.push(`suspendActor mode=${DurabilityMode[request.options?.mode ?? 0]}`);
        return {};
      },
      revertActor: record("revertActor", {}),
      deleteActor(request) {
        seen.push(`deleteActor ${request.actor?.name ?? ""}`);
        return actor("a", ActorState.DELETING);
      },
      deleteActorTemplate: record(
        "deleteActorTemplate",
        create(ActorTemplateSchema, {}),
      ),
      listActorTemplates(request) {
        seen.push("listActorTemplates");
        return (request.options?.pageToken ?? "") === ""
          ? {
              actorTemplates: [
                create(ActorTemplateSchema, { metadata: { name: "t1" } }),
              ],
              nextPageToken: "p2",
            }
          : {
              actorTemplates: [
                create(ActorTemplateSchema, { metadata: { name: "t2" } }),
              ],
              nextPageToken: "",
            };
      },
    });
    await gateway.ensureAtespace();
    expect(await gateway.createActor("a", "t")).toBe("created");
    expect(
      await gateway.createTemplate(
        create(ActorTemplateSchema, { metadata: { name: "t" } }),
      ),
    ).toBe("created");
    await gateway.ensureEgressPolicy("a", []);
    await gateway.resumeActor("a");
    await gateway.suspendActor("a");
    await gateway.revertActor("a");
    await gateway.deleteActor("a");
    await gateway.deleteTemplate({
      name: "t",
      uid: "u",
      version: 2n,
      createTime: undefined,
      goldenReady: true,
      goldenError: "",
    });
    expect((await gateway.listTemplates()).map((t) => t.name)).toEqual([
      "t1",
      "t2",
    ]);
    expect(seen).toEqual([
      "getAtespace",
      "createAtespace",
      "createActor",
      "createActorTemplate",
      "createActorEgressPolicy",
      "resumeActor",
      "suspendActor mode=ASYNCHRONOUS",
      "revertActor",
      "deleteActor a",
      "deleteActorTemplate",
      "listActorTemplates",
      "listActorTemplates",
    ]);
  });

  it("an unexpected failure on a create or a delete passes through", async () => {
    const boom = () => {
      throw new ConnectError("boom", Code.Internal);
    };
    const gateway = gatewayOver({
      getAtespace: boom,
      createAtespace: boom,
      createActor: boom,
      createActorTemplate: boom,
      createActorEgressPolicy: boom,
      deleteActor: boom,
      deleteActorTemplate: boom,
      getActor: boom,
      getActorTemplate: boom,
      updateActor: boom,
    });
    const view = {
      name: "a",
      uid: "u",
      version: 1n,
      state: "suspended" as const,
      template: "t",
      createTime: undefined,
      updateTime: undefined,
    };
    for (const call of [
      () => gateway.ensureAtespace(),
      () => gateway.createActor("a", "t"),
      () => gateway.createTemplate(create(ActorTemplateSchema, {})),
      () => gateway.ensureEgressPolicy("a", []),
      () => gateway.deleteActor("a"),
      () =>
        gateway.deleteTemplate({
          name: "t",
          uid: "u",
          version: 1n,
          createTime: undefined,
          goldenReady: false,
          goldenError: "",
        }),
      () => gateway.getActor("a"),
      () => gateway.getTemplate("t"),
      () => gateway.moveActor(view, "t2"),
    ]) {
      await expect(call()).rejects.toMatchObject({ code: Code.Internal });
    }
  });
});

/** The live client's settings, toward `apiEndpoint` under the CA in `apiCaFile`. */
function liveSettings(
  apiEndpoint: string,
  apiCaFile: string,
): SubstrateDriverSettings {
  return {
    apiEndpoint,
    apiServerName: API_NAME,
    apiCaFile,
    apiTokenFile: tokenFile,
    routerUrl: "http://127.0.0.1:2",
    routerCaFile: "",
    routerServerName: "",
    routerClientCertFile: "",
    atespace: "stigmer",
    storageLocation: "gs://b/p",
    workerSelector: { workload: "stigmer" },
    httpsEgress: "none",
    extraHttpEgress: [],
    platformHttpsHosts: [],
    suspendAfterSeconds: 1800,
    sweepIntervalSeconds: 60,
  };
}

/** The Control API's in-cluster name, the only one its certificate carries. */
const API_NAME = "api.ate-system.svc";

let apiCa: TestCa;
let rotatedCa: TestCa;
let apiCertificate: TestServerCertificate;
let rotatedCertificate: TestServerCertificate;

beforeAll(async () => {
  apiCa = await mintCa("control api test ca");
  rotatedCa = await mintCa("rotated control api test ca");
  apiCertificate = await mintServerCertificate(apiCa, { dns: [API_NAME] });
  rotatedCertificate = await mintServerCertificate(rotatedCa, {
    dns: [API_NAME],
  });
});

function caFile(pem: string, name = "ca.pem"): string {
  const file = path.join(dir, name);
  writeFileSync(file, pem);
  return file;
}

/** Replaces the CA file's contents and moves its mtime, as a rotation does. */
function rotate(file: string, pem: string, step: number): void {
  writeFileSync(file, pem);
  const when = new Date(Date.now() + step * 10_000);
  utimesSync(file, when, when);
}

describe("the live client", () => {
  it("dials the configured endpoint over TLS with the token and the CA it was given", async () => {
    const gateway = newSubstrateClientGateway(
      liveSettings("https://127.0.0.1:1", caFile(apiCa.pem)),
    );
    await expect(gateway.getActor("a")).rejects.toBeInstanceOf(ConnectError);
    await expect(gateway.ensureAtespace()).rejects.toBeInstanceOf(
      ConnectError,
    );
  });

  it("refuses at boot a CA file whose certificate cannot be parsed, naming the variable", () => {
    const garbage = caFile(
      "-----BEGIN CERTIFICATE-----\nAAAA\n-----END CERTIFICATE-----\n",
      "garbage.pem",
    );
    expect(() =>
      newSubstrateClientGateway(liveSettings("https://127.0.0.1:1", garbage)),
    ).toThrow(
      /STIGMER_SANDBOX_SUBSTRATE_API_CA_FILE \(.*garbage\.pem\) cannot be used as the Control API's CA: certificate 1 of 1 cannot be parsed/,
    );
  });
});

interface ControlApi {
  readonly endpoint: string;
  /** Connections the server has accepted, counted once each. */
  sessions: number;
  /** Connections the server holds open now. */
  readonly open: Set<http2.ServerHttp2Session>;
  /** Serves `certificate` to every connection from now on, as a rotation does. */
  serve(certificate: TestServerCertificate): void;
  /** Drops every connection, which the gateway would hold open, and stops. */
  close(): Promise<void>;
}

describe("the live client's CA", () => {
  const apis: ControlApi[] = [];

  afterEach(async () => {
    for (const api of apis.splice(0)) await api.close();
  });

  /** The Control service over HTTP/2 and TLS, as Substrate serves it. */
  async function controlApi(
    impl: Partial<ServiceImpl<typeof Control>>,
  ): Promise<ControlApi> {
    const server = http2.createSecureServer(
      { cert: apiCertificate.cert, key: apiCertificate.key },
      connectNodeAdapter({ routes: (router) => router.service(Control, impl) }),
    );
    const api = {
      endpoint: "",
      sessions: 0,
      open: new Set<http2.ServerHttp2Session>(),
      serve: (certificate: TestServerCertificate) =>
        server.setSecureContext({
          cert: certificate.cert,
          key: certificate.key,
        }),
      close: () =>
        new Promise<void>((resolve) => {
          server.close(() => resolve());
          for (const session of api.open) session.destroy();
        }),
    };
    server.on("session", (session: http2.ServerHttp2Session) => {
      api.sessions += 1;
      api.open.add(session);
      session.on("close", () => api.open.delete(session));
    });
    apis.push(api);
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", () => resolve()),
    );
    const { port } = server.address() as AddressInfo;
    return Object.assign(api, { endpoint: `https://127.0.0.1:${port}` });
  }

  const running = {
    getActor: (request: { actor?: { name: string } }) =>
      actor(request.actor?.name ?? "", ActorState.RUNNING),
  };

  it("trusts a CA file replaced on disk from the next call, on a new connection, and closes the one made under the old CA", async () => {
    const api = await controlApi(running);
    const file = caFile(apiCa.pem);
    const gateway = newSubstrateClientGateway(liveSettings(api.endpoint, file));
    expect((await gateway.getActor("a"))?.state).toBe("running");
    expect(api.sessions).toBe(1);

    api.serve(rotatedCertificate);
    rotate(file, rotatedCa.pem, 1);
    expect((await gateway.getActor("a"))?.state).toBe("running");
    expect(api.sessions).toBe(2);
    // The idle connection trusted under the old CA is closed at once,
    // not at the session manager's 15-minute idle timeout.
    await expect.poll(() => api.open.size, { timeout: 2_000 }).toBe(1);

    // A client still holding the old CA cannot connect: the second
    // connection above was made under the file read again.
    const stale = newSubstrateClientGateway(
      liveSettings(api.endpoint, caFile(apiCa.pem, "stale.pem")),
    );
    await expect(stale.getActor("a")).rejects.toBeInstanceOf(ConnectError);
    expect(api.sessions).toBe(2);
  });

  it("finishes a call in flight across a rotation, then closes its connection", async () => {
    let release = (): void => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let calls = 0;
    const api = await controlApi({
      async getActor(request) {
        calls += 1;
        if (calls === 1) await held;
        return running.getActor(request);
      },
    });
    const file = caFile(apiCa.pem);
    const gateway = newSubstrateClientGateway(liveSettings(api.endpoint, file));

    const inFlight = gateway.getActor("a");
    await expect.poll(() => calls).toBe(1);
    // The old CA beside the new one, as a trust bundle carries them.
    api.serve(rotatedCertificate);
    rotate(file, `${apiCa.pem}\n${rotatedCa.pem}`, 1);
    expect((await gateway.getActor("b"))?.name).toBe("b");
    expect(api.open.size).toBe(2);
    release();
    expect((await inFlight)?.name).toBe("a");
    // Only the connection made under the current bundle stays open.
    await expect.poll(() => api.open.size, { timeout: 2_000 }).toBe(1);
  });

  it("fails a call naming the variable once the CA file becomes unusable, and reads it again on the next", async () => {
    const api = await controlApi(running);
    const file = caFile(apiCa.pem);
    const gateway = newSubstrateClientGateway(liveSettings(api.endpoint, file));
    expect((await gateway.getActor("a"))?.state).toBe("running");

    rotate(file, "not a certificate", 1);
    await expect(gateway.getActor("a")).rejects.toThrow(
      /STIGMER_SANDBOX_SUBSTRATE_API_CA_FILE \(.*ca\.pem\) cannot be used as the Control API's CA: .*holds no PEM certificate/,
    );
    rmSync(file);
    await expect(gateway.getActor("a")).rejects.toThrow(/ENOENT/);

    rotate(file, apiCa.pem, 2);
    expect((await gateway.getActor("a"))?.state).toBe("running");
  });
});

describe("transportFollowingCa", () => {
  /** A generation whose calls answer when `answer` resolves, recording its closing. */
  interface Fake extends CaGeneration {
    readonly ca: string;
    aborted: number;
  }

  function following(answer: () => Promise<void>) {
    let ca = "ca-1";
    const built: Fake[] = [];
    const transport = transportFollowingCa(
      () => {
        if (ca === "") throw new Error("the CA cannot be read");
        return ca;
      },
      (pem) => {
        const fake: Fake = {
          ca: pem,
          aborted: 0,
          sessionManager: { abort: () => void (fake.aborted += 1) },
          transport: {
            unary: async () => {
              await answer();
              return pem;
            },
            stream: async () => {
              await answer();
              if (pem === "ca-refused") throw new Error("refused");
              return {
                message: (async function* () {
                  yield pem;
                })(),
              };
            },
          } as unknown as Transport,
        };
        built.push(fake);
        return fake;
      },
    );
    const call = transport.unary as unknown as () => Promise<string>;
    const stream = transport.stream as unknown as () => Promise<{
      message: AsyncIterable<string>;
    }>;
    return {
      built,
      call,
      stream,
      rotate: (next: string) => void (ca = next),
    };
  }

  it("builds one generation per CA, and closes a replaced one when its last call settles", async () => {
    let release = (): void => {};
    let hold = true;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const t = following(() => (hold ? held : Promise.resolve()));
    const inFlight = t.call();
    hold = false;
    expect(await t.call()).toBe("ca-1");
    expect(t.built).toHaveLength(1);

    t.rotate("ca-2");
    expect(await t.call()).toBe("ca-2");
    expect(t.built.map((fake) => fake.aborted)).toEqual([0, 0]);
    release();
    expect(await inFlight).toBe("ca-1");
    expect(t.built.map((fake) => fake.aborted)).toEqual([1, 0]);

    // An idle generation is closed as soon as it is replaced.
    t.rotate("ca-3");
    expect(await t.call()).toBe("ca-3");
    expect(t.built.map((fake) => fake.aborted)).toEqual([1, 1, 0]);
  });

  it("counts a stream until its messages end, and one that rejects not at all", async () => {
    const t = following(() => Promise.resolve());
    const open = await t.stream();
    t.rotate("ca-2");
    await t.call();
    expect(t.built[0]?.aborted).toBe(0);
    const messages: string[] = [];
    for await (const message of open.message) messages.push(message);
    expect(messages).toEqual(["ca-1"]);
    expect(t.built[0]?.aborted).toBe(1);

    t.rotate("ca-refused");
    await expect(t.stream()).rejects.toThrow("refused");
    t.rotate("ca-4");
    await t.call();
    expect(t.built.map((fake) => fake.aborted)).toEqual([1, 1, 1, 0]);
  });

  it("fails a call whose CA cannot be read, builds nothing, and reads it again on the next", async () => {
    const t = following(() => Promise.resolve());
    t.rotate("");
    await expect(t.call()).rejects.toThrow("the CA cannot be read");
    expect(t.built).toHaveLength(0);
    t.rotate("ca-1");
    expect(await t.call()).toBe("ca-1");
    expect(t.built).toHaveLength(1);
  });
});
