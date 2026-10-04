/**
 * Pins the boot step of a composition that declares one organization
 * (boot/single-organization.ts), driven directly over a composed library
 * server's in-process transport so each store shape can be set up first:
 *
 *   - an empty store is marked, before the create, as owing the people it
 *     holds their roles on the organization (the membership rules' pass);
 *     a store that already holds one is not;
 *   - an empty store gets `stigmer`, made as the caller given (under
 *     sign-in the server acting as nobody, so the stamp is "system"), its
 *     id recorded under SINGLE_ORG_KEY, and the holder settled to it;
 *   - a store that holds one organization is left alone, filled with it,
 *     and records it as the server's, whoever made it (an older release's
 *     console or CLI, or a start of this server that died before its
 *     record); a record that names another organization is replaced;
 *   - a store that holds several fills nothing and warns with the count;
 *   - a store whose ledger retired the slug, holding none, warns, fills
 *     nothing, clears the roles pass it marked owed, and boots;
 *   - a create that loses the race to another replica, refused at the
 *     duplicate check (AlreadyExists) or at the limit
 *     (ORGANIZATION_LIMIT_REACHED), finds the winner's organization, fills
 *     it, and records it as the winner does;
 *   - a loser that reads the store before the winner's row is stored
 *     re-reads for about a second and finds it;
 *   - a create refused as a duplicate that leaves the store with none (a
 *     slug claim with no organization) warns, fills nothing, and boots;
 *   - a store that holds several clears an earlier record;
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
import { ErrorInfoSchema } from "@stigmer/protos/google/rpc/error_details_pb";
import { OrganizationCommandController } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/command_pb";

import { loadConfig } from "../config.js";
import { composeServer } from "../compose.js";
import type { ComposedServer } from "../compose.js";
import { createLogger } from "../logger.js";
import { ensureSingleOrganization } from "../single-organization.js";
import {
  ORGANIZATION_LIMIT_REACHED,
  SINGLE_ORG_KEY,
} from "../../domain/organization/limit.js";
import {
  SERVER_ORGANIZATION_ROLES_KEY,
  SERVER_ORGANIZATION_ROLES_OWED,
} from "../../domain/iampolicy/constants.js";
import type { GateSlotName } from "../../extensions/gate-slots.js";
import { baseConfig } from "../../extensions/__tests__/composed-support.js";
import type { ServerExtension } from "../../extensions/registry.js";
import {
  IN_PROCESS_CALLER_HEADER,
  SYSTEM_OPERATOR_IDENTITY_ID,
  encodeInProcessCaller,
  serverActingFor,
} from "../../pipeline/interceptors/auth.js";
import { organizationNameKey } from "../../domain/organization/names.js";
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

  async function seedOrganization(slug: string, createdBy = ""): Promise<void> {
    await server.store.saveResource(
      ApiResourceKind.organization,
      slug,
      OrganizationSchema,
      create(OrganizationSchema, {
        apiVersion: "tenancy.stigmer.ai/v1",
        kind: "Organization",
        metadata: { id: slug, slug, name: slug },
        status: { audit: { specAudit: { createdBy: { id: createdBy } } } },
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

  it("an empty store is marked as owing its people their roles before the create; a store that holds one is not", async () => {
    await composeWith();
    let markedBeforeCreate = "";
    await ensureSingleOrganization({
      store: server.store,
      creator: {
        createAsCaller: async () => {
          markedBeforeCreate = await server.store.bootstrapState.get(
            SERVER_ORGANIZATION_ROLES_KEY,
          );
          await seedOrganization("stigmer");
          throw new ConnectError(
            "Organization already exists",
            Code.AlreadyExists,
          );
        },
      },
      caller: serverActingFor(SYSTEM_OPERATOR_IDENTITY_ID),
      holder: newSingleOrganizationHolder(),
      logger,
    });
    expect(markedBeforeCreate).toBe(SERVER_ORGANIZATION_ROLES_OWED);

    await server.store.bootstrapState.delete(SERVER_ORGANIZATION_ROLES_KEY);
    const { run } = ensure();
    await run();
    expect(
      await server.store.bootstrapState.get(SERVER_ORGANIZATION_ROLES_KEY),
    ).toBe("");
  });

  it("an empty store gets `stigmer`, made as nobody, recorded, and filled", async () => {
    await composeWith();
    const { holder, run } = ensure();
    await run();

    // The server's organization is named `stigmer` and filed under an id
    // the create minted; the record, the holder and the log carry that id.
    const held = await organizations();
    expect(held.map((org) => org.metadata?.slug)).toEqual(["stigmer"]);
    const id = held[0]?.metadata?.id ?? "";
    expect(id).toMatch(/^org_[0-9a-z]{26}$/);
    expect(held[0]?.metadata?.org).toBe("");
    expect(held[0]?.status?.audit?.specAudit?.createdBy?.id).toBe("system");
    expect(await server.store.bootstrapState.get(SINGLE_ORG_KEY)).toBe(id);
    expect(holder.current()).toBe(id);
    expect(lines).toContainEqual(
      expect.objectContaining({
        message: "single organization ensured",
        org: id,
      }),
    );
  });

  it("a store that holds one organization, whoever made it, is left alone, filled with it, and recorded as the server's", async () => {
    await composeWith();
    await seedOrganization("acme", "ida_operator");
    const { holder, run } = ensure();
    await run();

    expect((await organizations()).map((org) => org.metadata?.id)).toEqual([
      "acme",
    ]);
    expect(await server.store.bootstrapState.get(SINGLE_ORG_KEY)).toBe("acme");
    expect(holder.current()).toBe("acme");
  });

  it("a start that died before recording its own `stigmer` records it at the next", async () => {
    await composeWith();
    await seedOrganization("stigmer", SYSTEM_OPERATOR_IDENTITY_ID);
    const { holder, run } = ensure();
    await run();

    expect(await server.store.bootstrapState.get(SINGLE_ORG_KEY)).toBe(
      "stigmer",
    );
    expect(holder.current()).toBe("stigmer");
  });

  it("a record that names an organization the store no longer holds alone is replaced by the one it holds", async () => {
    await composeWith();
    await server.store.bootstrapState.set(SINGLE_ORG_KEY, "gone");
    await seedOrganization("acme");
    const { holder, run } = ensure();
    await run();

    expect(await server.store.bootstrapState.get(SINGLE_ORG_KEY)).toBe("acme");
    expect(holder.current()).toBe("acme");
  });

  it("a store that holds several fills nothing, clears an earlier record, and warns with the count", async () => {
    await composeWith();
    await seedOrganization("acme");
    await seedOrganization("globex");
    await server.store.bootstrapState.set(SINGLE_ORG_KEY, "acme");
    const { holder, run } = ensure();
    await run();

    expect(await organizations()).toHaveLength(2);
    expect(holder.current()).toBeUndefined();
    expect(await server.store.bootstrapState.get(SINGLE_ORG_KEY)).toBe("");
    expect(lines).toContainEqual(
      expect.objectContaining({ level: "warn", organizations: 2 }),
    );
  });

  it("a store whose ledger retired the slug, holding none, warns, fills nothing and boots", async () => {
    await composeWith();
    // The upgrade carries a slug the old ledger retired as a name reserved
    // for good: an earlier release's deleted `stigmer`, whose id it was.
    await server.store.resourceNames.claim(organizationNameKey("stigmer"), "stigmer", new Date().toISOString());
    await server.store.resourceNames.release("organization", "", "stigmer");
    const { holder, run } = ensure();
    const started = Date.now();
    await run();

    expect(Date.now() - started, "no wait for a winner that will never come").toBeLessThan(500);
    expect(await organizations()).toHaveLength(0);
    expect(holder.current()).toBeUndefined();
    expect(await server.store.bootstrapState.get(SINGLE_ORG_KEY)).toBe("");
    // Marked owed before the create, which made nothing: no longer owed.
    expect(
      await server.store.bootstrapState.get(SERVER_ORGANIZATION_ROLES_KEY),
    ).toBe("");
    expect(lines).toContainEqual(
      expect.objectContaining({ level: "warn", slug: "stigmer" }),
    );
    expect(lines.some((line) => line.message.includes("is reserved for an organization an earlier release made and deleted"))).toBe(true);
  });

  it.each([
    [
      "refused at the duplicate check (AlreadyExists, no reason)",
      () => new ConnectError("Organization already exists", Code.AlreadyExists),
    ],
    [
      "refused at the limit (ORGANIZATION_LIMIT_REACHED)",
      () =>
        new ConnectError(
          "this server holds 1 organization, its limit",
          Code.FailedPrecondition,
          undefined,
          [
            {
              desc: ErrorInfoSchema,
              value: create(ErrorInfoSchema, {
                reason: ORGANIZATION_LIMIT_REACHED,
                domain: "stigmer.ai",
              }),
            },
          ],
        ),
    ],
  ])(
    "a create that loses the race to another replica, %s, finds the winner's organization and fills it",
    async (_name, refusal) => {
      await composeWith();
      const holder = newSingleOrganizationHolder();
      // The winner's row lands while this create is in flight.
      await ensureSingleOrganization({
        store: server.store,
        creator: {
          createAsCaller: async () => {
            await seedOrganization("stigmer");
            throw refusal();
          },
        },
        caller: serverActingFor(SYSTEM_OPERATOR_IDENTITY_ID),
        holder,
        logger,
      });

      expect(holder.current()).toBe("stigmer");
      expect(await server.store.bootstrapState.get(SINGLE_ORG_KEY)).toBe(
        "stigmer",
      );
    },
  );


  it("a create that loses the race before the winner's row is stored finds it on a re-read, and fills it", async () => {
    await composeWith();
    const holder = newSingleOrganizationHolder();
    await ensureSingleOrganization({
      store: server.store,
      creator: {
        createAsCaller: async () => {
          // The winner has claimed the slug; its row lands a moment later.
          setTimeout(() => {
            void seedOrganization("stigmer");
          }, 150);
          throw new ConnectError(
            "Organization already exists",
            Code.AlreadyExists,
          );
        },
      },
      caller: serverActingFor(SYSTEM_OPERATOR_IDENTITY_ID),
      holder,
      logger,
    });

    expect(holder.current()).toBe("stigmer");
  });

  it("a create refused as a duplicate that leaves the store with none warns, fills nothing and boots", async () => {
    await composeWith();
    const holder = newSingleOrganizationHolder();
    await ensureSingleOrganization({
      store: server.store,
      creator: {
        createAsCaller: async () => {
          throw new ConnectError(
            "Organization already exists",
            Code.AlreadyExists,
          );
        },
      },
      caller: serverActingFor(SYSTEM_OPERATOR_IDENTITY_ID),
      holder,
      logger,
    });

    expect(holder.current()).toBeUndefined();
    expect(await server.store.bootstrapState.get(SINGLE_ORG_KEY)).toBe("");
    expect(lines).toContainEqual(
      expect.objectContaining({
        level: "warn",
        slug: "stigmer",
        message: expect.stringContaining("refused as a duplicate"),
      }),
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
