/**
 * Pins the reference fill (../resource-references.ts).
 *
 * Over the interceptor alone, with a recording name table:
 *   - a response that can reach no reference passes untouched, the same
 *     object, and reads nothing;
 *   - a unary response is answered as a filled clone: each reference that
 *     holds an id gets its target's current slug, an empty kind the
 *     field's, in ONE batched read; the handler's message is not mutated;
 *   - a target that holds no name (it was deleted) keeps an empty slug;
 *   - each frame of a stream (run.subscribe) is filled as it passes.
 * Through a composed server, over the wire and in process alike:
 *   - a reference written by slug is stored by id with no slug, and read
 *     back with both, whichever transport reads it;
 *   - once its target is deleted it reads back with its id and no slug.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { create, createFileRegistry, toJson } from "@bufbuild/protobuf";
import type { DescMethod } from "@bufbuild/protobuf";
import {
  FieldDescriptorProto_Label,
  FieldDescriptorProto_Type,
  FileDescriptorProtoSchema,
} from "@bufbuild/protobuf/wkt";
import { createClient } from "@connectrpc/connect";
import type { Transport, UnaryRequest, UnaryResponse, StreamResponse } from "@connectrpc/connect";
import { createGrpcTransport } from "@connectrpc/connect-node";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { AgentCommandController } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/command_pb";
import { RunSchema } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import type { Run } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import { RunQueryController } from "@stigmer/protos/ai/stigmer/agentic/run/v1/query_pb";
import { SessionSchema } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import { SessionCommandController } from "@stigmer/protos/ai/stigmer/agentic/session/v1/command_pb";
import { SessionQueryController } from "@stigmer/protos/ai/stigmer/agentic/session/v1/query_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { file_ai_stigmer_commons_apiresource_io } from "@stigmer/protos/ai/stigmer/commons/apiresource/io_pb";
import { OrganizationSchema } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/api_pb";
import { OrganizationQueryController } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/query_pb";

import { loadConfig } from "../../../boot/config.js";
import { composeServer } from "../../../boot/compose.js";
import type { ComposedServer } from "../../../boot/compose.js";
import { baseConfig, silentLogger } from "../../../extensions/__tests__/composed-support.js";
import { seedOrganizations } from "../../../domain/organization/__tests__/support.js";
import type { ResourceNameHolder, ResourceNameStore } from "../../../store/interface.js";
import { createResourceReferenceInterceptor, fillReferenceNames } from "../resource-references.js";

/** A name table answering `held` (`kind/org/id` → name), recording each batch it was asked. */
function namesOf(held: Record<string, string>): Pick<ResourceNameStore, "currentMany"> & { asked: ResourceNameHolder[][] } {
  const asked: ResourceNameHolder[][] = [];
  return {
    asked,
    currentMany: (holders) => {
      asked.push([...holders]);
      return Promise.resolve(
        holders
          .filter((h) => held[`${h.kind}/${h.org}/${h.id}`] !== undefined)
          .map((h) => ({ ...h, name: held[`${h.kind}/${h.org}/${h.id}`]!, state: "current" as const, claimedAt: "", expiresAt: "" })),
      );
    },
  };
}

function unaryThrough(
  names: Pick<ResourceNameStore, "currentMany">,
  method: DescMethod,
  message: unknown,
): Promise<UnaryResponse> {
  const next = () => Promise.resolve({ stream: false, message, method } as unknown as UnaryResponse);
  return createResourceReferenceInterceptor(names)(next)({ method } as unknown as UnaryRequest) as Promise<UnaryResponse>;
}

describe("the reference fill, over the interceptor alone", () => {
  it("passes a response that can reach no reference untouched, reading nothing", async () => {
    const names = namesOf({});
    const answer = { anything: true };
    const response = await unaryThrough(names, OrganizationQueryController.method.get, answer);
    expect(response.message).toBe(answer);
    expect(names.asked).toEqual([]);
  });

  it("fills each id's current slug and an empty kind in one read, as a clone, and leaves a deleted target's slug empty", async () => {
    const names = namesOf({ "agent/org_a/agt_1": "support", "vault/org_a/vlt_1": "keys" });
    const session = create(SessionSchema, {
      metadata: { id: "ses_1", org: "org_a" },
      spec: {
        agentRef: { org: "org_a", kind: ApiResourceKind.agent, id: "agt_1" },
        // No kind stored: the field's declared kind fills it.
        vaults: [{ org: "org_a", id: "vlt_1" }, { org: "org_a", kind: ApiResourceKind.vault, id: "vlt_gone" }],
      },
    });
    const response = await unaryThrough(names, SessionQueryController.method.get, session);
    const filled = response.message as typeof session;
    expect(filled).not.toBe(session);
    expect(filled.spec!.agentRef).toMatchObject({ id: "agt_1", slug: "support" });
    expect(filled.spec!.vaults.map((r) => [r.kind, r.id, r.slug])).toEqual([
      [ApiResourceKind.vault, "vlt_1", "keys"],
      [ApiResourceKind.vault, "vlt_gone", ""],
    ]);
    expect(session.spec!.agentRef!.slug, "the handler's message is not mutated").toBe("");
    expect(names.asked).toHaveLength(1);
  });

  it("fills every frame of a stream as it passes", async () => {
    const names = namesOf({ "agent/org_a/agt_1": "support" });
    const frame = (n: number): Run =>
      create(RunSchema, {
        metadata: { id: `run_${n}` },
        spec: { target: { case: "sessionSpec", value: { agentRef: { org: "org_a", kind: ApiResourceKind.agent, id: "agt_1" } } } },
      });
    async function* frames(): AsyncIterable<Run> {
      yield frame(1);
      yield frame(2);
    }
    const method = RunQueryController.method.subscribe;
    const next = () => Promise.resolve({ stream: true, message: frames(), method } as unknown as StreamResponse);
    const response = (await createResourceReferenceInterceptor(names)(next)({ method } as unknown as UnaryRequest)) as unknown as {
      readonly message: AsyncIterable<Run>;
    };
    const seen: string[] = [];
    for await (const run of response.message) {
      const ref = run.spec?.target.case === "sessionSpec" ? run.spec.target.value.agentRef : undefined;
      seen.push(`${run.metadata!.id}:${ref?.slug ?? ""}`);
    }
    expect(seen).toEqual(["run_1:support", "run_2:support"]);
    expect(names.asked).toHaveLength(2);
  });

  it("fillReferenceNames over a type that holds no reference reports none and reads nothing", async () => {
    const names = namesOf({});
    const org = create(OrganizationSchema, { metadata: { id: "org_a", slug: "acme" } });
    expect(await fillReferenceNames(names, OrganizationSchema, org)).toBe(false);
    expect(names.asked).toEqual([]);
  });

  it("fills a reference held as a map value", async () => {
    // No message of the contract holds references in a map today; the walk
    // reaches one the day it does, as the write chain's walk does.
    const { OPTIONAL, REPEATED } = FieldDescriptorProto_Label;
    const { MESSAGE, STRING } = FieldDescriptorProto_Type;
    const registry = createFileRegistry(
      create(FileDescriptorProtoSchema, {
        name: "test/holder.proto",
        package: "test.holder",
        syntax: "proto3",
        dependency: [file_ai_stigmer_commons_apiresource_io.proto.name],
        messageType: [
          {
            name: "Holder",
            field: [{ name: "refs", jsonName: "refs", number: 1, label: REPEATED, type: MESSAGE, typeName: ".test.holder.Holder.RefsEntry" }],
            nestedType: [
              {
                name: "RefsEntry",
                options: { mapEntry: true },
                field: [
                  { name: "key", jsonName: "key", number: 1, label: OPTIONAL, type: STRING },
                  { name: "value", jsonName: "value", number: 2, label: OPTIONAL, type: MESSAGE, typeName: ".ai.stigmer.commons.apiresource.ApiResourceReference" },
                ],
              },
            ],
          },
        ],
      }),
      () => file_ai_stigmer_commons_apiresource_io,
    );
    const holder = registry.getMessage("test.holder.Holder")!;
    const message = create(holder, { refs: { first: { org: "org_a", kind: ApiResourceKind.skill, id: "skl_1" } } });
    const names = namesOf({ "skill/org_a/skl_1": "web-search" });
    expect(await fillReferenceNames(names, holder, message)).toBe(true);
    expect(toJson(holder, message)).toEqual({ refs: { first: { org: "org_a", kind: "skill", id: "skl_1", slug: "web-search" } } });
  });
});

describe("the reference fill, through a composed server", () => {
  const ORG = "fills";
  let dir: string;
  let server: ComposedServer;
  let wire: Transport;

  beforeAll(async () => {
    dir = mkdtempSync(path.join(tmpdir(), "resource-references-"));
    server = await composeServer({
      config: loadConfig(baseConfig(dir)),
      logger: silentLogger,
      portOverride: 0,
      host: "127.0.0.1",
    });
    const port = await server.start();
    wire = createGrpcTransport({ baseUrl: `http://127.0.0.1:${port}` });
    await seedOrganizations(wire, [ORG]);
  });

  afterAll(async () => {
    await server.shutdown();
    rmSync(dir, { recursive: true, force: true });
  });

  it("stores a reference written by slug as its id, and answers it with both over the wire and in process; a deleted target answers no slug", async () => {
    const agents = createClient(AgentCommandController, wire);
    const helper = await agents.create({
      apiVersion: "agentic.stigmer.ai/v1",
      kind: "Agent",
      metadata: { name: "Fill Helper", org: ORG, slug: "fill-helper" },
      spec: { instructions: "help the people of this test" },
    });
    const created = await createClient(SessionCommandController, wire).create({
      apiVersion: "agentic.stigmer.ai/v1",
      kind: "Session",
      metadata: { name: "Fill Chat", org: ORG },
      spec: { agentRef: { slug: "fill-helper" } },
    });
    const id = created.metadata!.id;
    const helperId = helper.metadata!.id;

    const stored = await server.store.getResource(ApiResourceKind.session, id, SessionSchema);
    expect(stored.spec!.agentRef).toMatchObject({ kind: ApiResourceKind.agent, id: helperId, slug: "" });

    for (const transport of [wire, server.inProcessTransport]) {
      const read = await createClient(SessionQueryController, transport).get({ value: id });
      expect(read.spec!.agentRef).toMatchObject({ id: helperId, slug: "fill-helper" });
    }

    await agents.delete({ value: helperId });
    for (const transport of [wire, server.inProcessTransport]) {
      const read = await createClient(SessionQueryController, transport).get({ value: id });
      expect(read.spec!.agentRef).toMatchObject({ id: helperId, slug: "" });
    }
  });
});
