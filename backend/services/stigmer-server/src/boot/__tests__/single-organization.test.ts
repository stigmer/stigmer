/**
 * Pins the boot step of a composition that declares one organization
 * (boot/single-organization.ts), driven directly over a composed library
 * server's in-process transport so each store shape can be set up first:
 *
 *   - an empty store gets `stigmer`, made as the caller given (under
 *     sign-in the server acting as nobody, so the stamp is "system"), its
 *     id recorded under SINGLE_ORG_KEY, and the holder settled to it;
 *   - a store that holds one organization is left alone and filled with
 *     it, with nothing recorded (the server did not make it);
 *   - a store that holds several fills nothing and warns with the count;
 *   - a store whose ledger retired the slug, holding none, warns and fills
 *     nothing, and boots;
 *   - any other failure of the create is a boot throw naming the cause.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { create, fromBinary } from "@bufbuild/protobuf";
import type { DescMessage } from "@bufbuild/protobuf";
import { Code, ConnectError, createClient } from "@connectrpc/connect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { OrganizationSchema } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/api_pb";
import { OrganizationCommandController } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/command_pb";

import { loadConfig } from "../config.js";
import { composeServer } from "../compose.js";
import type { ComposedServer } from "../compose.js";
import { createLogger } from "../logger.js";
import { ensureSingleOrganization } from "../single-organization.js";
import { SINGLE_ORG_KEY } from "../../domain/organization/limit.js";
import type { GateSlotName } from "../../extensions/gate-slots.js";
import { baseConfig } from "../../extensions/__tests__/composed-support.js";
import type { ServerExtension } from "../../extensions/registry.js";
import {
  IN_PROCESS_CALLER_HEADER,
  SYSTEM_OPERATOR_IDENTITY_ID,
  encodeInProcessCaller,
  serverActingFor,
} from "../../pipeline/interceptors/auth.js";
import { newSingleOrganizationHolder } from "../../pipeline/interceptors/single-organization.js";
import type { PipelineStep } from "../../pipeline/pipeline.js";

interface LogLine {
  readonly level: string;
  readonly message: string;
  readonly [key: string]: unknown;
}

describe("ensureSingleOrganization", () => {
  let dir: string;
  let server: ComposedServer;
  let lines: LogLine[];
  const logger = createLogger({
    level: "info",
    pretty: false,
    write: (line) => lines.push(JSON.parse(line) as LogLine),
  });

  async function composeWith(
    extensions: ReadonlyArray<ServerExtension> = [],
  ): Promise<void> {
    server = await composeServer({
      config: loadConfig(baseConfig(dir)),
      logger: createLogger({ level: "error", pretty: false, write: () => {} }),
      extensions,
      portOverride: 0,
      host: "127.0.0.1",
    });
  }

  async function seedOrganization(slug: string): Promise<void> {
    await server.store.saveResource(
      ApiResourceKind.organization,
      slug,
      OrganizationSchema,
      create(OrganizationSchema, {
        apiVersion: "tenancy.stigmer.ai/v1",
        kind: "Organization",
        metadata: { id: slug, slug, name: slug },
      }),
    );
  }

  async function organizations() {
    return (await server.store.listResources(ApiResourceKind.organization)).map(
      (bytes) => fromBinary(OrganizationSchema, bytes),
    );
  }

  function ensure(holder = newSingleOrganizationHolder()) {
    // The in-process edge compose.ts hands the step (boot/inprocess.ts
    // `singleOrganizationCreator`), over the composed server's transport.
    const organizations = createClient(
      OrganizationCommandController,
      server.inProcessTransport,
    );
    return {
      holder,
      run: () =>
        ensureSingleOrganization({
          store: server.store,
          creator: {
            createAsCaller: (organization, caller) =>
              organizations.create(organization, {
                headers: {
                  [IN_PROCESS_CALLER_HEADER]: encodeInProcessCaller(caller),
                },
              }),
          },
          caller: serverActingFor(SYSTEM_OPERATOR_IDENTITY_ID),
          holder,
          logger,
        }),
    };
  }

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "single-organization-boot-test-"));
    lines = [];
  });

  afterEach(async () => {
    await server.shutdown();
    rmSync(dir, { recursive: true, force: true });
  });

  it("an empty store gets `stigmer`, made as nobody, recorded, and filled", async () => {
    await composeWith();
    const { holder, run } = ensure();
    await run();

    const held = await organizations();
    expect(held.map((org) => org.metadata?.id)).toEqual(["stigmer"]);
    expect(held[0]?.metadata?.org).toBe("");
    expect(held[0]?.status?.audit?.specAudit?.createdBy?.id).toBe("system");
    expect(await server.store.bootstrapState.get(SINGLE_ORG_KEY)).toBe(
      "stigmer",
    );
    expect(holder.current()).toBe("stigmer");
    expect(lines).toContainEqual(
      expect.objectContaining({
        message: "single organization ensured",
        org: "stigmer",
      }),
    );
  });

  it("a store that holds one organization is left alone and filled with it", async () => {
    await composeWith();
    await seedOrganization("acme");
    const { holder, run } = ensure();
    await run();

    expect((await organizations()).map((org) => org.metadata?.id)).toEqual([
      "acme",
    ]);
    expect(await server.store.bootstrapState.get(SINGLE_ORG_KEY)).toBe("");
    expect(holder.current()).toBe("acme");
  });

  it("a store that holds several fills nothing and warns with the count", async () => {
    await composeWith();
    await seedOrganization("acme");
    await seedOrganization("globex");
    const { holder, run } = ensure();
    await run();

    expect(await organizations()).toHaveLength(2);
    expect(holder.current()).toBeUndefined();
    expect(lines).toContainEqual(
      expect.objectContaining({ level: "warn", organizations: 2 }),
    );
  });

  it("a store whose ledger retired the slug, holding none, warns, fills nothing and boots", async () => {
    await composeWith();
    await server.store.organizationSlugs.claim("stigmer");
    await server.store.organizationSlugs.retire("stigmer");
    const { holder, run } = ensure();
    await run();

    expect(await organizations()).toHaveLength(0);
    expect(holder.current()).toBeUndefined();
    expect(await server.store.bootstrapState.get(SINGLE_ORG_KEY)).toBe("");
    expect(lines).toContainEqual(
      expect.objectContaining({ level: "warn", slug: "stigmer" }),
    );
  });

  it("any other failure of the create is a boot throw naming the cause", async () => {
    const refuseEverything: PipelineStep<DescMessage> = {
      name: "FakeUnavailable",
      execute: () => {
        throw new ConnectError("the fake gate is down", Code.Unavailable);
      },
    };
    await composeWith([
      {
        name: "fake-org-gate",
        gateSteps: new Map<
          GateSlotName,
          ReadonlyArray<PipelineStep<DescMessage>>
        >([["org-create:pre-side-effect-gate", [refuseEverything]]]),
      },
    ]);
    const { holder, run } = ensure();

    await expect(run()).rejects.toThrow(
      /^cannot make this server's organization: .*the fake gate is down/,
    );
    expect(holder.current()).toBeUndefined();
  });
});
