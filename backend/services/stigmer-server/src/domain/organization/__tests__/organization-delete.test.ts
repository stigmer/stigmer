/**
 * Pins the organization delete's order through a composed server in the
 * trusted-local posture: everything that names the organization goes
 * before its row, and a fault stops the delete with the organization in
 * place. An organization's id is its slug and the delete frees the slug for
 * anyone, so a row left behind would belong to the slug's next holder.
 *
 *   - the `org-delete:pre-delete` slot runs with the organization loaded
 *     and still stored, and its rows still in place;
 *   - a slot step's refusal answers its own code and copy, and leaves the
 *     organization and its rows;
 *   - the organization's policy rows are revoked before its row, as
 *     principal and as resource: a revocation fault answers Internal with
 *     fixed copy, leaves the organization and its owner row, and a retry
 *     completes the delete;
 *   - a slug freed by the delete and created again carries none of the old
 *     organization's rows.
 *
 * The policy store is the library's in-memory double, composed as the
 * IamPolicy store driver so a test can make one row's delete fault; the
 * grant path, the role lifecycle and the chain are the library's own.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import type { DescMessage } from "@bufbuild/protobuf";
import { Code, ConnectError, createClient } from "@connectrpc/connect";
import type { Client, Transport } from "@connectrpc/connect";
import { createGrpcTransport } from "@connectrpc/connect-node";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { IamPolicyCommandController } from "@stigmer/protos/ai/stigmer/iam/iampolicy/v1/command_pb";
import type { IamPolicy } from "@stigmer/protos/ai/stigmer/iam/iampolicy/v1/api_pb";
import type { Organization } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/api_pb";
import { OrganizationCommandController } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/command_pb";
import { OrganizationQueryController } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/query_pb";

import { loadConfig } from "../../../boot/config.js";
import { composeServer } from "../../../boot/compose.js";
import type { ComposedServer } from "../../../boot/compose.js";
import { createLogger } from "../../../boot/logger.js";
import type { GateSlotName } from "../../../extensions/gate-slots.js";
import type { ServerExtension } from "../../../extensions/registry.js";
import type { PipelineStep } from "../../../pipeline/pipeline.js";
import { EXISTING_RESOURCE_KEY } from "../../../pipeline/steps/load-existing.js";
import {
  resetOperatorIdentityForTests,
  setOperatorIdentity,
} from "../../../pipeline/steps/defaults.js";
import {
  fakeIamPolicyStore,
  orgRole,
  triple,
} from "../../iampolicy/__tests__/support.js";

const OPERATOR_EMAIL = "operator@example.com";
const REFUSED_SLUG = "delete-refused";
const OUTSIDER = "ida_0byc5k14t1e7b7kdxft7hwz1f7";
const AGENT = "agt_01hzzzzzzzzzzzzzzzzzzzzzzz";

async function grpcError(run: () => Promise<unknown>): Promise<ConnectError> {
  try {
    await run();
  } catch (error) {
    if (error instanceof ConnectError) {
      return error;
    }
    throw error;
  }
  throw new Error("expected the call to fail");
}

describe("organization delete (composed server, trusted-local posture)", () => {
  const policies = fakeIamPolicyStore();
  /** A policy id whose delete faults while set: the store answering an error mid-revocation. */
  let faultingDelete: string | undefined;
  const faultablePolicies = {
    ...policies,
    async deleteById(id: string): Promise<void> {
      if (id === faultingDelete) {
        throw new Error("policy store unavailable");
      }
      await policies.deleteById(id);
    },
  };

  /** What the slot's step saw, per organization, while it ran. */
  const seenBySlot = new Map<string, { loaded: string; rowsNaming: number }>();
  const slotStep: PipelineStep<DescMessage> = {
    name: "FakeOrgDeleteStep",
    execute: (ctx) => {
      const organization = ctx.get(EXISTING_RESOURCE_KEY) as
        | Organization
        | undefined;
      const id = organization?.metadata?.id ?? "";
      seenBySlot.set(id, { loaded: id, rowsNaming: rowsNaming(id).length });
      if (id === REFUSED_SLUG) {
        throw new ConnectError(
          "fake edition keeps something for this organization",
          Code.FailedPrecondition,
        );
      }
    },
  };
  const unit: ServerExtension = {
    name: "fake-org-delete",
    gateSteps: new Map<GateSlotName, ReadonlyArray<PipelineStep<DescMessage>>>([
      ["org-delete:pre-delete", [slotStep]],
    ]),
    drivers: { iamPolicyStore: faultablePolicies },
  };

  let dir: string;
  let server: ComposedServer;
  let transport: Transport;
  let organizations: Client<typeof OrganizationCommandController>;
  let organizationQuery: Client<typeof OrganizationQueryController>;
  /** The platform's own pipeline: the in-process transport's `internal` caller. */
  let platform: Client<typeof IamPolicyCommandController>;

  function rowsNaming(org: string): IamPolicy[] {
    return [...policies.rows.values()].filter(
      (policy) =>
        (policy.spec?.resource?.kind === "organization" &&
          policy.spec.resource.id === org) ||
        (policy.spec?.principal?.kind === "organization" &&
          policy.spec.principal.id === org),
    );
  }

  /** An organization with its creator's owner row, an outsider's member row, and an agent's scope link to it. */
  async function organizationWithRows(slug: string): Promise<void> {
    await organizations.create({
      apiVersion: "tenancy.stigmer.ai/v1",
      kind: "Organization",
      metadata: { name: slug, slug, org: "" },
      spec: { description: "created by the organization delete test" },
    });
    await platform.bootstrapPolicy(orgRole(OUTSIDER, "member", slug));
    await platform.bootstrapPolicy(
      triple({ kind: "organization", id: slug }, "organization", {
        kind: "agent",
        id: AGENT,
      }),
    );
  }

  beforeAll(async () => {
    dir = mkdtempSync(path.join(tmpdir(), "organization-delete-test-"));
    setOperatorIdentity(OPERATOR_EMAIL, "The Operator");
    server = await composeServer({
      config: loadConfig({
        STIGMER_MODEL_REGISTRY_REFRESH: "off",
        TEMPORAL_HOST_PORT: "127.0.0.1:1",
        DB_PATH: path.join(dir, "stigmer.db"),
        STORAGE_PATH: path.join(dir, "storage"),
        ARTIFACT_LOCAL_BASE_PATH: path.join(dir, "artifacts"),
        STIGMER_OPERATOR_EMAIL: OPERATOR_EMAIL,
      }),
      logger: createLogger({ level: "error", pretty: false, write: () => {} }),
      extensions: [unit],
      portOverride: 0,
      host: "127.0.0.1",
    });
    const port = await server.start();
    transport = createGrpcTransport({ baseUrl: `http://127.0.0.1:${port}` });
    organizations = createClient(OrganizationCommandController, transport);
    organizationQuery = createClient(OrganizationQueryController, transport);
    platform = createClient(
      IamPolicyCommandController,
      server.inProcessTransport,
    );
  });

  afterAll(async () => {
    await server.shutdown();
    resetOperatorIdentityForTests();
    rmSync(dir, { recursive: true, force: true });
  });

  beforeEach(() => {
    faultingDelete = undefined;
  });

  it("runs the slot with the organization and its rows in place, then removes every row naming it", async () => {
    await organizationWithRows("delete-clean");
    expect(rowsNaming("delete-clean")).toHaveLength(3);

    await organizations.delete({ value: "delete-clean" });

    expect(seenBySlot.get("delete-clean")).toEqual({
      loaded: "delete-clean",
      rowsNaming: 3,
    });
    expect(rowsNaming("delete-clean")).toEqual([]);
    const gone = await grpcError(() =>
      organizationQuery.get({ value: "delete-clean" }),
    );
    expect(gone.code).toBe(Code.NotFound);
  });

  it("a slot step's refusal answers its own copy and leaves the organization and its rows", async () => {
    await organizationWithRows(REFUSED_SLUG);

    const refused = await grpcError(() =>
      organizations.delete({ value: REFUSED_SLUG }),
    );

    expect(refused.code).toBe(Code.FailedPrecondition);
    expect(refused.rawMessage).toBe(
      "fake edition keeps something for this organization",
    );
    expect(
      (await organizationQuery.get({ value: REFUSED_SLUG })).metadata?.id,
    ).toBe(REFUSED_SLUG);
    expect(rowsNaming(REFUSED_SLUG)).toHaveLength(3);
  });

  it("a revocation fault fails the delete with the organization and its owner in place, and the retry completes it", async () => {
    await organizationWithRows("delete-faults");
    const member = rowsNaming("delete-faults").find(
      (row) => row.spec?.relation === "member",
    );
    faultingDelete = member?.metadata?.id;

    const failed = await grpcError(() =>
      organizations.delete({ value: "delete-faults" }),
    );

    expect(failed.code).toBe(Code.Internal);
    expect(failed.rawMessage).toBe(
      "failed to remove the organization's access policies",
    );
    expect(
      (await organizationQuery.get({ value: "delete-faults" })).metadata?.id,
    ).toBe("delete-faults");
    // The agent's scope link went first; the revocation stopped at the
    // member row, before the owner row the retry needs.
    expect(
      rowsNaming("delete-faults")
        .map((row) => row.spec?.relation)
        .sort(),
    ).toEqual(["member", "owner"]);

    faultingDelete = undefined;
    await organizations.delete({ value: "delete-faults" });
    expect(rowsNaming("delete-faults")).toEqual([]);
  });

  it("a slug freed by the delete and created again carries none of the old organization's rows", async () => {
    await organizationWithRows("delete-reborn");
    await organizations.delete({ value: "delete-reborn" });

    await organizations.create({
      apiVersion: "tenancy.stigmer.ai/v1",
      kind: "Organization",
      metadata: { name: "delete-reborn", slug: "delete-reborn", org: "" },
      spec: { description: "the slug, taken again" },
    });

    expect(
      rowsNaming("delete-reborn").map((row) => row.spec?.relation),
    ).toEqual(["owner"]);
  });
});
