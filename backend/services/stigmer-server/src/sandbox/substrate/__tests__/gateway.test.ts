/**
 * Pins the gateway against the generated Control service, served in
 * process (gateway.ts), with no network:
 *
 *   - every call carries `authorization: Bearer <token>` from the token
 *     file, re-read when the file changes;
 *   - NOT_FOUND reads as absent and deletes as success; ALREADY_EXISTS
 *     creates as "exists"; FAILED_PRECONDITION moves as "refused";
 *   - ABORTED and RESOURCE_EXHAUSTED become the driver's two typed errors;
 *   - lists follow page tokens;
 *   - a move replaces the stored actor with only its template changed, and
 *     refuses one that changed since it was read.
 */
import { mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { create } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import {
  Code,
  ConnectError,
  createRouterTransport,
  type ServiceImpl,
} from "@connectrpc/connect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  ActorSchema,
  ActorState,
  ActorTemplateSchema,
  Control,
  EgressPolicySchema,
  EgressRuleSchema,
} from "../gen/ateapipb/ateapi_pb.js";
import {
  bearerFromFile,
  newSubstrateClientGateway,
  newSubstrateGatewayOverTransport,
  SubstrateAbortedError,
  SubstrateNoWorkerError,
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

const actor = (name: string, state: ActorState, version = 3n) =>
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
    status: { state },
  });

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
      createAtespace: exists,
    });
    expect(await gateway.createActor("a", "t")).toBe("exists");
    expect(
      await gateway.createTemplate(
        create(ActorTemplateSchema, { metadata: { name: "t" } }),
      ),
    ).toBe("exists");
    expect(await gateway.ensureEgressPolicy("a", [])).toBe("unchanged");
    await expect(gateway.ensureAtespace()).resolves.toBeUndefined();
  });

  it("ABORTED and RESOURCE_EXHAUSTED become the driver's typed errors; anything else passes through", async () => {
    const gateway = gatewayOver({
      resumeActor() {
        throw new ConnectError("actor a crashed", Code.Aborted);
      },
      pauseActor() {
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
    await expect(gateway.pauseActor("a")).rejects.toBeInstanceOf(
      SubstrateNoWorkerError,
    );
    await expect(gateway.suspendActor("a")).rejects.toMatchObject({
      code: Code.Internal,
    });
  });
});

describe("an existing egress policy", () => {
  it("is replaced at the version read when its rules differ, and left when they match", async () => {
    let updated: unknown;
    const rule = create(EgressRuleSchema, {
      http: { hostnames: ["stigmer.example"], ports: { numbers: [7234] } },
    });
    let storedRules = [rule];
    const gateway = gatewayOver({
      createActorEgressPolicy() {
        throw new ConnectError("dup", Code.AlreadyExists);
      },
      getActorEgressPolicy: () =>
        create(EgressPolicySchema, {
          metadata: { name: "default", uid: "pol-1", version: 7n },
          rules: storedRules,
        }),
      updateActorEgressPolicy(request) {
        updated = request.egressPolicy;
        return request.egressPolicy ?? create(EgressPolicySchema, {});
      },
    });
    expect(await gateway.ensureEgressPolicy("a", [rule])).toBe("unchanged");
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
        return request.pageToken === ""
          ? { actors: [actor("a", ActorState.RUNNING)], nextPageToken: "p2" }
          : { actors: [actor("b", ActorState.PAUSED)], nextPageToken: "" };
      },
    });
    const actors = await gateway.listActors();
    expect(actors.map((a) => [a.name, a.state, a.template])).toEqual([
      ["a", ActorState.RUNNING, "stigmer-runner-old"],
      ["b", ActorState.PAUSED, "stigmer-runner-old"],
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
      createAtespace: record("createAtespace", {}),
      createActor: record("createActor", actor("a", ActorState.SUSPENDED)),
      createActorTemplate: record(
        "createActorTemplate",
        create(ActorTemplateSchema, {}),
      ),
      createActorEgressPolicy: record("createActorEgressPolicy", {}),
      resumeActor: record("resumeActor", { resumed: true }),
      pauseActor: record("pauseActor", {}),
      suspendActor: record("suspendActor", {}),
      revertActor: record("revertActor", {}),
      deleteActor: record("deleteActor", actor("a", ActorState.DELETING)),
      deleteActorTemplate: record(
        "deleteActorTemplate",
        create(ActorTemplateSchema, {}),
      ),
      listActorTemplates(request) {
        seen.push("listActorTemplates");
        return request.pageToken === ""
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
    await gateway.pauseActor("a");
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
      "createAtespace",
      "createActor",
      "createActorTemplate",
      "createActorEgressPolicy",
      "resumeActor",
      "pauseActor",
      "suspendActor",
      "revertActor",
      "deleteActor",
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
      state: ActorState.SUSPENDED,
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

describe("the live client", () => {
  it("dials the configured endpoint over TLS with the token and the CA it was given", async () => {
    const caFile = path.join(dir, "ca.pem");
    writeFileSync(caFile, "not a certificate");
    const gateway = newSubstrateClientGateway({
      apiEndpoint: "https://127.0.0.1:1",
      apiServerName: "api.ate-system.svc",
      apiCaFile: caFile,
      apiTokenFile: tokenFile,
      routerUrl: "http://127.0.0.1:2",
      atespace: "stigmer",
      storageLocation: "gs://b/p",
      workerSelector: { workload: "stigmer" },
      sandboxConfigName: "gvisor-default",
      httpsEgress: "none",
      extraHttpEgress: [],
      pauseAfterSeconds: 300,
      suspendAfterSeconds: 1800,
      sweepIntervalSeconds: 60,
    });
    await expect(gateway.getActor("a")).rejects.toBeInstanceOf(ConnectError);
  });
});
